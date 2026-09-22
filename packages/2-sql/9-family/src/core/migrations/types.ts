import type { Contract } from '@internal/contract/types';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type {
  ContractSpace,
  ControlAdapterDescriptor,
  ControlExtensionDescriptor,
  MigrationOperationPolicy,
  MigrationPlan,
  MigrationPlannerConflict,
  MigrationPlannerFailureResult,
  MigrationPlannerSuccessResult,
  MigrationPlanOperation,
  MigrationRunnerExecutionChecks,
  MigrationRunnerFailure,
  MigrationRunnerPerSpaceSuccessValue,
  MigrationRunnerResult,
  OperationContext,
  OpFactoryCall,
  SchemaDiffIssue,
  SchemaOwnership,
} from '@internal/framework-components/control';
import type { AggregateMigrationEdgeRef } from '@internal/migration-tools/aggregate';
import type {
  SqlControlDriverInstance,
  SqlStorage,
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
} from '@internal/sql-contract/types';
import type { SqlOperationDescriptors } from '@internal/sql-operations';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import type { Result } from '@internal/utils/result';
import type { SqlControlAdapter } from '../control-adapter';

export type AnyRecord = Readonly<Record<string, unknown>>;

export interface StorageTypePlanResult<TTargetDetails> {
  readonly operations: readonly SqlMigrationPlanOperation<TTargetDetails>[];
}

/**
 * Input for expanding parameterized native types.
 */
export interface ExpandNativeTypeInput {
  readonly nativeType: string;
  readonly codecId?: string;
  readonly typeParams?: Record<string, unknown>;
}

/**
 * Input for resolving an identity-value SQL literal used to backfill existing rows when
 * adding a NOT NULL column without an explicit default.
 *
 * "Identity value" in the algebraic (monoid) sense: the neutral element for the type
 * (0 for numbers, '' for strings, false for booleans, etc.).
 */
export interface ResolveIdentityValueInput {
  readonly nativeType: string;
  readonly codecId?: string;
  readonly typeParams?: Record<string, unknown>;
}

/**
 * Per-field lifecycle event a codec hook can react to.
 *
 * Fired during app-space migration emission as the SQL family diffs the
 * prior contract against the new contract. See
 * `docs/architecture docs/adrs/ADR 213 - Codec lifecycle hooks.md`
 * for the wiring contract.
 *
 * - `'added'`     — the field is present in the new contract but not the prior.
 * - `'dropped'`   — the field is present in the prior contract but not the new.
 * - `'altered'`   — the field is present in both and any property other than
 *                   `codecId` differs. Codec-id changes are a v1 non-goal:
 *                   when only `codecId` differs, no `'altered'` event fires.
 */
export type FieldEvent = 'added' | 'dropped' | 'altered';

/**
 * Context passed to {@link CodecControlHooks.onFieldEvent}.
 *
 * `namespaceId`, `tableName`, and `fieldName` are always populated; `priorTable` /
 * `priorField` carry the prior contract's view of the table and column
 * (present for `'dropped'` and `'altered'`); `newTable` / `newField`
 * carry the new contract's view (present for `'added'` and `'altered'`).
 *
 * The hook only ever receives app-space contract IR — extension-space
 * fields are scoped out by the API: the hook is wired at the
 * application emitter only.
 */
export interface FieldEventContext {
  readonly namespaceId: string;
  readonly tableName: string;
  readonly fieldName: string;
  readonly priorTable?: StorageTable;
  readonly newTable?: StorageTable;
  readonly priorField?: StorageColumn;
  readonly newField?: StorageColumn;
}

export interface CodecControlHooks<TTargetDetails = unknown> {
  /**
   * `schema` is typed as the family-level `SqlSchemaIRNode` (not the concrete
   * `SqlSchemaIR` class) because the actual value handed in is whatever
   * per-namespace node the calling target's tree shape produces — a flat
   * `SqlSchemaIR` for SQLite, a `PostgresNamespaceSchemaNode` for Postgres —
   * read structurally for its `tables`/`nativeEnums` fields. Hooks that need
   * the concrete Postgres shape narrow via `PostgresNamespaceSchemaNode.is(schema)`.
   */
  planTypeOperations?: (options: {
    readonly typeName: string;
    readonly typeInstance: StorageTypeInstance;
    readonly contract: Contract<SqlStorage>;
    readonly schema: SqlSchemaIRNode;
    readonly schemaName?: string;
    readonly policy: MigrationOperationPolicy;
  }) => StorageTypePlanResult<TTargetDetails>;
  verifyType?: (options: {
    readonly typeName: string;
    readonly typeInstance: StorageTypeInstance;
    readonly schema: SqlSchemaIRNode;
    readonly schemaName?: string;
  }) => readonly SchemaDiffIssue[];
  introspectTypes?: (options: {
    readonly driver: SqlControlDriverInstance<string>;
    readonly schemaName?: string;
  }) => Promise<Record<string, StorageTypeInstance>>;
  /**
   * Expands a parameterized native type to its full SQL representation.
   * Used by schema verification to compare contract types against database types.
   *
   * For example, expands:
   * - { nativeType: 'character varying', typeParams: { length: 255 } } -> 'character varying(255)'
   * - { nativeType: 'numeric', typeParams: { precision: 10, scale: 2 } } -> 'numeric(10,2)'
   *
   * Returns the expanded type string, or the original nativeType if no expansion is needed.
   */
  expandNativeType?: (input: ExpandNativeTypeInput) => string;
  /**
   * Resolves the identity value (monoid neutral element) as a SQL literal for safely adding
   * a NOT NULL column without an explicit default to a non-empty table.
   *
   * Return semantics:
   * - string: use this literal
   * - null: explicitly no safe identity value is known; fall back to another strategy
   * - undefined: no opinion; planner may use built-in fallbacks
   */
  resolveIdentityValue?: (input: ResolveIdentityValueInput) => string | null | undefined;
  /**
   * Reacts to per-field added / dropped / altered events as the app-space
   * emitter diffs the prior contract against the new contract. Returned
   * ops are inlined into the app-space migration's `ops.json` alongside
   * the user's structural ops.
   *
   * Synchronous. Each returned op must carry its own `invariantId`. Hooks
   * are dispatched per `(table, field)` based on the field's `codecId`
   * (the new field's codec for `'added'` / `'altered'`; the prior field's
   * codec for `'dropped'`).
   *
   * See `docs/architecture docs/adrs/ADR 213 - Codec lifecycle hooks.md`
   * for the wiring contract and the deterministic ordering rule.
   */
  onFieldEvent?: (event: FieldEvent, ctx: FieldEventContext) => readonly OpFactoryCall[];
}

export interface SqlControlExtensionDescriptor<TTargetId extends string>
  extends ControlExtensionDescriptor<'sql', TTargetId> {
  readonly queryOperations?: () => SqlOperationDescriptors;
  /**
   * Schema-contributing extensions opt into the per-space planner / runner /
   * verifier by setting this field. Extensions without it are codec-only or
   * query-ops-only — today's behaviour preserved.
   *
   * The shape comes from `@internal/framework-components/control`
   * (`ContractSpace`) — contract-space identity is a framework concept,
   * not a SQL-specific one. The SQL family specialises the generic to
   * `Contract<SqlStorage>` so descriptor authors continue to see a
   * typed contract value.
   */
  readonly contractSpace?: ContractSpace<Contract<SqlStorage>>;
}

export interface SqlControlAdapterDescriptor<TTargetId extends string>
  extends ControlAdapterDescriptor<'sql', TTargetId, SqlControlAdapter<TTargetId>> {
  readonly queryOperations?: () => SqlOperationDescriptors;
}

export interface SqlMigrationPlanOperationStep {
  readonly description: string;
  readonly sql: string;
  /**
   * Optional parameter values bound at execution time. The runner forwards
   * these to `driver.query(sql, params ?? [])`, so step authors can use
   * placeholder syntax (`$1`, `$2`, …) instead of inlining literals into
   * the SQL string. Reuses the driver's parameter binder rather than
   * rolling per-target literal serialization for every type the planner
   * may emit.
   */
  readonly params?: readonly unknown[];
  readonly meta?: AnyRecord;
}

/**
 * Minimal shape every SQL-family target must conform to for its per-operation
 * `target.details` payload. Each SQL operation addresses a named database
 * object in some schema; targets (Postgres, MySQL, SQLite, …) extend this
 * shape with their own fields (e.g. Postgres adds `objectType` and optional
 * `table`).
 */
export interface SqlPlanTargetDetails {
  readonly schema: string;
  readonly name: string;
}

export interface SqlMigrationPlanOperationTarget<TTargetDetails> {
  readonly id: string;
  readonly details?: TTargetDetails;
}

export interface SqlMigrationPlanOperation<TTargetDetails> extends MigrationPlanOperation {
  readonly summary?: string;
  readonly target: SqlMigrationPlanOperationTarget<TTargetDetails>;
  readonly precheck: readonly SqlMigrationPlanOperationStep[];
  readonly execute: readonly SqlMigrationPlanOperationStep[];
  readonly postcheck: readonly SqlMigrationPlanOperationStep[];
  readonly meta?: AnyRecord;
}

export interface SqlMigrationPlanContractInfo {
  readonly storageHash: string;
  readonly profileHash?: string;
}

export interface SqlMigrationPlan<TTargetDetails> extends MigrationPlan {
  /**
   * Contract space this plan applies to. The runner uses this to key the
   * `prisma_contract.marker` row it writes/reads (`space = <spaceId>`),
   * so per-extension plans hit per-extension marker rows instead of all
   * collapsing onto the app's row.
   *
   * App-plan callers pass `APP_SPACE_ID` (`'app'`); per-extension plans
   * pass the extension's space id. Required at every call site so the
   * type system surfaces every place that needs to thread the value
   * (rather than letting an `?? APP_SPACE_ID` fall-through silently
   * collapse per-space markers onto the `'app'` row).
   *
   * @see specs/framework-mechanism.spec.md § 2.
   */
  readonly spaceId: string;
  /**
   * Origin contract identity that the plan expects the database to currently be at.
   * If omitted or null, the runner skips origin validation entirely.
   */
  readonly origin?: SqlMigrationPlanContractInfo | null;
  /**
   * Destination contract identity that the plan intends to reach.
   */
  readonly destination: SqlMigrationPlanContractInfo;
  readonly operations: readonly (
    | SqlMigrationPlanOperation<TTargetDetails>
    | Promise<SqlMigrationPlanOperation<TTargetDetails>>
  )[];
  /**
   * Sorted, deduplicated invariant ids declared by this plan's data-transform
   * ops. Required at the SQL-family layer (the SQL runners consume this as
   * the source of truth for marker writes and self-edge no-op checks); the
   * framework-level {@link MigrationPlan.providedInvariants} stays optional
   * because `db init` / `db update` plans don't have a corresponding
   * migration manifest.
   */
  readonly providedInvariants: readonly string[];
  readonly meta?: AnyRecord;
}

export type SqlPlannerConflictKind =
  | 'typeMismatch'
  | 'nullabilityConflict'
  | 'indexIncompatible'
  | 'rlsPolicyIncompatible'
  | 'foreignKeyConflict'
  | 'missingButNonAdditive'
  | 'unsupportedOperation'
  | 'controlPolicySuppressedCall'
  | 'tableNameCaseChanged';

export interface SqlPlannerConflictLocation {
  readonly namespaceId?: string;
  readonly entityKind?: string;
  readonly entityName?: string;
  readonly column?: string;
  readonly index?: string;
  readonly constraint?: string;
  readonly rlsPolicy?: string;
}

export interface SqlPlannerConflict extends MigrationPlannerConflict {
  readonly kind: SqlPlannerConflictKind;
  readonly location?: SqlPlannerConflictLocation;
  readonly meta?: AnyRecord;
}

export interface SqlPlannerSuccessResult<TTargetDetails>
  extends Omit<MigrationPlannerSuccessResult, 'plan'> {
  readonly kind: 'success';
  readonly plan: SqlMigrationPlan<TTargetDetails>;
}

export interface SqlPlannerFailureResult extends Omit<MigrationPlannerFailureResult, 'conflicts'> {
  readonly kind: 'failure';
  readonly conflicts: readonly SqlPlannerConflict[];
}

export type SqlPlannerResult<TTargetDetails> =
  | SqlPlannerSuccessResult<TTargetDetails>
  | SqlPlannerFailureResult;

export interface SqlMigrationPlannerPlanOptions {
  readonly contract: Contract<SqlStorage>;
  /**
   * The "from"/live schema as the target's introspected node (SQLite a flat
   * `SqlSchemaIR`, Postgres a `PostgresDatabaseSchemaNode` root). Structure-aware
   * consumers narrow the concrete shape before walking it.
   */
  readonly schema: SqlSchemaIRNode;
  readonly policy: MigrationOperationPolicy;
  readonly schemaName?: string;
  /**
   * Contract space the plan applies to. The planner stamps this onto
   * the produced {@link SqlMigrationPlan.spaceId} so the runner keys
   * the marker row by the right space. App-plan callers pass
   * `APP_SPACE_ID`; per-extension callers pass the extension's space
   * id.
   */
  readonly spaceId: string;
  /**
   * The "from" contract (state the planner assumes the database starts at),
   * or `null` for reconciliation flows that have no prior contract.
   *
   * Required at every call site so the structural fact "I have a prior
   * contract / I don't" is visible in the type. `migration plan` reads the
   * predecessor's contract from the snapshot store by its storage hash and
   * passes the parsed value; `db update` / `db init` reconcile against the
   * live schema and pass `null`. Strategies that
   * need from/to column-shape comparisons (unsafe type change, nullability
   * tightening) use this to decide whether to emit `dataTransform`
   * placeholders; they short-circuit when it is `null`.
   *
   * Planners also derive the "from" identity they stamp onto the produced
   * plan's `describe()` as `fromContract?.storage.storageHash ?? null`.
   */
  readonly fromContract: Contract<SqlStorage> | null;
  /**
   * POSIX-relative path from the migration package dir to
   * `migrations/snapshots`, e.g. `'../../snapshots'`. Threaded straight
   * into the produced plan's `renderTypeScript()` metadata so the
   * scaffold's contract-snapshot imports point at the deduplicated store.
   */
  readonly snapshotsImportPath: string;
  /**
   * Active framework components participating in this composition.
   * Each component is target-bound so SQL targets can dispatch
   * component-owned planning behaviour from the same descriptor list.
   * All components must have matching familyId ('sql') and targetId.
   */
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  /**
   * Ownership oracle over the whole contract-space composition (the passive
   * aggregate). The planner asks it, per live extra node, whether any space
   * declares that entity: a sibling-owned node is left untouched, an unowned
   * node is a genuine extra it may drop under a destructive policy. The
   * planner holds no list of other spaces' names — ownership lives in the
   * aggregate; it only asks. Absent for a single-space plan handed no
   * aggregate. See {@link SchemaOwnership}.
   */
  readonly ownership?: SchemaOwnership;
}

export interface SqlMigrationPlanner<TTargetDetails> {
  plan(options: SqlMigrationPlannerPlanOptions): SqlPlannerResult<TTargetDetails>;
}

export interface SqlMigrationRunnerExecuteCallbacks<TTargetDetails> {
  onOperationStart?(operation: SqlMigrationPlanOperation<TTargetDetails>): void;
  onOperationComplete?(operation: SqlMigrationPlanOperation<TTargetDetails>): void;
}

export interface SqlMigrationRunnerExecuteOptions<TTargetDetails> {
  readonly plan: SqlMigrationPlan<TTargetDetails>;
  readonly driver: SqlControlDriverInstance<string>;
  /**
   * Logical contract space this plan applies to. When omitted the
   * runner derives the space from {@link SqlMigrationPlan.spaceId};
   * when supplied, the runner asserts it matches `plan.spaceId` so a
   * caller cannot accidentally write the marker row for a different
   * space than the plan was produced for.
   */
  readonly space?: string;
  /**
   * Destination contract IR.
   * Must correspond to `plan.destination` and is used for schema verification and marker/ledger writes.
   */
  readonly destinationContract: Contract<SqlStorage>;
  /**
   * Execution-time policy that defines which operation classes are allowed.
   * The runner validates each operation against this policy before execution.
   */
  readonly policy: MigrationOperationPolicy;
  readonly schemaName?: string;
  readonly strictVerification?: boolean;
  readonly callbacks?: SqlMigrationRunnerExecuteCallbacks<TTargetDetails>;
  readonly context?: OperationContext;
  /**
   * Execution-time checks configuration.
   * All checks default to `true` (enabled) when omitted.
   */
  readonly executionChecks?: MigrationRunnerExecutionChecks;
  /**
   * Active framework components participating in this composition.
   * Each component is target-bound so SQL targets can dispatch
   * component-owned execution behaviour from the same descriptor list.
   * All components must have matching familyId ('sql') and targetId.
   */
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  /**
   * Per-edge breakdown from graph-walk planning. When present, the runner
   * writes one ledger row per edge instead of one collapsed row per apply.
   */
  readonly migrationEdges: readonly AggregateMigrationEdgeRef[];
}

export type SqlMigrationRunnerErrorCode =
  | 'MIGRATION.DESTINATION_CONTRACT_MISMATCH'
  | 'MIGRATION.LEGACY_MARKER_SHAPE'
  | 'MIGRATION.MARKER_ORIGIN_MISMATCH'
  | 'MIGRATION.MARKER_CAS_FAILURE'
  | 'MIGRATION.POLICY_VIOLATION'
  | 'MIGRATION.PRECHECK_FAILED'
  | 'MIGRATION.POSTCHECK_FAILED'
  | 'MIGRATION.SCHEMA_VERIFY_FAILED'
  | 'MIGRATION.FOREIGN_KEY_VIOLATION'
  | 'MIGRATION.EXECUTION_FAILED';

export interface SqlMigrationRunnerFailure extends MigrationRunnerFailure {
  readonly code: SqlMigrationRunnerErrorCode;
  readonly meta?: AnyRecord;
}

export interface SqlMigrationRunnerSuccessValue extends MigrationRunnerPerSpaceSuccessValue {}

export type SqlMigrationRunnerResult = Result<
  SqlMigrationRunnerSuccessValue,
  SqlMigrationRunnerFailure
>;

export interface SqlMigrationRunner<TTargetDetails> {
  /**
   * Apply one or more per-space migration plans, opening and managing the
   * outer transaction (and any target-specific connection-level setup, e.g.
   * SQLite's `PRAGMA foreign_keys` toggle). An apply that targets one space
   * passes a one-element `perSpaceOptions` list.
   *
   * The caller orders the input list (typically via the aggregate planner's
   * `applyOrder`: extensions alphabetical, then app). A failure on any space
   * rolls back every space's writes.
   *
   * Each entry must reference the same `driver` as the top-level `driver`
   * (the connection the outer transaction is open on).
   */
  execute(options: {
    readonly driver: SqlControlDriverInstance<string>;
    readonly perSpaceOptions: ReadonlyArray<SqlMigrationRunnerExecuteOptions<TTargetDetails>>;
  }): Promise<MigrationRunnerResult>;

  /**
   * Apply a single migration plan against an already-open connection
   * **without** opening a transaction. The caller is responsible for
   * wrapping the call (and any siblings) in `BEGIN` / `COMMIT` /
   * `ROLLBACK`. Used by {@link SqlMigrationRunner.execute} to fan out
   * across contract spaces inside one outer transaction.
   *
   * Idempotent control-table setup (`prisma_contract.*`) and marker
   * writes use `options.space` to address the per-space marker row.
   */
  executeOnConnection(
    options: SqlMigrationRunnerExecuteOptions<TTargetDetails>,
  ): Promise<SqlMigrationRunnerResult>;
}

export interface CreateSqlMigrationPlanOptions<TTargetDetails> {
  readonly targetId: string;
  /**
   * Contract space this plan applies to. Mirrors {@link SqlMigrationPlan.spaceId}.
   */
  readonly spaceId: string;
  readonly origin?: SqlMigrationPlanContractInfo | null;
  readonly destination: SqlMigrationPlanContractInfo;
  readonly operations: readonly SqlMigrationPlanOperation<TTargetDetails>[];
  /**
   * Sorted, deduplicated invariant ids for this plan; mirrors the required
   * field on {@link SqlMigrationPlan}. Callers without a migration manifest
   * (`db init`, `db update`, planner-built plans) pass `[]`.
   */
  readonly providedInvariants: readonly string[];
  readonly meta?: AnyRecord;
}
