import type { ColumnDefault, Contract } from '@internal/contract/types';
import {
  type ColumnRenameRequest,
  type MigrationOperationClass,
  resolveColumnRenameAgainst,
  resolveTableRenameAgainst,
  type SqlMigrationPlanOperation,
  type SqlSlot,
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
import { MigrationContractViews } from '@internal/migration-tools/migration';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { DdlColumn, DdlTableConstraint } from '@internal/sql-relational-core/ast';
import { type SqlTextInput, sqlTextOf } from '@internal/sql-relational-core/contract-free';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { errorSqliteMigrationStackMissing } from '../errors';
import { SqliteContractView } from '../sqlite-contract-view';
import { sqliteContractToSchema } from './diff-database-schema';
import {
  AddColumnCall,
  CreateIndexCall,
  CreateTableCall,
  DropColumnCall,
  DropIndexCall,
  DropTableCall,
  RecreateTableCall,
  RemoveStoredValueCall,
  type RenameColumnCall,
  RenameStoredKeyCall,
  type RenameTableCall,
  ReplaceStoredValueCall,
} from './op-factory-call';
import type { SqliteColumnSpec, SqliteIndexSpec, SqliteTableSpec } from './operations/shared';
import type { RecreatePostcheck } from './operations/tables';
import type { SqlitePlanTargetDetails } from './planner-target-details';
import { sqliteSchemaTables } from './schema-tables';
import { sqliteColumnRenameCall, sqliteTableRenameCall } from './table-rename-calls';
import { createWorkingSchema } from './working-schema';

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;

/**
 * Target-owned base class for SQLite migrations. Fixes the `SqlMigration`
 * generic to `SqlitePlanTargetDetails` and the abstract `targetId` to the
 * SQLite literal, so both user-authored migrations and renderer-generated
 * scaffolds can extend `SqliteMigration` directly without redeclaring
 * target-local identity.
 *
 * The constructor materializes a single SQLite `SqlControlAdapter` from
 * `stack.adapter.create(stack)` and stores it; the protected instance methods
 * forward to the corresponding `*Call` with that stored adapter, so user
 * migrations can write `this.createTable({...})` without threading the adapter
 * through every call.
 *
 * Binds the framework base's `Start` / `End` contract generics so a subclass
 * that assigns its snapshot-store `contract.json` imports to
 * `startContractJson` / `endContractJson` gets fully-typed view accessors:
 * `this.endContract` is a `SqliteContractView<End>`
 * (sole namespace unwrapped to the root — `this.endContract.table.<name>`),
 * built lazily from the JSON fields via the shared `MigrationContractViews`
 * helper. Mirrors `MongoMigration`'s view getters; the framework base derives
 * `describe()` from the same JSON.
 */
export abstract class SqliteMigration<
  Start extends Contract<SqlStorage> = Contract<SqlStorage>,
  End extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends SqlMigration<SqlitePlanTargetDetails, 'sqlite', Start, End> {
  readonly targetId = 'sqlite' as const;

  /**
   * Materialized SQLite control adapter, created once per migration
   * instance from the injected stack. `undefined` only when the migration
   * was instantiated without a stack (test fixtures); `controlAdapterFor`
   * throws a MIGRATION.SQLITE_CONTROL_STACK_MISSING in that case to surface the misuse.
   */
  protected readonly controlAdapter: SqlControlAdapter<'sqlite'> | undefined;

  #endView = new MigrationContractViews<SqliteContractView<End>>(this, 'SqliteMigration', (json) =>
    SqliteContractView.fromJson<End>(json),
  );
  /** The rename calls this read of `operations` has made so far, in order. */
  #renames: (RenameTableCall | RenameColumnCall)[] = [];

  #startView = new MigrationContractViews<SqliteContractView<Start>>(
    this,
    'SqliteMigration',
    (json) => SqliteContractView.fromJson<Start>(json),
  );

  constructor(stack?: ControlStack<'sql', 'sqlite'>) {
    super(stack);
    this.controlAdapter = stack?.adapter
      ? blindCast<
          SqlControlAdapter<'sqlite'>,
          'The SQLite descriptor create() returns SqlControlAdapter<sqlite>; typed as wider ControlAdapterInstance at the framework boundary'
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

  /**
   * Returns the materialized control adapter, or throws a MIGRATION.SQLITE_CONTROL_STACK_MISSING naming
   * `operation` when the migration was constructed without a `ControlStack`.
   * Single home for the null-check that every DDL/DML method shares.
   */
  private controlAdapterFor(operation: string): SqlControlAdapter<'sqlite'> {
    if (!this.controlAdapter) {
      throw errorSqliteMigrationStackMissing(operation);
    }
    return this.controlAdapter;
  }

  /**
   * The typed SQLite view over this migration's end-state contract — sole
   * namespace unwrapped to the root, so `this.endContract.table.<name>` etc.
   * Throws if no `endContractJson` was provided.
   */
  get endContract(): SqliteContractView<End> {
    return this.#endView.endContract;
  }

  /**
   * The typed SQLite view over this migration's start-state contract, or
   * `null` for a baseline migration (no `startContractJson`).
   */
  get startContract(): SqliteContractView<Start> | null {
    return this.#startView.startContract;
  }

  protected createTable(options: {
    readonly table: string;
    readonly ifNotExists?: boolean;
    readonly columns: readonly DdlColumn[];
    readonly constraints?: readonly DdlTableConstraint[];
  }): Promise<Op> {
    return new CreateTableCall(options.table, options.columns, options.constraints).toOp(
      this.controlAdapterFor('createTable'),
    );
  }

  protected dropTable(options: { readonly table: string }): Promise<Op> {
    return new DropTableCall(options.table).toOp(this.controlAdapterFor('dropTable'));
  }

  /**
   * Emit the operations that rename a table: the table rename, then a drop and a create under the
   * new name of each index whose name was derived from the old table name. The old name is resolved
   * against the schema as this migration's earlier `renameTable` calls leave it, and the new name
   * against the end contract. Spread the result into `operations`:
   * `...this.renameTable({ table: 'userProfile', to: 'UserProfile' })`. Throws
   * `MIGRATION.TABLE_RENAME_UNMATCHED` when the table does not exist at that point of the migration
   * or the end contract lacks the new name.
   */
  protected renameTable(options: {
    readonly table: string;
    readonly to: string;
  }): readonly Promise<Op>[] {
    const adapter = this.controlAdapterFor('renameTable');
    const rename: TableRenameRequest = {
      namespaceId: undefined,
      from: options.table,
      to: options.to,
    };
    const startContract = this.startContract;
    if (startContract === null) {
      throw unmatchedTableRename(rename, 'the migration has no start contract');
    }
    const current = this.schemaAfterRenames(startContract);
    const endContract = this.endContract;
    const resolved = resolveTableRenameAgainst(sqliteSchemaTables(current), endContract, rename);
    if (!resolved.ok) {
      throw resolved.failure;
    }
    const call = sqliteTableRenameCall({
      previous: current,
      contract: endContract,
      rename: resolved.value,
      frameworkComponents: this.frameworkComponents(),
    });
    this.#renames.push(call);
    return call.toOps(adapter);
  }

  /**
   * Emit the operations that rename a column: the column rename, then a drop and a create under
   * the new name of each index on the column whose name was derived from the old column name. The
   * column is resolved against the schema as this migration's earlier rename calls leave it, so a
   * column of a table an earlier `renameTable` renamed is named on the table's new name. Spread the
   * result into `operations`: `...this.renameColumn({ table: 'User', column: 'name', to:
   * 'fullName' })`. Throws `MIGRATION.COLUMN_RENAME_UNMATCHED` when the table or column does not
   * exist at that point of the migration, the table already has the new column, or the end
   * contract lacks it.
   */
  protected renameColumn(options: {
    readonly table: string;
    readonly column: string;
    readonly to: string;
  }): readonly Promise<Op>[] {
    const adapter = this.controlAdapterFor('renameColumn');
    const rename: ColumnRenameRequest = {
      namespaceId: undefined,
      table: options.table,
      from: options.column,
      to: options.to,
    };
    const startContract = this.startContract;
    if (startContract === null) {
      throw unmatchedColumnRename(rename, 'the migration has no start contract');
    }
    const current = this.schemaAfterRenames(startContract);
    const resolved = resolveColumnRenameAgainst(
      sqliteSchemaTables(current),
      this.endContract,
      rename,
    );
    if (!resolved.ok) {
      throw resolved.failure;
    }
    const call = sqliteColumnRenameCall({
      previous: current,
      contract: this.endContract,
      rename: resolved.value,
      frameworkComponents: this.frameworkComponents(),
    });
    this.#renames.push(call);
    return call.toOps(adapter);
  }

  /** The start contract's schema with this read's rename calls applied in order. */
  private schemaAfterRenames(startContract: Contract<SqlStorage>): SqlSchemaIR {
    const working = createWorkingSchema(
      sqliteContractToSchema(startContract, sqlTypeLookupsOf(this.frameworkComponents())),
    );
    for (const call of this.#renames) working.apply(call);
    return working.current;
  }

  protected override beginOperationsRead(): void {
    this.#renames = [];
  }

  protected addColumn(options: {
    readonly table: string;
    readonly column: SqliteColumnSpecInput;
  }): Promise<Op> {
    return new AddColumnCall(
      options.table,
      columnSpecOf(options.column, 'addColumn', options.table),
    ).toOp(this.controlAdapterFor('addColumn'));
  }

  protected dropColumn(options: { readonly table: string; readonly column: string }): Promise<Op> {
    return new DropColumnCall(options.table, options.column).toOp(
      this.controlAdapterFor('dropColumn'),
    );
  }

  /**
   * Emit an `UPDATE` operation that changes the stored value `from` to `to` in `column`, in every row that holds it. Values are stored values, as the column's codec writes them, and are passed as parameters. Without `codecRef`, pass each value in the form the column stores it, or no row matches.
   */
  protected replaceStoredValue(options: {
    readonly table: string;
    readonly column: string;
    readonly from: string | number;
    readonly to: string | number;
    /** The column's codec: it writes `from` and `to` as the database stores them. */
    readonly codecRef?: CodecRef;
  }): Promise<Op> {
    return new ReplaceStoredValueCall(
      options.table,
      options.column,
      options.from,
      options.to,
      this.storedValueCodec('replaceStoredValue', options.codecRef),
    ).toOp();
  }

  /**
   * Emit an `UPDATE` operation that sets `column` to NULL in every row that holds the stored value `value`. On a column that takes no NULL, its check fails while any row holds the value. The operation is destructive.
   */
  protected removeStoredValue(options: {
    readonly table: string;
    readonly column: string;
    readonly value: string | number;
    /** The column's codec, as for `replaceStoredValue`. */
    readonly codecRef?: CodecRef;
    /** The enum value the stored value belongs to: the check that fails while rows of a required column hold the value then names it. */
    readonly enumValue?: EnumValueCoordinateJson;
  }): Promise<Op> {
    return new RemoveStoredValueCall(
      options.table,
      options.column,
      options.value,
      this.storedValueCodec('removeStoredValue', options.codecRef),
      options.enumValue,
    ).toOp();
  }

  /**
   * Emit an `UPDATE` operation that renames the key at the end of `path` to `to`, in every object of `column` the path reaches. `path` is an RFC 9535 JSONPath of member names (`.lat`, `['lat']`) and list wildcards (`[*]`) from the column's value, `$`, and ends at the key: `'$[*].lat'` renames `lat` in each object of a list. Only rows that hold the key are written. Its check fails, and nothing changes, while an object holds both keys.
   */
  protected renameStoredKey(options: {
    readonly table: string;
    readonly column: string;
    readonly path: string;
    readonly to: string;
  }): Promise<Op> {
    return Promise.resolve(
      new RenameStoredKeyCall(options.table, options.column, options.path, options.to).toOp(),
    );
  }

  protected createIndex(options: {
    readonly table: string;
    readonly index: string;
    readonly columns: readonly string[];
  }): Promise<Op> {
    return new CreateIndexCall(options.table, options.index, options.columns).toOp(
      this.controlAdapterFor('createIndex'),
    );
  }

  protected dropIndex(options: { readonly table: string; readonly index: string }): Promise<Op> {
    return new DropIndexCall(options.table, options.index).toOp(
      this.controlAdapterFor('dropIndex'),
    );
  }

  protected recreateTable(options: {
    readonly tableName: string;
    readonly contractTable: SqliteTableSpecInput;
    readonly schemaColumnNames: readonly string[];
    readonly indexes: readonly SqliteIndexSpec[];
    readonly summary: string;
    readonly postchecks: readonly RecreatePostcheck[];
    readonly operationClass: MigrationOperationClass;
    /** SQL each named column is copied from, such as `CAST("age" AS INTEGER)`. */
    readonly copyExpressions?: Readonly<Record<string, SqlTextInput>>;
    /** The value each named new column takes in the existing rows, such as `''`. */
    readonly temporaryValues?: Readonly<Record<string, SqlTextInput>>;
    /** The columns whose type changes; the rebuild checks each after its copy, as a conversion when it has a copy expression and as SQLite's cast otherwise. */
    readonly retypedColumns?: readonly string[];
  }): Promise<Op> {
    const { copyExpressions, temporaryValues, ...args } = options;
    return new RecreateTableCall({
      ...args,
      contractTable: {
        ...options.contractTable,
        columns: options.contractTable.columns.map((column) =>
          columnSpecOf(column, 'recreateTable', options.tableName),
        ),
      },
      ...ifDefined(
        'copyExpressions',
        copyExpressions === undefined
          ? undefined
          : copyExpressionSlotsOf(copyExpressions, options.tableName),
      ),
      ...ifDefined(
        'temporaryValues',
        temporaryValues === undefined
          ? undefined
          : copyExpressionSlotsOf(temporaryValues, options.tableName, 'temporaryValues'),
      ),
    }).toOp(this.controlAdapterFor('recreateTable'));
  }
}

type ColumnDefaultInput =
  | Exclude<ColumnDefault, { readonly kind: 'function' }>
  | { readonly kind: 'function'; readonly expression: SqlTextInput };

type SqliteColumnSpecInput = Omit<SqliteColumnSpec, 'default'> & {
  readonly default?: ColumnDefaultInput;
};

type SqliteTableSpecInput = Omit<SqliteTableSpec, 'columns'> & {
  readonly columns: readonly SqliteColumnSpecInput[];
};

function columnDefaultOf(columnDefault: ColumnDefaultInput, what: string): ColumnDefault {
  return columnDefault.kind === 'function'
    ? { kind: 'function', expression: sqlTextOf(columnDefault.expression, what) }
    : columnDefault;
}

function columnSpecOf(
  column: SqliteColumnSpecInput,
  operation: 'addColumn' | 'recreateTable',
  table: string,
): SqliteColumnSpec {
  const { default: columnDefault, ...rest } = column;
  const what = `${operation} ${JSON.stringify(table)}.${JSON.stringify(column.name)} default`;
  return {
    ...rest,
    ...ifDefined(
      'default',
      columnDefault === undefined ? undefined : columnDefaultOf(columnDefault, what),
    ),
  };
}

function copyExpressionSlotsOf(
  copyExpressions: Readonly<Record<string, SqlTextInput>>,
  table: string,
  option: 'copyExpressions' | 'temporaryValues' = 'copyExpressions',
): Record<string, SqlSlot> {
  return Object.fromEntries(
    Object.entries(copyExpressions).map(([column, expression]) => [
      column,
      {
        kind: 'sql',
        sql: sqlTextOf(expression, `recreateTable ${JSON.stringify(table)} ${option}.${column}`),
      },
    ]),
  );
}
