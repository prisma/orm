import type { Contract } from '@internal/contract/types';
import { errorMigrationOperationOptionRemoved } from '@internal/errors/migration';
import {
  type ColumnRenameRequest,
  resolveColumnRenameAgainst,
  resolveTableRenameAgainst,
  type SqlMigrationPlanOperation,
  type StoredValueCodec,
  sqlTypeLookupsOf,
  type TableRenameRequest,
  unmatchedColumnRename,
  unmatchedTableRename,
} from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { Migration as SqlMigration } from '@internal/family-sql/migration';
import type { CodecRef } from '@internal/framework-components/codec';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { ControlStack, EnumValueCoordinateJson } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { MigrationContractViews } from '@internal/migration-tools/migration';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { DdlColumn, DdlTableConstraint } from '@internal/sql-relational-core/ast';
import { type SqlTextInput, sqlTextOf } from '@internal/sql-relational-core/contract-free';
import { nameOf } from '@internal/sql-schema-ir/naming';
import { sqlColumnTypesEqual } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { errorPostgresMigrationStackMissing, postgresError } from '../errors';
import { PostgresContractView } from '../postgres-contract-view';
import { PostgresRlsPolicy, type RenderedRlsPolicyLiteral } from '../postgres-rls-policy';
import type { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import { hasAutoincrementDefault } from './autoincrement-widths';
import {
  AddCheckConstraintCall,
  AddColumnCall,
  AddColumnWithTemporaryDefaultCall,
  AddForeignKeyCall,
  AddNativeEnumValueCall,
  AddPrimaryKeyCall,
  AddRequiredColumnToEmptyTableCall,
  AddUniqueCall,
  AlterColumnTypeCall,
  alterColumnTypeCallText,
  CreateExtensionCall,
  CreateIndexCall,
  CreateNativeEnumTypeCall,
  CreatePostgresRlsPolicyCall,
  CreateSchemaCall,
  CreateTableCall,
  DisableRowLevelSecurityCall,
  DropCheckConstraintCall,
  DropColumnCall,
  DropConstraintCall,
  DropDefaultCall,
  DropExtensionCall,
  DropIndexCall,
  DropNativeEnumTypeCall,
  DropNotNullCall,
  DropPostgresRlsPolicyCall,
  DropSchemaCall,
  DropTableCall,
  EnableRowLevelSecurityCall,
  RemoveStoredValueCall,
  RenameConstraintCall,
  RenameIndexCall,
  RenamePostgresRlsPolicyCall,
  RenameSchemaCall,
  ReplaceStoredValueCall,
  SetDefaultCall,
  SetExtensionSchemaCall,
  SetNotNullCall,
  SetTableSchemaCall,
} from './op-factory-call';
import type { AlterColumnTypeClass } from './operations/columns';
import type { RenamableConstraintKind } from './operations/constraints';
import { type DataTransformOptions, dataTransform } from './operations/data-transform';
import { installExtension } from './operations/dependencies';
import type { CreateIndexExtras } from './operations/indexes';
import type { ForeignKeySpec } from './operations/shared';
import { stackDataTypes, writtenColumnType } from './planner-sql-checks';
import type { PostgresPlanTargetDetails } from './planner-target-details';
import { postgresContractToSchema } from './postgres-contract-to-schema';
import { ddlSchemaOfCallSchema } from './resolve-ddl-schema';
import { postgresSchemaTables } from './schema-tables';
import { postgresColumnRenameCall, postgresTableRenameCall } from './table-rename-calls';
import { createWorkingSchema, type WorkingSchemaCall } from './working-schema';

/**
 * Target-owned base class for Postgres migrations.
 *
 * Fixes the `SqlMigration` generic to `PostgresPlanTargetDetails` and the
 * abstract `targetId` to the Postgres target-id string literal, so both
 * user-authored migrations and renderer-generated scaffolds (the output of
 * `renderCallsToTypeScript`) can extend `PostgresMigration` directly without
 * redeclaring target-local identity.
 *
 * Mirrors `MongoMigration` in `@internal/family-mongo`: the renderer
 * emits `extends Migration` against a facade re-export of this class
 * from `@internal/postgres/migration`, keeping the authoring surface
 * target-scoped rather than family-scoped.
 *
 * The constructor materializes a single Postgres `SqlControlAdapter` from
 * `stack.adapter.create(stack)` and stores it; the protected `dataTransform`
 * instance method forwards to the free `dataTransform` factory with that
 * stored adapter, so user migrations can write `this.dataTransform(...)`
 * without threading the adapter through every call.
 *
 * Every method requires an explicit `schema`. Postgres migrations name their
 * schema deliberately — there is no default and no `search_path`-relative
 * option. A migration that left the schema unspecified would resolve against
 * whatever `search_path` the connection happened to carry, and that ambiguity
 * is an antipattern in a migration. (The unbound/unspecified namespace concept
 * remains for SQLite, which has no schemas, and for Mongo's connection `db`.)
 */
export abstract class PostgresMigration<
  Start extends Contract<SqlStorage> = Contract<SqlStorage>,
  End extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends SqlMigration<PostgresPlanTargetDetails, 'postgres', Start, End> {
  readonly targetId = 'postgres' as const;

  /**
   * Materialized Postgres control adapter, created once per migration
   * instance from the injected stack. `undefined` only when the migration
   * was instantiated without a stack (test fixtures); `controlAdapterFor`
   * throws a MIGRATION.POSTGRES_CONTROL_STACK_MISSING in that case to surface the misuse.
   */
  protected readonly controlAdapter: SqlControlAdapter<'postgres'> | undefined;

  /** The rename calls this read of `operations` has made so far, in order. */
  #renames: WorkingSchemaCall[] = [];

  #endView = new MigrationContractViews<PostgresContractView<End>>(
    this,
    'PostgresMigration',
    (json) => PostgresContractView.fromJson<End>(json),
  );
  #startView = new MigrationContractViews<PostgresContractView<Start>>(
    this,
    'PostgresMigration',
    (json) => PostgresContractView.fromJson<Start>(json),
  );

  constructor(stack?: ControlStack<'sql', 'postgres'>) {
    super(stack);
    // The descriptor `create()` is typed as the wider `ControlAdapterInstance`;
    // the Postgres descriptor concretely returns a `SqlControlAdapter<'postgres'>`,
    // so the cast holds for any Postgres-target stack assembled at runtime.
    this.controlAdapter = stack?.adapter
      ? blindCast<
          SqlControlAdapter<'postgres'>,
          'Postgres control stacks are assembled with a Postgres SQL control adapter'
        >(stack.adapter.create(stack))
      : undefined;
  }

  private frameworkComponents(): ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>> {
    const stack = this.stack;
    if (stack === undefined) return [];
    return [
      stack.target,
      ...(stack.adapter === undefined ? [] : [stack.adapter]),
      ...stack.extensions,
    ];
  }

  /** The codec `codecRef` names, built from the stack's codecs; a codec needs a stack. */
  private storedValueCodec(
    operation: string,
    codecRef: CodecRef | undefined,
  ): StoredValueCodec | undefined {
    if (codecRef === undefined) return undefined;
    this.controlAdapterFor(operation);
    return { codecRef, codecs: sqlTypeLookupsOf(this.frameworkComponents()).codecLookup };
  }

  private dataTypes(): ReturnType<typeof stackDataTypes> {
    return stackDataTypes(this.frameworkComponents());
  }

  /**
   * Returns the materialized control adapter, or throws a MIGRATION.POSTGRES_CONTROL_STACK_MISSING naming
   * `operation` when the migration was constructed without a `ControlStack`.
   * Single home for the null-check that every DDL/DML method shares.
   */
  private controlAdapterFor(operation: string): SqlControlAdapter<'postgres'> {
    if (!this.controlAdapter) {
      throw errorPostgresMigrationStackMissing(operation);
    }
    return this.controlAdapter;
  }

  /**
   * The typed, schema-qualified Postgres view over this migration's end-state
   * contract — `this.endContract.namespace.<schema>.table.<name>`, etc. Throws
   * if no `endContractJson` was provided.
   */
  get endContract(): PostgresContractView<End> {
    return this.#endView.endContract;
  }

  /**
   * The typed Postgres view over this migration's start-state contract, or
   * `null` for a baseline migration (no `startContractJson`).
   */
  get startContract(): PostgresContractView<Start> | null {
    return this.#startView.startContract;
  }

  /**
   * Instance-method wrapper around the free `dataTransform` factory that
   * supplies the stored control adapter. Authors call this from inside
   * `get operations()`; the adapter argument is hidden from the call site.
   */
  protected dataTransform<TContract extends Contract<SqlStorage>>(
    contract: TContract,
    name: string,
    options: DataTransformOptions,
  ): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return dataTransform(contract, name, options, this.controlAdapterFor('dataTransform'));
  }

  /**
   * Emit a `CREATE TABLE` migration operation. Builds a typed DDL node from
   * the supplied options and lowers it through the stored control adapter.
   * Throws if no adapter is present (i.e. migration instantiated without a stack).
   */
  protected createTable(options: {
    readonly schema: string;
    readonly table: string;
    readonly ifNotExists?: boolean;
    readonly columns: readonly DdlColumn[];
    readonly constraints?: readonly DdlTableConstraint[];
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new CreateTableCall(
      options.schema,
      options.table,
      options.columns,
      options.constraints,
    ).toOp(this.controlAdapterFor('createTable'));
  }

  /**
   * Emit a `CREATE SCHEMA` migration operation. Builds a typed DDL node from
   * the supplied options and lowers it through the stored control adapter.
   * Throws if no adapter is present (i.e. migration instantiated without a stack).
   */
  protected createSchema(options: {
    readonly schema: string;
    readonly ifNotExists?: boolean;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new CreateSchemaCall(options.schema).toOp(this.controlAdapterFor('createSchema'));
  }

  /**
   * Emit an `ALTER TABLE … SET SCHEMA` operation that moves `table` from `schema` to the schema
   * `to`. Leave out `schema` for a table of the unbound namespace. Indexes, constraints and owned
   * sequences move with the table, and foreign keys from other tables keep pointing at it. Later
   * rename calls find the table in its new schema.
   */
  protected setTableSchema(options: {
    readonly schema?: string;
    readonly table: string;
    readonly to: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    const call = new SetTableSchemaCall(
      options.schema ?? UNBOUND_NAMESPACE_ID,
      options.table,
      options.to,
    );
    const op = call.toOp(this.controlAdapterFor('setTableSchema'));
    this.#renames.push(call);
    return op;
  }

  /**
   * Emit an `ALTER SCHEMA … RENAME TO` operation. Everything in the schema keeps its place in it,
   * and later rename calls find its tables under the new name.
   */
  protected renameSchema(options: {
    readonly schema: string;
    readonly to: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    const call = new RenameSchemaCall(options.schema, options.to);
    const op = call.toOp(this.controlAdapterFor('renameSchema'));
    this.#renames.push(call);
    return op;
  }

  /**
   * Emit a `DROP SCHEMA` operation, without `CASCADE`. Drop or move the schema's tables first: the
   * operation fails its precheck while the schema still holds anything.
   */
  protected dropSchema(options: {
    readonly schema: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new DropSchemaCall(options.schema).toOp(this.controlAdapterFor('dropSchema'));
  }

  /**
   * Emit an `UPDATE` operation that changes the stored value `from` to `to` in `column`, in every row that holds it. With `many`, the column is a list column and the value changes inside every list that holds it. Values are stored values, as the column's codec writes them, and are passed as parameters. Without `codecRef`, pass each value in the form the column stores it, or no row matches. Leave out `schema` for a table of the unbound namespace.
   */
  protected replaceStoredValue(options: {
    readonly schema?: string;
    readonly table: string;
    readonly column: string;
    readonly from: string | number;
    readonly to: string | number;
    readonly many?: boolean;
    /** The column's codec: the values are then written as the contract stores them, and the codec writes them as the database does. */
    readonly codecRef?: CodecRef;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new ReplaceStoredValueCall(
      options.schema ?? UNBOUND_NAMESPACE_ID,
      options.table,
      options.column,
      options.from,
      options.to,
      options.many === true,
      this.storedValueCodec('replaceStoredValue', options.codecRef),
    ).toOp();
  }

  /**
   * Emit an `UPDATE` operation that removes the stored value `value` from `column`: it sets the column to NULL in every row that holds it, or, with `many`, takes the value out of every list that holds it. On a scalar column that takes no NULL, its check fails while any row holds the value. The operation is destructive.
   */
  protected removeStoredValue(options: {
    readonly schema?: string;
    readonly table: string;
    readonly column: string;
    readonly value: string | number;
    readonly many?: boolean;
    /** The column's codec, as for `replaceStoredValue`. */
    readonly codecRef?: CodecRef;
    /** The enum value the stored value belongs to: the check that fails while rows of a required column hold the value then names it. */
    readonly enumValue?: EnumValueCoordinateJson;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new RemoveStoredValueCall(
      options.schema ?? UNBOUND_NAMESPACE_ID,
      options.table,
      options.column,
      options.value,
      options.many === true,
      this.storedValueCodec('removeStoredValue', options.codecRef),
      options.enumValue,
    ).toOp();
  }

  /**
   * Emit a `CREATE TYPE ... AS ENUM (...)` migration operation for a managed
   * native enum. Builds a typed DDL node and lowers it through the stored
   * control adapter (members render in declaration order). Throws if no adapter
   * is present.
   */
  protected createNativeEnumType(options: {
    readonly schema: string;
    readonly typeName: string;
    readonly members: readonly string[];
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new CreateNativeEnumTypeCall(options.schema, options.typeName, options.members).toOp(
      this.controlAdapterFor('createNativeEnumType'),
    );
  }

  /**
   * Emit a `DROP TYPE` migration operation for a managed native enum, lowered
   * through the stored control adapter. Throws if no adapter is present.
   */
  protected dropNativeEnumType(options: {
    readonly schema: string;
    readonly typeName: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new DropNativeEnumTypeCall(options.schema, options.typeName).toOp(
      this.controlAdapterFor('dropNativeEnumType'),
    );
  }

  /**
   * Emit an `ALTER TYPE ... ADD VALUE` migration operation appending one
   * member to a managed native enum, lowered through the stored control
   * adapter. Throws if no adapter is present. Every appended value is its
   * own operation — call this once per value to append more than one.
   */
  protected addNativeEnumValue(options: {
    readonly schema: string;
    readonly typeName: string;
    readonly value: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new AddNativeEnumValueCall(options.schema, options.typeName, options.value).toOp(
      this.controlAdapterFor('addNativeEnumValue'),
    );
  }

  protected addColumn(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: DdlColumn;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    const adapter = this.controlAdapterFor('addColumn');
    return new AddColumnCall(options.schema, options.table, options.column, this.dataTypes()).toOp(
      adapter,
    );
  }

  /**
   * Adds a required column of `type` to a table that may have rows. Every existing row takes
   * `temporaryDefault`, SQL such as `''` or `0`, and the default is dropped once the column is added.
   */
  protected addColumnWithTemporaryDefault(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
    readonly type: string;
    readonly temporaryDefault: SqlTextInput;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    const adapter = this.controlAdapterFor('addColumnWithTemporaryDefault');
    return new AddColumnWithTemporaryDefaultCall(
      options.schema,
      options.table,
      options.column,
      options.type,
      sqlTextOf(
        options.temporaryDefault,
        `addColumnWithTemporaryDefault ${JSON.stringify(options.table)}.${JSON.stringify(options.column)} temporaryDefault`,
      ),
      this.dataTypes(),
    ).toOp(adapter);
  }

  /** Adds a required column of `type` with no default, checking first that the table is empty. */
  protected addRequiredColumnToEmptyTable(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
    readonly type: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    const adapter = this.controlAdapterFor('addRequiredColumnToEmptyTable');
    return new AddRequiredColumnToEmptyTableCall(
      options.schema,
      options.table,
      options.column,
      options.type,
      this.dataTypes(),
    ).toOp(adapter);
  }

  protected addPrimaryKey(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
    readonly columns: readonly string[];
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new AddPrimaryKeyCall(
      options.schema,
      options.table,
      options.constraint,
      options.columns,
    ).toOp(this.controlAdapterFor('addPrimaryKey'));
  }

  protected addUnique(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
    readonly columns: readonly string[];
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new AddUniqueCall(
      options.schema,
      options.table,
      options.constraint,
      options.columns,
    ).toOp(this.controlAdapterFor('addUnique'));
  }

  protected addForeignKey(options: {
    readonly schema: string;
    readonly table: string;
    readonly foreignKey: ForeignKeySpec;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new AddForeignKeyCall(options.schema, options.table, options.foreignKey).toOp(
      this.controlAdapterFor('addForeignKey'),
    );
  }

  protected addCheckConstraint(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
    readonly expression: SqlTextInput;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new AddCheckConstraintCall(
      options.schema,
      options.table,
      options.constraint,
      sqlTextOf(
        options.expression,
        `addCheckConstraint ${JSON.stringify(options.constraint)} expression`,
      ),
    ).toOp(this.controlAdapterFor('addCheckConstraint'));
  }

  protected renameCheckConstraint(options: {
    readonly schema?: string;
    readonly table: string;
    readonly from: string;
    readonly to: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return this.renameConstraint({ ...options, kind: 'checkConstraint' });
  }

  protected renameConstraint(options: {
    readonly schema?: string;
    readonly table: string;
    readonly kind: RenamableConstraintKind;
    readonly from: string;
    readonly to: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    const call = new RenameConstraintCall(
      options.schema ?? UNBOUND_NAMESPACE_ID,
      options.table,
      options.kind,
      options.from,
      options.to,
    );
    const adapter = this.controlAdapterFor('renameConstraint');
    this.#renames.push(call);
    return call.toOp(adapter);
  }

  protected dropCheckConstraint(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new DropCheckConstraintCall(options.schema, options.table, options.constraint).toOp(
      this.controlAdapterFor('dropCheckConstraint'),
    );
  }

  protected dropConstraint(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
    readonly kind?: 'foreignKey' | 'unique' | 'primaryKey';
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new DropConstraintCall(
      options.schema,
      options.table,
      options.constraint,
      options.kind ?? 'unique',
    ).toOp(this.controlAdapterFor('dropConstraint'));
  }

  /**
   * Emit the operations that rename a table: the table rename, then a rename of each primary key,
   * unique constraint, foreign key, index and check whose name was derived from the old table name.
   * The old name is resolved against the schema as this migration's earlier rename calls
   * (`renameTable`, `renameIndex`, `renameConstraint`, `renameRlsPolicy`) leave it, and the new
   * name against the end contract, so the companions start from names an earlier rename gave.
   * Spread the result into `operations`:
   * `...this.renameTable({ table: 'userProfile', to: 'UserProfile' })`. `schema` names the table's
   * namespace when more than one declares the table. Throws `MIGRATION.TABLE_RENAME_UNMATCHED` when
   * the table does not exist at that point of the migration or the end contract lacks the new name.
   */
  protected renameTable(options: {
    readonly schema?: string;
    readonly table: string;
    readonly to: string;
  }): readonly Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>>[] {
    const adapter = this.controlAdapterFor('renameTable');
    const rename: TableRenameRequest = {
      namespaceId: options.schema,
      from: options.table,
      to: options.to,
    };
    const startContract = this.startContract;
    if (startContract === null) {
      throw unmatchedTableRename(rename, 'the migration has no start contract');
    }
    const current = this.schemaAfterRenames(startContract);
    const endContract = this.endContract;
    const resolved = resolveTableRenameAgainst(
      postgresSchemaTables(current, startContract),
      endContract,
      rename,
    );
    if (!resolved.ok) {
      throw resolved.failure;
    }
    const call = postgresTableRenameCall({
      previous: current,
      contract: endContract,
      rename: resolved.value,
      frameworkComponents: this.frameworkComponents(),
    });
    this.#renames.push(call);
    return call.toOps(adapter).map(async (op) => op);
  }

  /**
   * Emit the operations that rename a column: the column rename, then a rename of each unique
   * constraint, foreign key and index on the column whose name was derived from the old column
   * name, to the name the end contract gives it. The column is resolved against the schema as this
   * migration's earlier rename calls leave it, so a column of a table an earlier `renameTable`
   * renamed is named on the table's new name. Spread the result into `operations`:
   * `...this.renameColumn({ table: 'User', column: 'name', to: 'fullName' })`. `schema` names the
   * table's namespace when more than one declares the table. Throws
   * `MIGRATION.COLUMN_RENAME_UNMATCHED` when the table or column does not exist at that point of
   * the migration, the table already has the new column, or the end contract lacks it.
   */
  protected renameColumn(options: {
    readonly schema?: string;
    readonly table: string;
    readonly column: string;
    readonly to: string;
  }): readonly Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>>[] {
    const adapter = this.controlAdapterFor('renameColumn');
    const rename: ColumnRenameRequest = {
      namespaceId: options.schema,
      table: options.table,
      from: options.column,
      to: options.to,
    };
    const startContract = this.startContract;
    if (startContract === null) {
      throw unmatchedColumnRename(rename, 'the migration has no start contract');
    }
    const current = this.schemaAfterRenames(startContract);
    const endContract = this.endContract;
    const resolved = resolveColumnRenameAgainst(
      postgresSchemaTables(current, startContract),
      endContract,
      rename,
    );
    if (!resolved.ok) {
      throw resolved.failure;
    }
    const call = postgresColumnRenameCall({
      previous: current,
      contract: endContract,
      rename: resolved.value,
      frameworkComponents: this.frameworkComponents(),
    });
    this.#renames.push(call);
    return call.toOps(adapter).map(async (op) => op);
  }

  /**
   * The start contract's schema with this read's rename calls applied in order. It is built only
   * when a rename or a `setDefault` needs it, so a migration that calls neither never reads its
   * start contract.
   */
  private schemaAfterRenames(startContract: Contract<SqlStorage>): PostgresDatabaseSchemaNode {
    const working = createWorkingSchema(
      postgresContractToSchema(startContract, this.frameworkComponents()),
    );
    for (const call of this.#renames) working.apply(call);
    return working.current;
  }

  protected override beginOperationsRead(): void {
    this.#renames = [];
  }

  protected dropTable(options: {
    readonly schema: string;
    readonly table: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new DropTableCall(options.schema, options.table).toOp(
      this.controlAdapterFor('dropTable'),
    );
  }

  protected dropColumn(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new DropColumnCall(options.schema, options.table, options.column).toOp(
      this.controlAdapterFor('dropColumn'),
    );
  }

  protected alterColumnType(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
    /** The new type as a migration writes it, such as `int4` or `varchar(20)`. */
    readonly type: string;
    /** The type is a raw type, named by its catalog text, such as `circle` (ADR 273): it is checked as written. */
    readonly raw?: true;
    /** The SQL that converts each value to the new type; by default a cast of the column. */
    readonly using?: SqlTextInput;
    /** By default `data` when `using` is given, and `destructive` otherwise. */
    readonly operationClass?: AlterColumnTypeClass;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    refuseInvalidAlterColumnTypeOptions(options);
    const adapter = this.controlAdapterFor('alterColumnType');
    const using = optionalSqlTextOf(
      options.using,
      `alterColumnType ${JSON.stringify(options.table)}.${JSON.stringify(options.column)} using`,
    );
    const call = new AlterColumnTypeCall({
      schemaName: options.schema,
      tableName: options.table,
      columnName: options.column,
      type: options.type,
      ...ifDefined('raw', options.raw),
      ...ifDefined('using', using === undefined ? undefined : { kind: 'sql' as const, sql: using }),
      dataTypes: this.dataTypes(),
      ...ifDefined('operationClass', options.operationClass),
      ownsAutoincrementSequence: this.startColumnHasAutoincrementDefault(
        options.schema,
        options.table,
        options.column,
      ),
    });
    if (using !== undefined) this.refuseUnchangedTypeConversion(call);
    return call.toOp(adapter);
  }

  private startColumnHasAutoincrementDefault(
    schema: string,
    table: string,
    column: string,
  ): boolean {
    const startColumn = this.startColumnAfterRenames(schema, table, column);
    return startColumn !== undefined && hasAutoincrementDefault(startColumn);
  }

  /** The column in the start contract's schema after this migration's earlier renames. */
  private startColumnAfterRenames(schema: string, table: string, column: string) {
    const startContract = this.startContract;
    if (startContract === null) return undefined;
    return this.schemaAfterRenames(startContract).namespaces[ddlSchemaOfCallSchema(schema)]?.tables[
      table
    ]?.columns[column];
  }

  /**
   * Refuses an `alterColumnType` with `using` to the type the start contract, after this migration's earlier renames, already gives the column. Its postcheck compares only the type, which already holds, so the runner would skip the conversion. Other earlier operations of the migration, such as an earlier `alterColumnType`, are not applied to the start contract.
   */
  private refuseUnchangedTypeConversion(call: AlterColumnTypeCall): void {
    const column = this.startColumnAfterRenames(call.schemaName, call.tableName, call.columnName);
    if (column === undefined) return;
    const written = writtenColumnType(call.type, this.dataTypes());
    if (written === undefined || !sqlColumnTypesEqual(column, written)) return;
    const where = alterColumnTypeCallText(call.schemaName, call.tableName, call.columnName);
    throw postgresError(
      'MIGRATION.ALTER_COLUMN_TYPE_USING_WITHOUT_TYPE_CHANGE',
      `${where}: the start contract, after the earlier renames in this migration, already gives the column the type ${JSON.stringify(call.type)}, so the conversion in using would never run`,
      {
        why: 'The runner skips an operation whose postchecks already hold. alterColumnType checks only that the column has the new type, which holds before it runs, so the values would never be converted.',
        fix: 'Write the conversion as a dataTransform, which checks the rows themselves, or change the column to another type.',
        meta: { where, type: call.type },
      },
    );
  }

  protected setNotNull(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new SetNotNullCall(options.schema, options.table, options.column).toOp(
      this.controlAdapterFor('setNotNull'),
    );
  }

  protected dropNotNull(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new DropNotNullCall(options.schema, options.table, options.column).toOp(
      this.controlAdapterFor('dropNotNull'),
    );
  }

  /**
   * Emit an `ALTER COLUMN … SET DEFAULT` operation. It is widening when this migration's start contract, after the renames made earlier in the migration, gives the column a default, and additive otherwise.
   */
  protected setDefault(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: DdlColumn;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    refuseEarlierSetDefaultOptions(options);
    return new SetDefaultCall(
      options.schema,
      options.table,
      options.column,
      this.columnHasDefaultAfterRenames(options.schema, options.table, options.column.name)
        ? 'widening'
        : 'additive',
    ).toOp(this.controlAdapterFor('setDefault'));
  }

  /**
   * Whether the column, found by schema, table and column name in the start contract after this migration's earlier renames, has a default.
   */
  private columnHasDefaultAfterRenames(schema: string, table: string, column: string): boolean {
    return this.startColumnAfterRenames(schema, table, column)?.resolvedDefault !== undefined;
  }

  protected dropDefault(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new DropDefaultCall(options.schema, options.table, options.column).toOp(
      this.controlAdapterFor('dropDefault'),
    );
  }

  protected createIndex(
    options: {
      readonly schema: string;
      readonly table: string;
      readonly index: string;
      readonly extras?: CreateIndexExtrasInput;
    } & (
      | { readonly columns: readonly string[]; readonly expression?: never }
      | { readonly expression: SqlTextInput; readonly columns?: never }
    ),
  ): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new CreateIndexCall(
      options.schema,
      options.table,
      options.index,
      options.columns !== undefined
        ? { columns: options.columns }
        : {
            expression: sqlTextOf(
              options.expression,
              `createIndex ${JSON.stringify(options.index)} expression`,
            ),
          },
      options.extras === undefined ? undefined : createIndexExtrasOf(options.extras, options.index),
    ).toOp(this.controlAdapterFor('createIndex'));
  }

  protected renameIndex(options: {
    readonly schema: string;
    readonly table: string;
    readonly from: string;
    readonly to: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    const call = new RenameIndexCall(options.schema, options.table, options.from, options.to);
    const adapter = this.controlAdapterFor('renameIndex');
    this.#renames.push(call);
    return call.toOp(adapter);
  }

  protected dropIndex(options: {
    readonly schema: string;
    readonly table: string;
    readonly index: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new DropIndexCall(options.schema, options.table, options.index).toOp(
      this.controlAdapterFor('dropIndex'),
    );
  }

  /**
   * Emit a `CREATE EXTENSION … WITH SCHEMA …` migration operation, checked to find the extension absent before and present after.
   */
  protected createExtension(options: {
    readonly schema: string;
    readonly extension: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new CreateExtensionCall(options.schema, options.extension).toOp(
      this.controlAdapterFor('createExtension'),
    );
  }

  /** Emit a `DROP EXTENSION` migration operation, without `CASCADE`. */
  protected dropExtension(options: {
    readonly schema: string;
    readonly extension: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new DropExtensionCall(options.schema, options.extension).toOp(
      this.controlAdapterFor('dropExtension'),
    );
  }

  /** Emit an `ALTER EXTENSION … SET SCHEMA …` migration operation. */
  protected setExtensionSchema(options: {
    readonly extension: string;
    readonly schema: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new SetExtensionSchemaCall(options.extension, options.schema).toOp(
      this.controlAdapterFor('setExtensionSchema'),
    );
  }

  protected installExtension(options: {
    readonly extensionName: string;
    readonly invariantId: string;
    readonly id: string;
    readonly label?: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return installExtension(options, this.controlAdapterFor('installExtension'));
  }

  protected enableRowLevelSecurity(options: {
    readonly schema: string;
    readonly table: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new EnableRowLevelSecurityCall(options.schema, options.table).toOp(
      this.controlAdapterFor('enableRowLevelSecurity'),
    );
  }

  protected disableRowLevelSecurity(options: {
    readonly schema: string;
    readonly table: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new DisableRowLevelSecurityCall(options.schema, options.table).toOp(
      this.controlAdapterFor('disableRowLevelSecurity'),
    );
  }

  protected createRlsPolicy(options: {
    readonly schema: string;
    readonly table: string;
    readonly policy: RlsPolicyInput;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    const policyName = JSON.stringify(nameOf(options.policy.naming));
    return new CreatePostgresRlsPolicyCall(
      options.schema,
      options.table,
      new PostgresRlsPolicy({
        ...options.policy,
        using: optionalSqlTextOf(options.policy.using, `createRlsPolicy ${policyName} using`),
        withCheck: optionalSqlTextOf(
          options.policy.withCheck,
          `createRlsPolicy ${policyName} withCheck`,
        ),
      }),
    ).toOp(this.controlAdapterFor('createRlsPolicy'));
  }

  protected dropRlsPolicy(options: {
    readonly schema: string;
    readonly table: string;
    readonly policy: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new DropPostgresRlsPolicyCall(options.schema, options.table, options.policy).toOp(
      this.controlAdapterFor('dropRlsPolicy'),
    );
  }

  protected renameRlsPolicy(options: {
    readonly schema: string;
    readonly table: string;
    readonly from: string;
    readonly to: string;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    const call = new RenamePostgresRlsPolicyCall(
      options.schema,
      options.table,
      options.from,
      options.to,
    );
    const adapter = this.controlAdapterFor('renameRlsPolicy');
    this.#renames.push(call);
    return call.toOp(adapter);
  }
}

/**
 * `setDefault` options an earlier version wrote carry the column's name in `column` and its default as SQL text in `defaultSql`.
 */
function refuseEarlierSetDefaultOptions(options: {
  readonly table: string;
  readonly column: DdlColumn;
}): void {
  const column: unknown = options.column;
  const columnIsName = typeof column === 'string';
  if (!columnIsName && !Object.hasOwn(options, 'defaultSql')) return;
  throw errorMigrationOperationOptionRemoved({
    operation: 'setDefault',
    option: 'defaultSql',
    subject: `column ${JSON.stringify(columnIsName ? column : options.column.name)} of table ${JSON.stringify(options.table)}`,
    rewrite:
      'Pass the column as `col(name, type, { default, codecRef })`, with its default written as `lit(value)` or `fn(expression)`, in place of its name and `defaultSql`.',
    upgradeEntry: 'migration-ts-column-defaults',
  });
}

/**
 * `alterColumnType` options as a hand-written `migration.ts` may pass them, which `node migration.ts` does not type-check: the
 * `options` object an earlier version wrote, or no `type`.
 */
function refuseInvalidAlterColumnTypeOptions(options: {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
  readonly type: string;
}): void {
  if (Object.hasOwn(options, 'options')) {
    throw errorMigrationOperationOptionRemoved({
      operation: 'alterColumnType',
      option: 'options',
      subject: `column ${JSON.stringify(options.column)} of table ${JSON.stringify(options.table)}`,
      rewrite:
        'Pass `{ schema, table, column, type, using? }`: move `options.qualifiedTargetType` to `type` and `options.using` to `using`, and drop the other options.',
      upgradeEntry: 'postgres-alter-column-type-plain-options',
    });
  }
  const type: unknown = options.type;
  if (typeof type === 'string') return;
  const where = alterColumnTypeCallText(options.schema, options.table, options.column);
  throw postgresError('MIGRATION.COLUMN_TYPE_UNREADABLE', `${where}: it has no \`type\``, {
    why: 'A column type change needs the new type, and node migration.ts does not check the types of the options it is given.',
    fix: 'Pass `{ schema, table, column, type, using? }`, with `type` written as a migration writes it, such as int4 or varchar(20).',
    meta: { type: String(type), where },
  });
}

type CreateIndexExtrasInput = Omit<CreateIndexExtras, 'where'> & {
  readonly where?: SqlTextInput;
};

type RlsPolicyInput = Omit<RenderedRlsPolicyLiteral, 'using' | 'withCheck'> & {
  readonly using?: SqlTextInput;
  readonly withCheck?: SqlTextInput;
};

function optionalSqlTextOf(value: SqlTextInput | undefined, what: string): string | undefined {
  return value === undefined ? undefined : sqlTextOf(value, what);
}

function createIndexExtrasOf(extras: CreateIndexExtrasInput, index: string): CreateIndexExtras {
  const { where, ...rest } = extras;
  const what = `createIndex ${JSON.stringify(index)} where`;
  return { ...rest, ...ifDefined('where', optionalSqlTextOf(where, what)) };
}
