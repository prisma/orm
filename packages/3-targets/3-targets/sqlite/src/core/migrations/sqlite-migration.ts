import type { Contract } from '@internal/contract/types';
import type {
  MigrationOperationClass,
  SqlMigrationPlanOperation,
} from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { Migration as SqlMigration } from '@internal/family-sql/migration';
import type { ControlStack } from '@internal/framework-components/control';
import { MigrationContractViews } from '@internal/migration-tools/migration';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { DdlColumn, DdlTableConstraint } from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { errorSqliteMigrationStackMissing } from '../errors';
import { SqliteContractView } from '../sqlite-contract-view';
import {
  AddColumnCall,
  CreateIndexCall,
  CreateTableCall,
  DropColumnCall,
  DropIndexCall,
  DropTableCall,
  RecreateTableCall,
} from './op-factory-call';
import type { SqliteColumnSpec, SqliteIndexSpec, SqliteTableSpec } from './operations/shared';
import type { RecreatePostcheck } from './operations/tables';
import type { SqlitePlanTargetDetails } from './planner-target-details';

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

  protected addColumn(options: {
    readonly table: string;
    readonly column: SqliteColumnSpec;
  }): Promise<Op> {
    return new AddColumnCall(options.table, options.column).toOp(
      this.controlAdapterFor('addColumn'),
    );
  }

  protected dropColumn(options: { readonly table: string; readonly column: string }): Promise<Op> {
    return new DropColumnCall(options.table, options.column).toOp(
      this.controlAdapterFor('dropColumn'),
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
    readonly contractTable: SqliteTableSpec;
    readonly schemaColumnNames: readonly string[];
    readonly indexes: readonly SqliteIndexSpec[];
    readonly summary: string;
    readonly postchecks: readonly RecreatePostcheck[];
    readonly operationClass: MigrationOperationClass;
  }): Promise<Op> {
    return new RecreateTableCall(options).toOp(this.controlAdapterFor('recreateTable'));
  }
}
