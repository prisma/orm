import type { Contract, ContractMarkerRecord, LedgerEntryRecord } from '@internal/contract/types';
import type {
  AdapterInstance,
  DriverInstance,
  ExtensionInstance,
  FamilyInstance,
  TargetBoundComponentDescriptor,
  TargetInstance,
} from '../shared/framework-components';
import type {
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from './control-operation-results';

export interface ControlFamilyInstance<TFamilyId extends string, TSchemaIR>
  extends FamilyInstance<TFamilyId> {
  /**
   * The family seam-of-record for on-disk contract reads. Structurally
   * validates the JSON envelope and hydrates IR-class instances via the
   * per-target ContractSerializer. The single named entry point every
   * CLI on-disk read crosses (TML-2536) — `as Contract` casts in
   * production package sources are a serializer-bypass smell guarded by
   * `pnpm lint:no-contract-cast`.
   */
  deserializeContract(contractJson: unknown): Contract;

  verify(options: {
    readonly driver: ControlDriverInstance<TFamilyId, string>;
    readonly contract: unknown;
    readonly expectedTargetId: string;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<VerifyDatabaseResult>;

  /**
   * Verify a contract against an already-introspected schema.
   *
   * Callers that need to verify against the live database compose
   * {@link introspect} + `verifySchema` directly. The aggregate verifier
   * verifies each member against the full introspected schema and scopes the
   * result to that member's contract space afterwards — it never prunes the
   * schema up front.
   *
   * Synchronous — no I/O. Idempotent.
   */
  verifySchema(options: {
    readonly contract: unknown;
    readonly schema: TSchemaIR;
    readonly strict: boolean;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, string>>;
  }): VerifyDatabaseSchemaResult;

  sign(options: {
    readonly driver: ControlDriverInstance<TFamilyId, string>;
    readonly contract: unknown;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<SignDatabaseResult>;

  /**
   * Reads the contract marker for `space` from the database, returning
   * `null` if no marker row exists for that space (or if the marker
   * table itself is missing).
   *
   * `space` is required at every call site so the type system surfaces
   * every place that needs to thread the value: callers in app-only
   * paths pass {@link import('./control-spaces').APP_SPACE_ID}
   * (`'app'`); per-extension callers pass the extension's space id.
   * Defaulting at the family-interface level was a silent bug door —
   * it let callers forget to pass `space` and collapse onto the app's
   * marker row.
   *
   * Families whose underlying storage doesn't yet support per-space
   * markers (Mongo, today) accept `space` for interface conformance and
   * reject any non-`APP_SPACE_ID` value rather than silently ignoring
   * it; see the family-specific implementation for details.
   */
  readMarker(options: {
    readonly driver: ControlDriverInstance<TFamilyId, string>;
    readonly space: string;
  }): Promise<ContractMarkerRecord | null>;

  /**
   * Reads every marker row keyed by `space`. Used by the per-space
   * verifier to detect orphan marker rows and marker-vs-on-disk drift.
   * Returns an empty map when the marker table does not yet exist.
   */
  readAllMarkers(options: {
    readonly driver: ControlDriverInstance<TFamilyId, string>;
  }): Promise<ReadonlyMap<string, ContractMarkerRecord>>;

  /**
   * Reads the per-migration ledger journal in apply order. When `space` is
   * omitted, returns rows for every space. Returns an empty array when the
   * ledger store does not yet exist or has no matching rows.
   */
  readLedger(options: {
    readonly driver: ControlDriverInstance<TFamilyId, string>;
    readonly space?: string;
  }): Promise<readonly LedgerEntryRecord[]>;

  /**
   * Reads the live database schema. `schema` selects the single schema to
   * read and only applies when no `contract` is given — a contract carries
   * its own declared namespaces, which the target walks instead. Targets
   * without a schema namespace (SQLite, Mongo) ignore it.
   */
  introspect(options: {
    readonly driver: ControlDriverInstance<TFamilyId, string>;
    readonly contract?: unknown;
    readonly schema?: string;
  }): Promise<TSchemaIR>;
}

export interface ControlTargetInstance<TFamilyId extends string, TTargetId extends string>
  extends TargetInstance<TFamilyId, TTargetId> {}

export interface ControlAdapterInstance<TFamilyId extends string, TTargetId extends string>
  extends AdapterInstance<TFamilyId, TTargetId> {}

export interface ControlDriverInstance<TFamilyId extends string, TTargetId extends string>
  extends DriverInstance<TFamilyId, TTargetId> {
  close(): Promise<void>;
  /**
   * Name of the database this connection is bound to, when the target names
   * one. `db update` asks the user to type it before applying destructive
   * operations, so it names where the data would be lost.
   */
  databaseName?(): Promise<string | undefined>;
}

export interface ControlExtensionInstance<TFamilyId extends string, TTargetId extends string>
  extends ExtensionInstance<TFamilyId, TTargetId> {}
