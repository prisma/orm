import type { ContractMarkerRecord, LedgerEntryRecord } from '@internal/contract/types';
import type { ControlAdapterInstance, ControlStack } from '@internal/framework-components/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import type {
  AnyQueryAst,
  DdlColumn,
  DdlNode,
  LoweredStatement,
  LowererContext,
  SqlExecuteRequest,
} from '@internal/sql-relational-core/ast';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import type { DefaultNormalizer } from './diff/sql-schema-diff';

/**
 * Structural interface for anything that can lower a SQL/DDL AST node to a
 * `LoweredStatement`. `SqlControlAdapter` satisfies this interface; the
 * migration planner and op-factory calls accept `Lowerer` rather than the
 * full `SqlControlAdapter` so they are not coupled to the broader control
 * adapter surface.
 */
export interface Lowerer {
  lower(ast: AnyQueryAst | DdlNode, context: LowererContext<unknown>): LoweredStatement;
}

/**
 * Extends {@link Lowerer} with async codec-routed DDL lowering. Control
 * adapters implement this; the planner's `CreateTableCall.toOp` and
 * `CreateSchemaCall.toOp` accept it to produce executable DDL statements
 * with literal defaults encoded through their codec.
 */
export interface ExecuteRequestLowerer extends Lowerer {
  lowerToExecuteRequest(
    ast: AnyQueryAst | DdlNode,
    context?: LowererContext<unknown>,
  ): Promise<SqlExecuteRequest>;
  /**
   * The `DEFAULT …` clause DDL writes for `column`'s default, or `''` when it has none or writes it another way, as an autoincrement column does. A literal default, and each element of a list default, is read by the column's codec first, so a value the codec refuses is `CONTRACT.DEFAULT_INVALID` naming `table` and the column. Every DDL statement that writes a column default writes this clause.
   */
  renderColumnDefault(column: DdlColumn, table: string): Promise<string>;
}

/**
 * SQL control adapter interface for control-plane operations.
 * Implemented by target-specific adapters (e.g., Postgres, MySQL).
 *
 * @template TTarget - The target ID (e.g., 'postgres', 'mysql')
 */
export interface SqlControlAdapter<TTarget extends string = string>
  extends ControlAdapterInstance<'sql', TTarget>,
    ExecuteRequestLowerer {
  /**
   * Reads the contract marker for `space` from the database, returning
   * `null` if no marker row exists for that space (or if the marker
   * table itself is missing). Implementations are responsible for the
   * dialect-specific existence probe (e.g. Postgres
   * `information_schema.tables` vs SQLite `sqlite_master`) and parameter
   * placeholders.
   *
   * `space` is required so callers cannot accidentally fall through to
   * the app's marker row when reading per-extension markers.
   *
   * @param driver - ControlDriverInstance for executing queries (target-specific)
   * @param space - Contract space id whose marker row to read (e.g. `'app'`)
   * @returns Resolved marker record, or `null` if not yet stamped.
   */
  readMarker(
    driver: SqlControlDriverInstance<TTarget>,
    space: string,
  ): Promise<ContractMarkerRecord | null>;

  /**
   * Reads every marker row from `prisma_contract.marker` (one per
   * contract space) and returns them keyed by `space`. Used by the
   * per-space verifier to detect marker-vs-on-disk drift and orphan
   * marker rows. Returns an empty map when the marker table does not
   * yet exist (fresh database / never-signed project).
   */
  readAllMarkers(
    driver: SqlControlDriverInstance<TTarget>,
  ): Promise<ReadonlyMap<string, ContractMarkerRecord>>;

  /**
   * Reads the per-migration ledger journal in apply order. When `space` is
   * omitted, returns rows for every space.
   */
  readLedger(
    driver: SqlControlDriverInstance<TTarget>,
    space?: string,
  ): Promise<readonly LedgerEntryRecord[]>;

  /**
   * Inserts the initial marker row for `space` (`INSERT` only). Fails when a
   * row for that space already exists. Used by `signSpaces()` so concurrent first-time
   * stamps cannot silently overwrite each other. `updated_at` is DB-side
   * (`now()` / `datetime('now')`). Mirrors `MongoControlAdapter.initMarker`.
   */
  insertMarker(
    driver: SqlControlDriverInstance<TTarget>,
    space: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<void>;

  /**
   * Writes the initial marker row for `space` as an upsert (`INSERT … ON
   * CONFLICT (space) DO UPDATE SET …`), so re-stamping a space overwrites the
   * existing row rather than failing. `updated_at` is stamped with a DB-side
   * time expression (`now()` / `datetime('now')`), never an app-side clock.
   */
  initMarker(
    driver: SqlControlDriverInstance<TTarget>,
    space: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<void>;

  /**
   * Atomically advances the marker row for `space` (compare-and-swap on
   * `core_hash = expectedFrom`). Returns `true` when the swap matched a row,
   * `false` when another process advanced the marker first. `destination.invariants`
   * is written verbatim when supplied (the union/dedupe policy lives upstream)
   * and left untouched when omitted. Mirrors `MongoControlAdapter.updateMarker`.
   */
  updateMarker(
    driver: SqlControlDriverInstance<TTarget>,
    space: string,
    expectedFrom: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<boolean>;

  /**
   * Appends a ledger entry for `space`. Mirrors `MongoControlAdapter.writeLedgerEntry`.
   * The SQL ledger table keys rows by an autoincrement id and partitions reads
   * by `space`, so `entry.edgeId` carries no dedicated column; `from` / `to`
   * land in `origin_core_hash` / `destination_core_hash`.
   */
  writeLedgerEntry(
    driver: SqlControlDriverInstance<TTarget>,
    space: string,
    entry: {
      readonly edgeId: string;
      readonly from: string;
      readonly to: string;
      readonly migrationName: string;
      readonly migrationHash: string;
      readonly operations: readonly unknown[];
      readonly destinationContractJson?: unknown;
    },
  ): Promise<void>;

  /**
   * Runs `fn` in one transaction on `driver`: `BEGIN`, then `COMMIT` when `fn` resolves, or `ROLLBACK` and the error rethrown when it throws. The driver must send `BEGIN`, every statement `fn` sends through it and the final `COMMIT` or `ROLLBACK` over one database session; the Postgres and SQLite control drivers each hold one connection.
   */
  withTransaction<T>(driver: SqlControlDriverInstance<TTarget>, fn: () => Promise<T>): Promise<T>;

  /**
   * Inside a transaction `withTransaction` opened, takes the one lock the migration runner holds while it reads and writes markers, and holds it until the transaction ends. The lock covers the marker table, so it is the same for every space. A target whose `withTransaction` already takes a lock that excludes the runner does nothing here.
   */
  lockMarker(driver: SqlControlDriverInstance<TTarget>): Promise<void>;

  /**
   * Introspects a database schema and returns the target's schema-IR node.
   *
   * This is a pure schema discovery operation that queries the database catalog
   * and returns the schema structure without type mapping or contract enrichment.
   * Type mapping and enrichment are handled separately by enrichment helpers.
   *
   * The return type is the family-base `SqlSchemaIRNode` so each target returns
   * its own node shape: SQLite returns a flat `SqlSchemaIR`, Postgres returns a
   * `PostgresDatabaseSchemaNode` tree root. Consumers `ensure` the concrete
   * target type before walking it.
   *
   * @param driver - ControlDriverInstance instance for executing queries (target-specific)
   * @param contract - Optional contract for contract-guided introspection (filtering, optimization)
   * @param schema - Schema name to introspect (defaults to 'public')
   * @returns Promise resolving to the live database schema node
   */
  introspect(
    driver: SqlControlDriverInstance<TTarget>,
    contract?: unknown,
    schema?: string,
  ): Promise<SqlSchemaIRNode>;

  /**
   * Optional target-specific normalizer for raw database default expressions.
   * When provided, schema defaults (raw strings) are normalized before comparison
   * with contract defaults (ColumnDefault objects) during schema verification.
   */
  readonly normalizeDefault?: DefaultNormalizer;

  /**
   * Ordered DDL queries that bootstrap marker/ledger control tables for migration
   * runners. Postgres includes `CREATE SCHEMA`; SQLite does not.
   */
  bootstrapControlTableQueries(): readonly DdlNode[];

  /**
   * Ordered DDL queries that bootstrap the marker table (and Postgres schema) for
   * `sign` — excludes the ledger table.
   */
  bootstrapSignMarkerQueries(): readonly DdlNode[];
}

/**
 * SQL control adapter descriptor interface.
 * Provides a factory method to create control adapter instances.
 *
 * @template TTarget - The target ID (e.g., 'postgres', 'mysql')
 */
export interface SqlControlAdapterDescriptor<TTarget extends string = string> {
  /**
   * Creates a SQL control adapter instance for control-plane operations.
   *
   * Receives the assembled `ControlStack` so adapters can read aggregated
   * metadata (codec lookup, extension contributions) when materializing.
   */
  create(stack: ControlStack<'sql', TTarget>): SqlControlAdapter<TTarget>;
}
