import type { Contract } from '@internal/contract/types';
import { errorMigrationOperationOptionRemoved } from '@internal/errors/migration';
import {
  type ColumnRenameRequest,
  resolveColumnRenameAgainst,
  resolveTableRenameAgainst,
  type SqlMigrationPlanOperation,
  type TableRenameRequest,
  unmatchedColumnRename,
  unmatchedTableRename,
} from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { Migration as SqlMigration } from '@internal/family-sql/migration';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { ControlStack } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { MigrationContractViews } from '@internal/migration-tools/migration';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { DdlColumn, DdlTableConstraint } from '@internal/sql-relational-core/ast';
import { type MigrationSqlText, sqlTextOf } from '@internal/sql-relational-core/contract-free';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { errorPostgresMigrationStackMissing } from '../errors';
import { PostgresContractView } from '../postgres-contract-view';
import { PostgresRlsPolicy, type RenderedRlsPolicyLiteral } from '../postgres-rls-policy';
import type { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import {
  AddCheckConstraintCall,
  AddColumnCall,
  AddForeignKeyCall,
  AddNativeEnumValueCall,
  AddPrimaryKeyCall,
  AddUniqueCall,
  AlterColumnTypeCall,
  type AlterColumnTypeOptions,
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
  DropIndexCall,
  DropNativeEnumTypeCall,
  DropNotNullCall,
  DropPostgresRlsPolicyCall,
  DropTableCall,
  EnableRowLevelSecurityCall,
  RenameConstraintCall,
  RenameIndexCall,
  RenamePostgresRlsPolicyCall,
  SetDefaultCall,
  SetNotNullCall,
} from './op-factory-call';
import type { AlterColumnTypeClass } from './operations/columns';
import type { RenamableConstraintKind } from './operations/constraints';
import { type DataTransformOptions, dataTransform } from './operations/data-transform';
import { installExtension } from './operations/dependencies';
import type { CreateIndexExtras } from './operations/indexes';
import type { ForeignKeySpec } from './operations/shared';
import type { PostgresPlanTargetDetails } from './planner-target-details';
import { postgresContractToSchema } from './postgres-contract-to-schema';
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
    return new AddColumnCall(options.schema, options.table, options.column).toOp(
      this.controlAdapterFor('addColumn'),
    );
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
    readonly expression: MigrationSqlText;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new AddCheckConstraintCall(
      options.schema,
      options.table,
      options.constraint,
      sqlTextOf(options.expression),
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
   * when a `renameTable` needs it, so a migration that renames no table never reads its start
   * contract.
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
    readonly options: Omit<AlterColumnTypeOptions, 'using'> & { readonly using?: MigrationSqlText };
    readonly operationClass?: AlterColumnTypeClass;
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new AlterColumnTypeCall(
      options.schema,
      options.table,
      options.column,
      alterColumnTypeOptionsOf(options.options),
      options.operationClass,
    ).toOp(this.controlAdapterFor('alterColumnType'));
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

  protected setDefault(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: DdlColumn;
    readonly operationClass?: 'additive' | 'widening';
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    refuseEarlierSetDefaultOptions(options);
    return new SetDefaultCall(
      options.schema,
      options.table,
      options.column,
      options.operationClass,
    ).toOp(this.controlAdapterFor('setDefault'));
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
      readonly extras?: Omit<CreateIndexExtras, 'where'> & { readonly where?: MigrationSqlText };
    } & (
      | { readonly columns: readonly string[]; readonly expression?: never }
      | { readonly expression: MigrationSqlText; readonly columns?: never }
    ),
  ): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new CreateIndexCall(
      options.schema,
      options.table,
      options.index,
      options.columns !== undefined
        ? { columns: options.columns }
        : { expression: sqlTextOf(options.expression) },
      options.extras === undefined ? undefined : createIndexExtrasOf(options.extras),
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
    readonly policy: Omit<RenderedRlsPolicyLiteral, 'using' | 'withCheck'> & {
      readonly using?: MigrationSqlText;
      readonly withCheck?: MigrationSqlText;
    };
  }): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
    return new CreatePostgresRlsPolicyCall(
      options.schema,
      options.table,
      new PostgresRlsPolicy({
        ...options.policy,
        using: optionalSqlTextOf(options.policy.using),
        withCheck: optionalSqlTextOf(options.policy.withCheck),
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

function optionalSqlTextOf(value: MigrationSqlText | undefined): string | undefined {
  return value === undefined ? undefined : sqlTextOf(value);
}

function alterColumnTypeOptionsOf(
  options: Omit<AlterColumnTypeOptions, 'using'> & { readonly using?: MigrationSqlText },
): AlterColumnTypeOptions {
  const { using, ...rest } = options;
  return { ...rest, ...ifDefined('using', optionalSqlTextOf(using)) };
}

function createIndexExtrasOf(
  extras: Omit<CreateIndexExtras, 'where'> & { readonly where?: MigrationSqlText },
): CreateIndexExtras {
  const { where, ...rest } = extras;
  return { ...rest, ...ifDefined('where', optionalSqlTextOf(where)) };
}
