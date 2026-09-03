import type {
  ContractSourceDiagnostics,
  ContractSourceProvider,
  PrismaNextConfig,
} from '@internal/config/config-types';
import type { Contract, ContractMarkerRecord, LedgerEntryRecord } from '@internal/contract/types';
import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
  ControlTargetDescriptor,
  CoreSchemaView,
  MigrationPlannerConflict,
  MigrationPlanOperation,
  OperationPreview,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import type { PslDocumentAst } from '@internal/framework-components/psl-ast';
import type { Result } from '@internal/utils/result';
import type { ExecuteDbVerifyResult } from './operations/db-verify';

// ============================================================================
// Client Options
// ============================================================================

/**
 * Options for creating a control client.
 *
 * Note: This is NOT the same as CLI config. There's no `contract` field,
 * no file paths. The client is config-agnostic.
 *
 * The descriptor types use permissive `any` because family-specific descriptors
 * (e.g., SqlFamilyDescriptor) have more specific `create` method signatures that
 * are not compatible with the base ControlFamilyDescriptor type due to TypeScript
 * variance rules. The client implementation casts these internally.
 */
export interface ControlClientOptions {
  // biome-ignore lint/suspicious/noExplicitAny: required for contravariance - SqlFamilyDescriptor.create has specific parameter types
  readonly family: ControlFamilyDescriptor<any, any>;
  // biome-ignore lint/suspicious/noExplicitAny: required for contravariance - SqlControlTargetDescriptor extends with additional methods
  readonly target: ControlTargetDescriptor<any, any, any>;
  // biome-ignore lint/suspicious/noExplicitAny: required for contravariance in adapter.create()
  readonly adapter: ControlAdapterDescriptor<any, any, any>;
  /** Optional - control client can be created without driver for offline operations */
  // biome-ignore lint/suspicious/noExplicitAny: required for contravariance in driver.create()
  readonly driver?: ControlDriverDescriptor<any, any, any, any>;
  // biome-ignore lint/suspicious/noExplicitAny: required for contravariance in extension.create()
  readonly extensions?: ReadonlyArray<ControlExtensionDescriptor<any, any, any>>;
  /**
   * Optional default connection for auto-connect.
   * When provided, operations will auto-connect if not already connected.
   * The type is driver-specific (e.g., string URL for Postgres).
   */
  readonly connection?: unknown;
}

/**
 * Builds a {@link ControlClient} from descriptors. Commands take this as a
 * dependency so tests can hand them a double instead of the real client.
 */
export type CreateControlClient = (options: ControlClientOptions) => ControlClient;

// ============================================================================
// Progress Events
// ============================================================================

/**
 * Action names for control-api operations that can emit progress events.
 */
export type ControlActionName =
  | 'dbInit'
  | 'dbUpdate'
  | 'dbVerify'
  | 'migrate'
  | 'verify'
  | 'schemaVerify'
  | 'sign'
  | 'introspect'
  | 'emit';

/**
 * Progress event emitted during control-api operation execution.
 *
 * Events model operation progress using a span-based model:
 * - `spanStart`: Begin a timed segment (supports nesting via parentSpanId)
 * - `spanEnd`: Complete a timed segment
 *
 * All operation-specific progress (e.g., per-migration-operation) is modeled
 * as nested spans rather than special event types.
 *
 * Events are delivered via an optional `onProgress` callback to avoid polluting
 * return types. If the callback is absent, operations emit no events (zero overhead).
 */
export type ControlProgressEvent =
  | {
      readonly action: ControlActionName;
      readonly kind: 'spanStart';
      readonly spanId: string;
      readonly parentSpanId?: string;
      readonly label: string;
    }
  | {
      readonly action: ControlActionName;
      readonly kind: 'spanEnd';
      readonly spanId: string;
      readonly outcome: 'ok' | 'skipped' | 'error';
    };

/**
 * Callback function for receiving progress events during control-api operations.
 *
 * @param event - The progress event emitted by the operation
 */
export type OnControlProgress = (event: ControlProgressEvent) => void;

// ============================================================================
// Operation Options
// ============================================================================

/**
 * Options for the verify operation.
 */
export interface VerifyOptions {
  /** Contract or unvalidated JSON - validated at runtime via familyInstance.deserializeContract() */
  readonly contract: unknown;
  /**
   * Database connection. If provided, verify will connect before executing.
   * If omitted, the client must already be connected.
   * The type is driver-specific (e.g., string URL for Postgres).
   */
  readonly connection?: unknown;
  /** Optional progress callback for observing operation progress */
  readonly onProgress?: OnControlProgress;
}

/**
 * Options for the schemaVerify operation.
 */
export interface SchemaVerifyOptions {
  /** Contract or unvalidated JSON - validated at runtime via familyInstance.deserializeContract() */
  readonly contract: unknown;
  /**
   * Whether to use strict mode for schema verification.
   * In strict mode, extra tables/columns are reported as issues.
   * Default: false (tolerant mode - allows superset)
   */
  readonly strict?: boolean;
  /**
   * Database connection. If provided, schemaVerify will connect before executing.
   * If omitted, the client must already be connected.
   * The type is driver-specific (e.g., string URL for Postgres).
   */
  readonly connection?: unknown;
  /** Optional progress callback for observing operation progress */
  readonly onProgress?: OnControlProgress;
}

/**
 * Options for the sign operation.
 */
export interface SignOptions {
  /** Contract or unvalidated JSON - validated at runtime via familyInstance.deserializeContract() */
  readonly contract: unknown;
  /**
   * Path to the contract file (for metadata in the result).
   */
  readonly contractPath?: string;
  /**
   * Path to the config file (for metadata in the result).
   */
  readonly configPath?: string;
  /**
   * Database connection. If provided, sign will connect before executing.
   * If omitted, the client must already be connected.
   * The type is driver-specific (e.g., string URL for Postgres).
   */
  readonly connection?: unknown;
  /** Optional progress callback for observing operation progress */
  readonly onProgress?: OnControlProgress;
}

/**
 * Options for the dbInit operation.
 */
export interface DbInitOptions {
  /** Contract or unvalidated JSON - validated at runtime via familyInstance.deserializeContract() */
  readonly contract: unknown;
  /**
   * Mode for the dbInit operation.
   * - 'plan': Returns planned operations without applying
   * - 'apply': Applies operations and writes marker
   */
  readonly mode: 'plan' | 'apply';
  /**
   * Database connection. If provided, dbInit will connect before executing.
   * If omitted, the client must already be connected.
   * The type is driver-specific (e.g., string URL for Postgres).
   */
  readonly connection?: unknown;
  /**
   * On-disk migrations directory. Always required — every `db init`
   * routes through the per-space flow, which reads on-disk
   * `refs/head.json` and extension destination contracts from this
   * root.
   */
  readonly migrationsDir: string;
  /** Optional progress callback for observing operation progress */
  readonly onProgress?: OnControlProgress;
}

/**
 * Options for the dbUpdate operation.
 */
export interface DbUpdateOptions {
  /** Contract or unvalidated JSON - validated at runtime via familyInstance.deserializeContract() */
  readonly contract: unknown;
  /**
   * Mode for the dbUpdate operation.
   * - 'plan': Returns planned operations without applying
   * - 'apply': Applies operations and writes marker/ledger
   */
  readonly mode: 'plan' | 'apply';
  /**
   * Database connection. If provided, dbUpdate will connect before executing.
   * If omitted, the client must already be connected.
   * The type is driver-specific (e.g., string URL for Postgres).
   */
  readonly connection?: unknown;
  /**
   * When true, allows applying plans that contain destructive operations
   * (e.g., DROP TABLE, DROP COLUMN, ALTER TYPE).
   * When false (default), the operation returns a failure if the plan
   * includes destructive operations, which `db update` turns into its consent
   * prompt: the user types the database name, or passes `--confirm <database>`
   * where there is nobody to ask.
   */
  readonly acceptDataLoss?: boolean;
  /**
   * Consent to the destructive plan a prior `DESTRUCTIVE_CHANGES` refusal
   * named, identified by that refusal's `planHash`. The apply recomputes its
   * plan and refuses with `CONSENT_PLAN_MISMATCH` when the fresh plan is not
   * the one that was consented to.
   */
  readonly consent?: { readonly planHash: string };
  /**
   * On-disk migrations directory. Always required — every `db update`
   * routes through the per-space flow, which reads on-disk
   * `refs/head.json` and extension destination contracts from this
   * root.
   */
  readonly migrationsDir: string;
  /** Optional progress callback for observing operation progress */
  readonly onProgress?: OnControlProgress;
}

/**
 * The verification lanes the client offers: `full` runs the marker check and
 * the schema check, `marker-only` maps to `skipSchema: true`, and
 * `schema-only` runs {@link ControlClient.dbVerify} with `skipMarker: true`.
 */
export type DbVerifyMode = 'full' | 'marker-only' | 'schema-only';

/**
 * Options for the dbVerify operation.
 *
 * Drives the loader → aggregate-verifier pipeline. `strict` maps to
 * `verifyMigration({ mode: 'strict' | 'lenient' })`; `skipSchema`
 * mirrors the `--marker-only` CLI flag and short-circuits the schema
 * portion of the verifier.
 */
export interface DbVerifyOptions {
  /**
   * Already-deserialized contract. Callers cross the family
   * `deserializeContract` seam at the read site (TML-2536) and pass the
   * hydrated value through unchanged; this op no longer re-runs the
   * SerializerBase pipeline.
   */
  readonly contract: Contract;
  readonly migrationsDir: string;
  readonly strict: boolean;
  readonly skipSchema: boolean;
  readonly skipMarker: boolean;
  readonly connection?: unknown;
  readonly onProgress?: OnControlProgress;
}

/**
 * Options for the introspect operation.
 */
export interface IntrospectOptions {
  /**
   * Optional schema name to introspect.
   */
  readonly schema?: string;
  /**
   * Database connection. If provided, introspect will connect before executing.
   * If omitted, the client must already be connected.
   * The type is driver-specific (e.g., string URL for Postgres).
   */
  readonly connection?: unknown;
  /** Optional progress callback for observing operation progress */
  readonly onProgress?: OnControlProgress;
}

/**
 * Contract configuration for emit operation.
 */
export interface EmitContractConfig {
  /**
   * Contract source provider.
   */
  readonly source: ContractSourceProvider;
  /**
   * Output path for contract.json.
   * The .d.ts types file will be colocated (e.g., contract.json → contract.d.ts).
   */
  readonly output: string;
}

/**
 * Options for the emit operation.
 */
export interface EmitOptions {
  /**
   * Contract configuration containing source, output, and types paths.
   */
  readonly contractConfig: EmitContractConfig;
  /** Optional progress callback for observing operation progress */
  readonly onProgress?: OnControlProgress;
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Per-space breakdown of an aggregate plan / apply.
 *
 * Surfaces the canonical schedule shape — extensions alphabetically,
 * then app — together with the operations attributed to each space and,
 * when the run was applied, the resulting per-space marker hash.
 *
 * Every space involved in a run is observable in the success summary,
 * including its post-apply marker — the per-space marker is visible
 * to the user instead of being collapsed into a single ambiguous
 * top-level hash.
 */
export interface PerSpaceExecutionEntry {
  readonly spaceId: string;
  /** `'app'` for the application's contract space; `'extension'` for any extension space. */
  readonly kind: 'app' | 'extension';
  /**
   * Operations attributed to this space (display ops). In `mode: 'plan'`
   * this is the planned set; in `mode: 'apply'` it is the same set
   * (every op was executed in order, the runner does not skip).
   */
  readonly operations: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly operationClass: string;
  }>;
  /**
   * Post-apply marker hash for this space. Present only when the run
   * was applied (i.e. `mode: 'apply'` and the runner returned ok).
   * Equals the per-space plan's `destination.storageHash`.
   */
  readonly marker?: {
    readonly storageHash: string;
  };
}

/**
 * Successful dbInit result.
 */
export interface DbInitSuccess {
  readonly mode: 'plan' | 'apply';
  readonly plan: {
    readonly operations: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly operationClass: string;
    }>;
    /**
     * Family-agnostic textual preview of the planned operations, e.g.
     * `language: 'sql'` for SQL families and `language: 'mongodb-shell'`
     * for the Mongo family. Replaces the previous `sql?: readonly string[]`
     * field; consumers that previously read `plan.sql` should read
     * `plan.preview?.statements.map((s) => s.text)`.
     */
    readonly preview?: OperationPreview;
  };
  readonly destination: {
    readonly storageHash: string;
    readonly profileHash?: string;
  };
  readonly execution?: {
    readonly operationsPlanned: number;
    readonly operationsExecuted: number;
  };
  readonly marker?: {
    readonly storageHash: string;
    readonly profileHash?: string;
  };
  /**
   * Per-space breakdown in canonical schedule order (extensions
   * alphabetically, then app). Present whenever the aggregate flow
   * produced one — both `mode: 'plan'` and `mode: 'apply'`.
   *
   * See {@link PerSpaceExecutionEntry}.
   */
  readonly perSpace?: ReadonlyArray<PerSpaceExecutionEntry>;
  readonly summary: string;
  readonly warnings?: ReadonlyArray<MigrationPlannerConflict>;
}

/**
 * Failure codes for dbInit operation.
 */
export type DbInitFailureCode =
  | 'PLANNING_FAILED'
  | 'MIGRATION.MARKER_ORIGIN_MISMATCH'
  | 'RUNNER_FAILED';

/**
 * Failure details for dbInit operation.
 */
export interface DbInitFailure {
  readonly code: DbInitFailureCode;
  readonly summary: string;
  readonly why: string | undefined;
  readonly conflicts: ReadonlyArray<MigrationPlannerConflict> | undefined;
  readonly warnings?: ReadonlyArray<MigrationPlannerConflict>;
  readonly meta: Record<string, unknown> | undefined;
  /** Underlying failure or error for diagnostics; never serialized into envelopes. */
  readonly cause?: unknown;
  readonly marker?: {
    readonly storageHash?: string;
    readonly profileHash?: string;
  };
  readonly destination?: {
    readonly storageHash: string;
    readonly profileHash?: string | undefined;
  };
}

/**
 * Result type for dbInit operation.
 * Uses Result pattern: success returns DbInitSuccess, failure returns DbInitFailure.
 */
export type DbInitResult = Result<DbInitSuccess, DbInitFailure>;

/**
 * Successful dbUpdate result.
 */
export interface DbUpdateSuccess {
  readonly mode: 'plan' | 'apply';
  readonly plan: {
    readonly operations: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly operationClass: string;
    }>;
    /**
     * Family-agnostic textual preview of the planned operations, e.g.
     * `language: 'sql'` for SQL families and `language: 'mongodb-shell'`
     * for the Mongo family. Replaces the previous `sql?: readonly string[]`
     * field; consumers that previously read `plan.sql` should read
     * `plan.preview?.statements.map((s) => s.text)`.
     */
    readonly preview?: OperationPreview;
  };
  readonly destination: {
    readonly storageHash: string;
    readonly profileHash?: string;
  };
  readonly execution?: {
    readonly operationsPlanned: number;
    readonly operationsExecuted: number;
  };
  readonly marker?: {
    readonly storageHash: string;
    readonly profileHash?: string;
  };
  /**
   * Per-space breakdown in canonical schedule order (extensions
   * alphabetically, then app). See {@link PerSpaceExecutionEntry}.
   */
  readonly perSpace?: ReadonlyArray<PerSpaceExecutionEntry>;
  readonly summary: string;
  readonly warnings?: ReadonlyArray<MigrationPlannerConflict>;
}

/**
 * Failure codes for dbUpdate operation.
 */
export type DbUpdateFailureCode =
  | 'PLANNING_FAILED'
  | 'RUNNER_FAILED'
  | 'DESTRUCTIVE_CHANGES'
  | 'CONSENT_PLAN_MISMATCH';

/** One planned operation whose class is destructive, as the refusal names it. */
export interface DestructivePlanOperation {
  readonly id: string;
  readonly label: string;
}

/**
 * The verdict a `DESTRUCTIVE_CHANGES` refusal carries: what the plan would
 * destroy, the database it would destroy it in, and the identity of the plan
 * that was refused. Consent is granted against `planHash` — the caller passes
 * it back as `DbUpdateOptions.consent`.
 */
export interface DestructiveChangesVerdict {
  readonly destructiveOperations: ReadonlyArray<DestructivePlanOperation>;
  /** The connected database's name, when the driver can name it. */
  readonly databaseName: string | undefined;
  /** Content hash of the refused plan. */
  readonly planHash: string;
}

/**
 * Why an apply carrying consent was refused: the plan recomputed for the
 * apply is not the plan that was consented to.
 */
export interface ConsentPlanMismatchVerdict {
  readonly consentedPlanHash: string;
  readonly planHash: string;
}

/**
 * Failure details for dbUpdate operation.
 */
export interface DbUpdateFailure {
  readonly code: DbUpdateFailureCode;
  readonly summary: string;
  readonly why: string | undefined;
  readonly conflicts: ReadonlyArray<MigrationPlannerConflict> | undefined;
  readonly warnings?: ReadonlyArray<MigrationPlannerConflict>;
  readonly meta: Record<string, unknown> | undefined;
  /** Present exactly when `code` is `'DESTRUCTIVE_CHANGES'`. */
  readonly destructiveChanges?: DestructiveChangesVerdict;
  /** Present exactly when `code` is `'CONSENT_PLAN_MISMATCH'`. */
  readonly consentPlanMismatch?: ConsentPlanMismatchVerdict;
  /** Underlying failure or error for diagnostics; never serialized into envelopes. */
  readonly cause?: unknown;
}

/**
 * Result type for dbUpdate operation.
 * Uses Result pattern: success returns DbUpdateSuccess, failure returns DbUpdateFailure.
 */
export type DbUpdateResult = Result<DbUpdateSuccess, DbUpdateFailure>;

/**
 * Successful emit result.
 * Contains the hashes and paths of emitted files.
 */
export interface EmitSuccess {
  /** Storage hash of the emitted contract */
  readonly storageHash: string;
  /** Execution hash of the emitted contract (if execution section exists) */
  readonly executionHash?: string;
  /** Profile hash of the emitted contract (target-specific) */
  readonly profileHash: string;
  /** The emitted contract as JSON string */
  readonly contractJson: string;
  /** The emitted contract TypeScript declarations */
  readonly contractDts: string;
}

/**
 * Failure codes for emit operation.
 */
export type EmitFailureCode =
  | 'CONTRACT_SOURCE_INVALID'
  | 'CONTRACT_VALIDATION_FAILED'
  | 'EMIT_FAILED';

/**
 * Failure details for emit operation.
 */
export interface EmitFailure {
  readonly code: EmitFailureCode;
  readonly summary: string;
  readonly why: string | undefined;
  readonly meta: Record<string, unknown> | undefined;
  readonly diagnostics?: ContractSourceDiagnostics;
}

/**
 * Result type for emit operation.
 * Uses Result pattern: success returns EmitSuccess, failure returns EmitFailure.
 */
export type EmitResult = Result<EmitSuccess, EmitFailure>;

// ============================================================================
// Migration Apply Types
// ============================================================================

/**
 * Options for the aggregate-walking `migrate` operation.
 *
 * The control-api operation is responsible for: loading the
 * contract-space aggregate, reading per-space marker rows from the
 * live database, plotting per-space paths via `resolveRecordedPath`
 * (replay-only — no synth, no introspection), and dispatching
 * through the shared `runMigration` primitive. The CLI command
 * just resolves the descriptor surface (config, refs, contract
 * envelope, app-space migration packages) and hands the inputs in.
 */
export interface MigrateOptions {
  /** Already-validated app contract (the canonical "where we are heading" hash). */
  readonly contract: unknown;
  /** Migrations root directory (`migrations/` under the project). */
  readonly migrationsDir: string;
  /**
   * Optional app-space ref override. When provided, the app space's
   * graph-walk targets this hash instead of `contract.storage.storageHash`.
   * Extension spaces always walk to their own `headRef.hash`.
   */
  readonly refHash?: string;
  /**
   * Required invariants on the user-supplied app-space ref. Threaded
   * into the graph-walk's `required` calculation so the planner picks
   * an invariant-bearing path. Ignored when `refHash` is absent.
   */
  readonly refInvariants?: readonly string[];
  /**
   * Resolved name of the user-supplied app-space ref (the literal the
   * user passed to `--ref`). Decorates `pathDecision.refName` and any
   * `MIGRATION.NO_INVARIANT_PATH` envelope raised during graph-walk.
   * Ignored when `refHash` is absent.
   */
  readonly refName?: string;
  /**
   * Database connection. If provided, migrate will connect before executing.
   * If omitted, the client must already be connected.
   */
  readonly connection?: unknown;
  /** Optional progress callback for observing operation progress */
  readonly onProgress?: OnControlProgress;
}

/**
 * A single on-disk migration package surfaced to the operation. The
 * SQL family surfaces this shape from the tolerant contract-space
 * aggregate's app packages; the operation hands it through to the
 * framework-neutral aggregate loader's `appMigrationPackages` slot.
 *
 * (Originally named `MigrationApplyStep` for the earlier app-only
 * apply path; the name is kept for compatibility with existing CLI
 * callers and tests.)
 */
export interface MigrationApplyStep {
  readonly dirName: string;
  readonly from: string | null;
  readonly to: string;
  readonly operations: readonly MigrationPlanOperation[];
  /**
   * Sorted, deduplicated invariant ids from `migration.json.providedInvariants`.
   * Verified at load time by `readMigrationPackage` (manifest copy must equal
   * the value derived from `ops.json`).
   */
  readonly providedInvariants: readonly string[];
}

/**
 * Record of a successfully applied per-space migration. One entry per
 * contract space that had pending migrations — empty `applied` means
 * every space was already at its head.
 */
/**
 * One entry per authored migration package applied. Preserves the
 * `migrationsApplied` count semantics (each entry is one migration
 * directory) so `applied.length === migrationsApplied`.
 *
 * Per-space aggregate detail (markers, ops grouped by space) lives
 * on `perSpace[]`; this list is the per-edge view.
 */
export interface MigrateRanEntry {
  readonly spaceId: string;
  readonly dirName: string;
  readonly migrationHash: string;
  readonly from: string;
  readonly to: string;
  readonly operationsExecuted: number;
}

/**
 * Successful migrate result. Carries both the top-level fields
 * (`markerHash` is the **app space's** post-migrate marker) and the
 * per-space breakdown (`perSpace` — markers / operations in canonical
 * schedule order).
 */
/**
 * Path-decision summary for the **app space** post-migrate. Surfaced
 * at the top level (and consumed by the cli-journeys suite, which
 * inspects `requiredInvariants`/`satisfiedInvariants`/
 * `selectedPath` to validate invariant routing).
 *
 * Per-space path decisions for extension spaces are not surfaced —
 * extensions own their own ref/invariant control.
 */
export interface MigratePathDecision {
  readonly fromHash: string;
  readonly toHash: string;
  readonly alternativeCount: number;
  readonly tieBreakReasons: readonly string[];
  readonly refName?: string;
  readonly requiredInvariants: readonly string[];
  readonly satisfiedInvariants: readonly string[];
  readonly selectedPath: readonly {
    readonly dirName: string;
    readonly migrationHash: string;
    readonly from: string;
    readonly to: string;
    readonly invariants: readonly string[];
  }[];
}

export interface MigrateSuccess {
  readonly migrationsApplied: number;
  readonly markerHash: string;
  readonly applied: readonly MigrateRanEntry[];
  readonly summary: string;
  /**
   * Per-space breakdown in canonical schedule order (extensions
   * alphabetically, then app). See {@link PerSpaceExecutionEntry}.
   * Always present for the aggregate-walking operation.
   */
  readonly perSpace: ReadonlyArray<PerSpaceExecutionEntry>;
  /**
   * Path-decision data for the app space. Present whenever the
   * graph-walk strategy ran for the app (i.e. always for the
   * aggregate-walking migrate path). Absent only for the no-op
   * "Already up to date" early return when the app has no plan.
   */
  readonly pathDecision?: MigratePathDecision;
}

/**
 * Failure codes for migrate operation.
 */
export type MigrateFailureCode = 'RUNNER_FAILED' | 'MIGRATION_PATH_NOT_FOUND';

/**
 * Failure details for migrate operation.
 */
export interface MigrateFailure {
  readonly code: MigrateFailureCode;
  readonly summary: string;
  readonly why: string | undefined;
  readonly meta: Record<string, unknown> | undefined;
  /** Underlying failure or error for diagnostics; never serialized into envelopes. */
  readonly cause?: unknown;
}

/**
 * Result type for migrate operation.
 */
export type MigrateResult = Result<MigrateSuccess, MigrateFailure>;

// ============================================================================
// Standalone Contract Emit Types
// ============================================================================

/**
 * Options for the standalone executeContractEmit function.
 *
 * `executeContractEmit` is the canonical publication path for both the
 * `prisma contract emit` CLI command and the `@internal/vite-plugin-contract-emit`
 * Vite plugin. Do not duplicate the load → emit → publish dance elsewhere; if a
 * caller needs additional behavior, extend this options shape and update the
 * single implementation rather than building a parallel publication path.
 *
 * Concurrent calls for the same output JSON path are serialized per-output via
 * a FIFO queue; concurrent calls for distinct outputs run in parallel.
 */
export interface ContractEmitOptions {
  /** The already-loaded config. Callers own loading; this operation never reads it from disk. */
  readonly config: PrismaNextConfig;
  /** Directory the caller was invoked from. */
  readonly cwd: string;
  /**
   * Path to the prisma.config.ts file. Used to find the project manifest
   * whose dependencies decide the import specifiers in emitted files; the
   * config itself is never read from it. Omit it and the manifest is looked up
   * from the directory the artifacts are written to, which is the package that
   * will import them.
   */
  readonly configPath?: string;
  /**
   * Directory to write contract artifacts into. When set, `contract.json` and
   * `contract.d.ts` are written inside this directory, taking precedence over
   * any output path from the loaded config. The value must be an absolute path;
   * resolution against cwd is the caller's responsibility.
   */
  readonly outputPath?: string;
  /** Optional AbortSignal for cancelling the in-flight emit */
  readonly signal?: AbortSignal;
  /** Optional progress callback for observing source-resolution and emit spans */
  readonly onProgress?: OnControlProgress;
}

/**
 * Result from the standalone executeContractEmit function.
 *
 * Always describes the bytes that were just published to disk. Failures throw
 * (config / source-resolution / emit / publish) — callers do not need to
 * branch on a result discriminator.
 */
export interface ContractEmitResult {
  /** Hash of the storage contract (schema-level) */
  readonly storageHash: string;
  /** Hash of the execution contract (if execution section exists) */
  readonly executionHash?: string;
  /** Hash of the profile (target+extensions) */
  readonly profileHash: string;
  /** Paths to the emitted files */
  readonly files: {
    /** Path to the emitted contract.json file */
    readonly json: string;
    /** Path to the emitted contract.d.ts file */
    readonly dts: string;
  };
  /**
   * Warning surfaced by `validateContractDeps` after a successful publication.
   * Callers (CLI, Vite plugin) decide how to render this; the operation does
   * not write to stderr itself. Undefined when no warning was raised.
   */
  readonly validationWarning?: string;
}

// ============================================================================
// Client Interface
// ============================================================================

/**
 * Programmatic control client for Prisma ORM operations.
 *
 * Lifecycle: `connect(connection)` before operations, `close()` when done.
 * Both `init()` and `connect()` are auto-called by operations if needed,
 * but `connect()` requires a connection so must be called explicitly first
 * unless a default connection was provided in options.
 *
 * @see README.md "Programmatic Control API" section for usage examples
 */
export interface ControlClient {
  /**
   * Initializes the client by creating the control plane stack,
   * family instance, and validating framework components.
   *
   * Idempotent (safe to call multiple times).
   * Called automatically by `connect()` if not already initialized.
   */
  init(): void;

  /**
   * Establishes a database connection.
   * Auto-calls `init()` if not already initialized.
   * Must be called before any database operations unless a default connection
   * was provided in options.
   *
   * @param connection - Driver-specific connection input (e.g., URL string for Postgres).
   *   If omitted, uses the default connection from options (if provided).
   * @throws If connection fails, already connected, driver is not configured,
   *   or no connection provided and no default connection in options.
   */
  connect(connection?: unknown): Promise<void>;

  /**
   * Closes the database connection.
   * Idempotent (safe to call multiple times).
   * After close(), can call `connect()` again with same or different URL.
   */
  close(): Promise<void>;

  /**
   * Verifies database marker matches the contract.
   * Compares storageHash and profileHash.
   *
   * @returns Structured result (ok: false for mismatch, not throwing)
   * @throws If not connected or infrastructure failure
   */
  verify(options: VerifyOptions): Promise<VerifyDatabaseResult>;

  /**
   * Verifies database schema satisfies the contract requirements.
   *
   * @param options.strict - If true, extra tables/columns are issues. Default: false
   * @returns Structured result with schema issues
   * @throws If not connected or infrastructure failure
   */
  schemaVerify(options: SchemaVerifyOptions): Promise<VerifyDatabaseSchemaResult>;

  /**
   * Signs the database with a contract signature.
   * Writes or updates the signature if schema verification passes.
   * Idempotent (no-op if signature already matches).
   *
   * @returns Structured result
   * @throws If not connected or infrastructure failure
   */
  sign(options: SignOptions): Promise<SignDatabaseResult>;

  /**
   * Initializes database schema from contract.
   * Uses additive-only policy (no destructive changes).
   *
   * @param options.mode - 'plan' to preview, 'apply' to execute
   * @returns Result pattern: Ok with planned/executed operations, NotOk with failure details
   * @throws If not connected, target doesn't support migrations, or infrastructure failure
   */
  dbInit(options: DbInitOptions): Promise<DbInitResult>;

  /**
   * Updates a database schema to match the current contract.
   * Creates the signature table if it does not exist. No preconditions required.
   * Allows additive, widening, and destructive operation classes.
   *
   * @param options.mode - 'plan' to preview, 'apply' to execute
   * @returns Result pattern: Ok with planned/executed operations, NotOk with failure details
   * @throws If not connected, target doesn't support migrations, or infrastructure failure
   */
  dbUpdate(options: DbUpdateOptions): Promise<DbUpdateResult>;

  /**
   * Verifies the database against every contract space (app + extensions).
   *
   * Loader → aggregate-verifier pipeline:
   * - The loader catches layout / drift / disjointness violations.
   * - The aggregate verifier surfaces marker-vs-on-disk drift and orphan
   *   markers, and (unless `skipSchema` is true) per-space schema
   *   verification with pre-projection (closes F23).
   *
   * @returns Result pattern: per-space verify results on success;
   *          structured CLI error on marker / loader failure.
   * @throws If not connected or infrastructure failure
   */
  dbVerify(options: DbVerifyOptions): Promise<ExecuteDbVerifyResult>;

  /**
   * Reads the contract marker from the database.
   * Returns null if no marker exists (fresh database).
   *
   * @throws If not connected or infrastructure failure
   */
  readMarker(): Promise<ContractMarkerRecord | null>;

  /**
   * Reads every marker row (one per contract space). Used by the
   * per-space verifier to detect orphan marker rows and marker-vs-on-disk
   * drift after a database connection has been established.
   */
  readAllMarkers(): Promise<ReadonlyMap<string, ContractMarkerRecord>>;

  /**
   * Reads the per-migration ledger journal for `space` in apply order.
   * Returns an empty array when the ledger store does not yet exist or
   * has no rows for that space.
   */
  readLedger(space?: string): Promise<readonly LedgerEntryRecord[]>;

  /**
   * Advances the database along the migration graph to the target contract.
   * Each migration runs in its own transaction with full execution checks.
   * Resume-safe: re-running after failure picks up from the last run migration.
   *
   * @param options.contract - The target contract to migrate to
   * @param options.migrationsDir - Root migrations directory (`migrations/` under the project)
   * @param options.refHash - Optional app-space ref override hash
   * @param options.refInvariants - Required invariants on the user-supplied ref
   * @param options.refName - Resolved name of the user-supplied app-space ref
   * @returns Result pattern: Ok with migration details, NotOk with failure details
   * @throws If not connected, target doesn't support migrations, or infrastructure failure
   */
  migrate(options: MigrateOptions): Promise<MigrateResult>;

  /**
   * Introspects the database schema.
   *
   * @returns Raw schema IR
   * @throws If not connected or infrastructure failure
   */
  introspect(options?: IntrospectOptions): Promise<unknown>;

  /**
   * Converts a schema IR to a schema view for CLI tree rendering.
   * Delegates to the family instance's toSchemaView method.
   *
   * @param schemaIR - The schema IR from introspect()
   * @returns CoreSchemaView if the family supports it, undefined otherwise
   */
  toSchemaView(schemaIR: unknown): CoreSchemaView | undefined;

  /**
   * Infers a PSL contract AST from an introspected schema IR.
   * Delegates to the family instance's inferPslContract method.
   *
   * @param schemaIR - The schema IR from introspect()
   * @returns PslDocumentAst if the family supports the capability, undefined otherwise
   */
  inferPslContract(schemaIR: unknown): PslDocumentAst | undefined;

  /**
   * Returns the assembled PSL block descriptors from the control stack — the full
   * set of extension-contributed top-level block descriptors. The CLI's
   * `contract infer` command threads these through to `printPsl` so
   * extension-contributed blocks in the inferred AST round-trip back to PSL
   * source. Forces `init()` so the stack is built before access.
   */
  getPslBlockDescriptors(): AuthoringPslBlockDescriptorNamespace;

  /**
   * Renders a textual preview of a migration plan's operations for the CLI's
   * "DDL preview" output. Delegates to the family instance's
   * `toOperationPreview` method.
   *
   * @param operations - The migration plan operations to render
   * @returns OperationPreview if the family supports the capability, undefined otherwise
   */
  toOperationPreview(operations: readonly MigrationPlanOperation[]): OperationPreview | undefined;

  /**
   * Emits the contract to JSON and TypeScript declarations.
   * This is an offline operation that does NOT require a database connection.
   * Uses `init()` to create the stack but does NOT call `connect()`.
   *
   * @returns Result pattern: Ok with emit details, NotOk with failure details
   */
  emit(options: EmitOptions): Promise<EmitResult>;
}
