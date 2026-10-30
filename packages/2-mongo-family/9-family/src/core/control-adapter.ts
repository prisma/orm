import type { ContractMarkerRecord, LedgerEntryRecord } from '@internal/contract/types';
import type {
  ControlAdapterDescriptor,
  ControlAdapterInstance,
  ControlDriverInstance,
  DatabasePolicies,
  MarkerDestination,
} from '@internal/framework-components/control';
import type { MongoAdapter, MongoQueryable } from '@internal/mongo-lowering';
import type {
  AnyMongoDdlCommand,
  MongoInspectionCommandVisitor,
} from '@internal/mongo-query-ast/control';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';

/**
 * Marker / ledger operations the Mongo runner depends on. Every method
 * takes a `space` parameter so each loaded contract space addresses its
 * own marker row independently — see ADR 212 for the per-space
 * mechanism.
 */
export interface MarkerOperations {
  /** Where the database keeps the contract markers, as messages name it to the user. */
  readonly markerLocation: string;
  readMarker(space: string): Promise<ContractMarkerRecord | null>;
  initMarker(space: string, destination: MarkerDestination): Promise<void>;
  updateMarker(
    space: string,
    expectedFrom: string,
    destination: MarkerDestination,
    heldPolicies?: DatabasePolicies,
  ): Promise<boolean>;
  writeLedgerEntry(
    space: string,
    entry: {
      readonly edgeId: string;
      readonly from: string;
      readonly to: string;
      readonly migrationName: string;
      readonly migrationHash: string;
      readonly operations: readonly unknown[];
    },
  ): Promise<void>;
}

/**
 * Everything the Mongo migration runner needs to talk to one database, bound to a single control driver. See ADR 198.
 */
export interface MongoRunnerDependencies {
  readonly inspectionExecutor: MongoInspectionCommandVisitor<Promise<Record<string, unknown>[]>>;
  readonly adapter: MongoAdapter;
  readonly driver: MongoQueryable;
  readonly executeDdl: (command: AnyMongoDdlCommand) => Promise<void>;
  readonly markerOps: MarkerOperations;
  readonly introspectSchema: () => Promise<MongoSchemaIR>;
}

/**
 * Mongo control adapter interface for control-plane operations.
 * Implemented by target-specific adapters (e.g. `@internal/adapter-mongo`).
 *
 * Mirrors `SqlControlAdapter` so the family layer dispatches every
 * driver-bound wire operation through a single SPI surface instead of
 * importing target-package internals directly. The adapter is the
 * natural home for these method bodies because it owns both the
 * `ControlDriverInstance` (which exposes the underlying `Db`) and the
 * Mongo command vocabulary used to talk to it.
 *
 * @template TTarget - The target ID (today only `'mongo'`).
 */
export interface MongoControlAdapter<TTarget extends string = string>
  extends ControlAdapterInstance<'mongo', TTarget> {
  /** Where the database keeps the contract markers, as messages name it to the user. */
  readonly markerLocation: string;

  /**
   * Reads the contract marker document for `space`, or returns `null`
   * if no marker document has been written for that space yet. Each
   * space owns one document keyed by `_id: <space>` in the
   * `_prisma_migrations` collection.
   */
  readMarker(
    driver: ControlDriverInstance<'mongo', TTarget>,
    space: string,
  ): Promise<ContractMarkerRecord | null>;

  /**
   * Reads every marker document (one per contract space) and returns
   * them keyed by `space`. Used by the per-space verifier to detect
   * marker-vs-on-disk drift and orphan marker rows. Returns an empty
   * map when no marker documents exist yet.
   */
  readAllMarkers(
    driver: ControlDriverInstance<'mongo', TTarget>,
  ): Promise<ReadonlyMap<string, ContractMarkerRecord>>;

  /**
   * Inserts an initial marker document for the given space.
   */
  initMarker(
    driver: ControlDriverInstance<'mongo', TTarget>,
    space: string,
    destination: MarkerDestination,
  ): Promise<void>;

  /**
   * Atomically updates the marker document for `space` while it holds `expectedFrom` and, when `heldPolicies` is given, while its `meta.policies` reads as them, however it is stored. Returns `true` when the swap succeeded, `false` when another process changed the marker first.
   */
  updateMarker(
    driver: ControlDriverInstance<'mongo', TTarget>,
    space: string,
    expectedFrom: string,
    destination: MarkerDestination,
    heldPolicies?: DatabasePolicies,
  ): Promise<boolean>;

  /**
   * Appends a ledger entry for the given space. Ledger entries co-exist
   * with marker documents in the same collection; their key shape
   * distinguishes them at read time.
   */
  writeLedgerEntry(
    driver: ControlDriverInstance<'mongo', TTarget>,
    space: string,
    entry: {
      readonly edgeId: string;
      readonly from: string;
      readonly to: string;
      readonly migrationName: string;
      readonly migrationHash: string;
      readonly operations: readonly unknown[];
    },
  ): Promise<void>;

  /**
   * Reads the per-migration ledger journal in apply order. When `space` is
   * omitted, returns rows for every space.
   */
  readLedger(
    driver: ControlDriverInstance<'mongo', TTarget>,
    space?: string,
  ): Promise<readonly LedgerEntryRecord[]>;

  /**
   * Introspects the live database and returns a `MongoSchemaIR`.
   */
  introspectSchema(driver: ControlDriverInstance<'mongo', TTarget>): Promise<MongoSchemaIR>;

  /**
   * Builds the migration runner's dependencies bound to `driver`.
   */
  createRunnerDependencies(
    driver: ControlDriverInstance<'mongo', TTarget>,
  ): MongoRunnerDependencies;
}

/**
 * Mongo control adapter descriptor. Mirrors `SqlControlAdapterDescriptor`:
 * extends the framework's `ControlAdapterDescriptor` and narrows the
 * `create()` return to a `MongoControlAdapter<TTarget>`.
 */
export interface MongoControlAdapterDescriptor<TTarget extends string = string>
  extends ControlAdapterDescriptor<'mongo', TTarget, MongoControlAdapter<TTarget>> {}
