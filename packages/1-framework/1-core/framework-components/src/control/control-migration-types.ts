/**
 * Core migration types for the framework control plane.
 *
 * These are family-agnostic, display-oriented types that provide a stable
 * vocabulary for CLI commands to work with migration planners and runners
 * without importing family-specific types.
 *
 * Family-specific types (e.g., SqlMigrationPlan) extend these base types
 * with additional fields for execution (precheck SQL, execute SQL, etc.).
 */

import type { Contract } from '@internal/contract/types';
import type { ImportRequirement } from '@internal/ts-render';
import type { Result } from '@internal/utils/result';
import type { TargetBoundComponentDescriptor } from '../shared/framework-components';
import type { ImportSpecifierResolver } from '../shared/import-specifier-resolver';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlFamilyInstance,
} from './control-instances';
import type { OperationContext } from './control-operation-results';

// ============================================================================
// Migration Package Metadata
// ============================================================================

/**
 * In-memory migration metadata envelope. Every migration is
 * content-addressed: the `migrationHash` is a hash over the metadata
 * envelope plus the operations list, computed at write time. There is no
 * draft state — a migration directory either exists with fully attested
 * metadata or it does not.
 *
 * When the planner cannot lower an operation because of an unfilled
 * `placeholder(...)` slot, the migration is still written with
 * `migrationHash` hashed over `ops: []`. Re-running self-emit after the
 * user fills the placeholder produces a *different* `migrationHash`
 * (committed to the real ops); this is intentional.
 *
 * The on-disk JSON shape in `migration.json` matches this type
 * field-for-field — `JSON.stringify(metadata, null, 2)` is the canonical
 * writer output (defined in `@internal/migration-tools/io`).
 *
 * The manifest carries identity (`from`, `to`, `migrationHash`) but
 * not the full contract IRs themselves. The destination and predecessor
 * contracts resolve by hash through the shared content-addressed store
 * at `migrations/snapshots/<hex>/contract.json`. The runner depends only
 * on `migration.json` + `ops.json` per package (plus the project-root
 * head contract). See `docs/architecture docs/subsystems/7. Migration System.md`.
 */
export interface MigrationMetadata {
  readonly migrationHash: string;
  readonly from: string | null;
  readonly to: string;
  /**
   * Sorted, deduplicated list of `invariantId`s declared by the
   * migration's data-transform ops. Always present; an empty array
   * means the migration has no routing-visible data transforms.
   */
  readonly providedInvariants: readonly string[];
  readonly createdAt: string;
}

// ============================================================================
// Operation Classes and Policy
// ============================================================================

/**
 * Migration operation classes define the safety level of an operation.
 * - 'additive': Adds new structures without modifying existing ones (safe)
 * - 'widening': Relaxes constraints or expands types (generally safe)
 * - 'destructive': Removes or alters existing structures (potentially unsafe)
 * - 'data': Data transformation operation (e.g., backfill, type conversion)
 */
export type MigrationOperationClass = 'additive' | 'widening' | 'destructive' | 'data';

/**
 * Policy defining which operation classes are allowed during a migration.
 */
export interface MigrationOperationPolicy {
  readonly allowedOperationClasses: readonly MigrationOperationClass[];
}

// ============================================================================
// Plan Types (Display-Oriented)
// ============================================================================

/**
 * A single migration operation for display purposes.
 * Contains only the fields needed for CLI output (tree view, JSON envelope).
 */
export interface MigrationPlanOperation {
  /** Unique identifier for this operation (e.g., "table.users.create"). */
  readonly id: string;
  /** Human-readable label for display in UI/CLI (e.g., "Create table users"). */
  readonly label: string;
  /** The class of operation (additive, widening, destructive). */
  readonly operationClass: MigrationOperationClass;
  /**
   * Optional opt-in routing identity for data-transform operations.
   * Presence opts the transform into invariant-aware routing; absence
   * means it is path-dependent and not referenceable from refs.
   *
   * Lives on the base op so the manifest emitter and
   * `deriveProvidedInvariants` can read it without depending on a
   * target-specific shape. Schema-DDL ops (additive / widening /
   * destructive) leave it undefined.
   */
  readonly invariantId?: string;
}

// ============================================================================
// Planner IR — Op Factory Calls
// ============================================================================

/**
 * Framework-level contract for a single factory call in a target's planner
 * IR — the canonical shape for any node participating in the two-renderer
 * pattern (source-text rendering for `migration.ts` + runtime-op derivation
 * for `ops.json`).
 *
 * Implementations declare:
 *
 *   - **Identity / display metadata** (`factoryName`, `operationClass`,
 *     `label`) used by CLI summaries and the issue planner.
 *   - **`renderTypeScript()`** — emit the call as a TypeScript expression
 *     suitable for inclusion in a generated `migration.ts`. Polymorphic
 *     across postgres / mongo / sqlite / extension-owned calls.
 *   - **`importRequirements()`** — the symbols this rendered expression
 *     pulls in. Aggregated and deduplicated by the top-level renderer
 *     into a single import block per file.
 *   - **`toOp()`** — lower the call to a runtime
 *     `MigrationPlanOperation`. Returns the framework base; concrete
 *     implementations narrow via covariant return (e.g. SQL targets
 *     return `SqlMigrationPlanOperation<TTargetDetails>`).
 *
 * Each domain (target, extension) defines its own set of concrete `*Call`
 * classes that implement this interface — typically by extending
 * {@link import('@internal/ts-render').TsExpression} and adding the
 * concrete `toOp()` body. Extensions can implement the interface
 * directly without depending on a target's package-private base.
 *
 * @see ADR 195 — Planner IR with two renderers.
 */
export interface OpFactoryCall {
  /** The name of the factory that would produce this call's runtime op. */
  readonly factoryName: string;
  /** The operation's safety class (additive, widening, destructive, data). */
  readonly operationClass: MigrationOperationClass;
  /** Human-readable label for CLI output and diagnostics. */
  readonly label: string;
  /**
   * Render this call as a TypeScript expression suitable for inclusion in
   * a generated `migration.ts`. The output is composed alongside other
   * calls' rendered expressions inside the migration's `operations`
   * array.
   */
  renderTypeScript(): string;
  /**
   * Import requirements pulled in by the rendered TypeScript expression.
   * Aggregated and deduplicated across all calls into a single import
   * block per file.
   */
  importRequirements(): readonly ImportRequirement[];
  /**
   * Lower this call to a runtime migration plan operation suitable for
   * execution / inclusion in `ops.json`. Concrete implementations narrow
   * the return type via covariant return (e.g. SQL targets return
   * `SqlMigrationPlanOperation<TTargetDetails>`). May return a Promise when
   * the lowering requires async codec resolution (e.g. DDL with literal defaults).
   */
  toOp(): MigrationPlanOperation | Promise<MigrationPlanOperation>;
}

// ============================================================================
// Plan Types (Display-Oriented)
// ============================================================================

/**
 * A migration plan for display purposes.
 * Contains only the fields needed for CLI output (summary, JSON envelope).
 */
export interface MigrationPlan {
  /** The target ID this plan is for (e.g., 'postgres'). */
  readonly targetId: string;
  /**
   * Contract space this plan applies to. Runners cross-check
   * `options.space` against `plan.spaceId` so the marker row gets keyed
   * by the right space when applying via {@link MigrationRunner.execute}.
   *
   * Optional because not every plan carries a space id; when present,
   * runners enforce that it matches `options.space`.
   */
  readonly spaceId?: string;
  /**
   * Origin contract identity that the plan expects the database to currently be at.
   * If omitted or null, the runner skips origin validation entirely.
   */
  readonly origin?: {
    readonly storageHash: string;
    readonly profileHash?: string;
  } | null;
  /** Destination contract identity that the plan intends to reach. */
  readonly destination: {
    readonly storageHash: string;
    readonly profileHash?: string;
  };
  /** Ordered list of operations to execute. May contain Promises for ops that require async codec resolution. */
  readonly operations: readonly (MigrationPlanOperation | Promise<MigrationPlanOperation>)[];
  /**
   * Sorted, deduplicated invariant ids declared by this plan's data-transform
   * ops. Authored migrations carry the canonical value from
   * `migration.json.providedInvariants`; planner-built plans (`db init`,
   * `db update`) omit it (the runner treats it as `[]`). Runners read this
   * field for marker writes and self-edge no-op detection rather than
   * re-deriving from `operations`, since the manifest is the canonical
   * source for the invariant set across all runners (postgres, sqlite,
   * mongo).
   */
  readonly providedInvariants?: readonly string[];
}

/**
 * A migration plan that can also render itself back to user-editable
 * TypeScript source (a `migration.ts` file).
 *
 * Planners produce this richer shape so that CLI commands can both:
 *  - hand the plan to the runner for execution (via `MigrationPlan`), and
 *  - materialize the plan as an editable source file via `renderTypeScript()`.
 *
 * User-authored migrations (`Migration` subclasses) satisfy `MigrationPlan`
 * but not this interface: they are already the source.
 */
export interface MigrationPlanWithAuthoringSurface extends MigrationPlan {
  /**
   * Render this plan back to TypeScript source suitable for writing to
   * `migration.ts`. Output may start with a shebang; when it does, the caller
   * should make the resulting file executable.
   *
   * `resolveImportSpecifier` rewrites every package name the rendered file
   * imports for the import root the consuming application installed (ADR
   * 242), exactly as the same resolver does for `contract.d.ts` — a
   * scaffolded migration is a file the application keeps, so every name in
   * it has to be one the application can resolve. The caller supplies it
   * rather than the plan capturing it, because the project a plan is
   * rendered into is known at the render call and not at planning time: `db
   * init` and `db update` build plans they never render. Pass
   * {@link import('../shared/import-specifier-resolver').keepInternalSpecifiers}
   * to emit workspace names unchanged.
   */
  renderTypeScript(resolveImportSpecifier: ImportSpecifierResolver): string;
}

// ============================================================================
// Planner Result Types
// ============================================================================

/**
 * A conflict detected during migration planning.
 */
export interface MigrationPlannerConflict {
  /** Kind of conflict (e.g., 'typeMismatch', 'nullabilityConflict'). */
  readonly kind: string;
  /** Human-readable summary of the conflict. */
  readonly summary: string;
  /** Optional explanation of why this conflict occurred. */
  readonly why?: string;
  /** Set when the conflict is an operation the policy does not allow: the class of that operation. */
  readonly refusedOperationClass?: MigrationOperationClass;
}

/**
 * Successful planner result with the migration plan.
 *
 * The plan is typed as `MigrationPlanWithAuthoringSurface` so the CLI can
 * uniformly ask any plan to render itself to TypeScript.
 */
export interface MigrationPlannerSuccessResult {
  readonly kind: 'success';
  readonly plan: MigrationPlanWithAuthoringSurface;
  readonly warnings?: readonly MigrationPlannerConflict[];
}

/**
 * Failed planner result with the list of conflicts.
 */
export interface MigrationPlannerFailureResult {
  readonly kind: 'failure';
  readonly conflicts: readonly MigrationPlannerConflict[];
}

/**
 * Union type for planner results.
 */
export type MigrationPlannerResult = MigrationPlannerSuccessResult | MigrationPlannerFailureResult;

// ============================================================================
// Runner Result Types
// ============================================================================

/**
 * Per-space success payload returned inside
 * {@link MigrationRunnerSuccessValue.perSpaceResults}.
 */
export interface MigrationRunnerPerSpaceSuccessValue {
  readonly operationsPlanned: number;
  readonly operationsExecuted: number;
}

/**
 * Success value for migration runner execution across one or more contract
 * spaces.
 */
export interface MigrationRunnerSuccessValue {
  readonly perSpaceResults: ReadonlyArray<{
    readonly space: string;
    readonly value: MigrationRunnerPerSpaceSuccessValue;
  }>;
}

/**
 * Failure details for migration runner execution.
 */
export interface MigrationRunnerFailure {
  /** Error code for the failure. */
  readonly code: string;
  /** Human-readable summary of the failure. */
  readonly summary: string;
  /** Optional explanation of why the failure occurred. */
  readonly why?: string;
  /** Optional metadata for debugging and UX (e.g., schema issues, SQL state). */
  readonly meta?: Record<string, unknown>;
  /**
   * Identifier of the space whose plan caused the rollback when
   * {@link MigrationRunner.execute} processes multiple spaces.
   */
  readonly failingSpace?: string;
}

/**
 * Result type for migration runner execution.
 */
export type MigrationRunnerResult = Result<MigrationRunnerSuccessValue, MigrationRunnerFailure>;

// ============================================================================
// Execution Checks Configuration
// ============================================================================

/**
 * Execution-time checks configuration for migration runners.
 * All checks default to `true` (enabled) when omitted.
 */
export interface MigrationRunnerExecutionChecks {
  /**
   * Whether to run prechecks before executing operations.
   * Defaults to `true` (prechecks are run).
   */
  readonly prechecks?: boolean;
  /**
   * Whether to run postchecks after executing operations.
   * Defaults to `true` (postchecks are run).
   */
  readonly postchecks?: boolean;
  /**
   * Whether to run idempotency probe (check if postcheck is already satisfied before execution).
   * Defaults to `true` (idempotency probe is run).
   */
  readonly idempotencyChecks?: boolean;
}

// ============================================================================
// Planner and Runner Interfaces
// ============================================================================

/**
 * The canonical schema-IR entity coordinate: which namespace, which kind of
 * entity, and which name. A bare entity name is not a unique identity —
 * two namespaces can each declare an entity of the same name, and one
 * namespace can declare two different-kind entities that share a name — so
 * every schema-IR consumer that addresses one live or declared entity does
 * it by this full triple.
 *
 * `entityKind` uses the same vocabulary as the contract storage's `entries`
 * dictionary — the same vocabulary
 * {@link import('../ir/storage').elementCoordinates} walks. This type has no
 * `plane`: schema IR is storage-only (contract IR spans domain and storage,
 * which is why its own coordinate type carries a plane), so a plane field
 * here would always read `'storage'` and say nothing.
 */
export interface SchemaEntityCoordinate {
  readonly namespaceId: string;
  readonly entityKind: string;
  readonly entityName: string;
}

/**
 * Contract-space ownership query the planner consults while planning one
 * space against a live database.
 *
 * A live schema node the planned space does not own surfaces from the diff
 * as `not-expected` (an extra). Before treating such a node as this plan's
 * to drop, the planner asks the ownership oracle whether *any* contract
 * space in the composition declares it: a node another (sibling) space owns
 * is not an orphan, so it is left untouched; a node no space owns is a
 * genuine extra the planner may drop under a destructive policy. (A node the
 * planned space itself owns is in its expected tree and never surfaces as an
 * extra, so a positive answer always means a sibling.)
 *
 * The oracle is a real domain object — the passive
 * {@link import('@internal/migration-tools/aggregate').ContractSpaceAggregate},
 * which answers this from its loaded contract spaces. The planner holds no
 * list of other spaces' names and no ownership rules of its own; it only
 * asks. Single-space plans (offline `migration plan`) pass an aggregate of
 * one — the same path, no special-casing.
 */
export interface SchemaOwnership {
  /**
   * True when some contract space in the composition declares a storage
   * entity at this coordinate.
   */
  declaresEntity(coordinate: SchemaEntityCoordinate): boolean;
}

/**
 * Migration planner interface for planning schema changes.
 * This is the minimal interface that CLI commands use.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export interface MigrationPlanner<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  plan(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    /**
     * The "from" contract (the state the planner assumes the database starts
     * at), or `null` for a baseline plan with no prior state.
     *
     * Planners derive any "from" identity they need to stamp onto the
     * produced plan's `describe()` from `fromContract?.storage.storageHash
     * ?? null`. They also pass this to data-safety strategies so they can
     * compare `from` and `to` column shapes (e.g. to detect unsafe type
     * changes).
     *
     * Required at every call site to make the structural fact "I have a
     * prior contract / I don't" visible in the type. Reconciliation
     * commands (`db init`, `db update`) introspect a live schema and pass
     * `null`; authoring commands (`migration plan`) read the predecessor's
     * contract from the snapshot store by its storage hash and pass the
     * parsed value.
     */
    readonly fromContract: Contract | null;
    /**
     * Active framework components participating in this composition.
     * Families/targets can interpret this list to derive family-specific metadata.
     * All components must have matching familyId and targetId.
     */
    readonly frameworkComponents: ReadonlyArray<
      TargetBoundComponentDescriptor<TFamilyId, TTargetId>
    >;
    /**
     * Contract space this plan applies to. Stamped onto the produced
     * plan so the runner keys the marker row by the right space when
     * executing. App-plan callers pass `APP_SPACE_ID` (`'app'`);
     * per-extension callers pass the extension's space id.
     */
    readonly spaceId: string;
    /**
     * Ownership oracle over the whole contract-space composition (the
     * passive aggregate). The planner asks it, per live extra node, whether
     * any space declares that entity: a sibling-owned node is left
     * untouched, an unowned node is a genuine extra. The planner holds no
     * list of other spaces' names — ownership lives in the aggregate; it
     * only asks. Absent for a single-space plan handed no aggregate.
     * See {@link SchemaOwnership}.
     */
    readonly ownership?: SchemaOwnership;
    /**
     * POSIX-relative path from the migration package dir to
     * `migrations/snapshots`, e.g. `'../../snapshots'`. Targets that render a
     * family authoring surface pass this straight through to the produced
     * plan's `renderTypeScript()` metadata. Callers that never render the
     * produced plan to TypeScript (diff-based reconciliation for `db init` /
     * `db update`) pass a placeholder — see `planFromDiff` in
     * `@internal/migration-tools`.
     */
    readonly snapshotsImportPath: string;
  }): MigrationPlannerResult;

  /**
   * Produce an empty migration with the target's authoring conventions.
   *
   * Used by `migration new` to scaffold a fresh `migration.ts`. The
   * returned plan has no operations; its `renderTypeScript()` yields a
   * stub the user can edit.
   *
   * `spaceId` is stamped onto the produced plan; reconciliation flows
   * (`db init`, `db update`) and authoring flows (`migration new`) all
   * pass it explicitly.
   */
  emptyMigration(
    context: MigrationScaffoldContext,
    spaceId: string,
  ): MigrationPlanWithAuthoringSurface;
}

/**
 * Migration runner interface for executing migration plans.
 * This is the minimal interface that CLI commands use.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
/**
 * Per-space input for {@link MigrationRunner.execute}.
 *
 * Each entry's `driver` must reference the same connection the outer
 * transaction is opened on (typically the same value as the top-level
 * `driver` on `execute`). An apply that targets one space passes a
 * one-element `perSpaceOptions` list.
 *
 * Family-specific runners (e.g. the SQL family's `SqlMigrationRunner`) define
 * a richer per-space option shape that is structurally compatible with this
 * one — additional optional fields (e.g. SQL's `schemaName`, `callbacks`) are
 * tolerated by the underlying runner without affecting cross-target wiring.
 */
export interface MigrationRunnerPerSpaceOptions<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  readonly space: string;
  readonly plan: MigrationPlan;
  readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
  readonly destinationContract: unknown;
  readonly policy: MigrationOperationPolicy;
  readonly executionChecks?: MigrationRunnerExecutionChecks;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  /**
   * When `false`, schema verification tolerates objects owned by sibling
   * contract spaces. Aggregate apply passes `false` per space because each
   * `destinationContract` describes only that space's slice.
   */
  readonly strictVerification?: boolean;
  /**
   * Paths and metadata forwarded to schema verification diagnostics.
   */
  readonly context?: OperationContext;
  /**
   * Per-edge breakdown from aggregate planning. Runners write one ledger row
   * per edge in walk order.
   */
  readonly migrationEdges: ReadonlyArray<{
    readonly migrationHash: string;
    readonly dirName: string;
    readonly from: string;
    readonly to: string;
    readonly operationCount: number;
    readonly destinationContractJson?: unknown;
  }>;
}

export interface MigrationRunner<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  /**
   * Apply one or more per-space migration plans against the configured driver.
   *
   * Each plan is trusted input. Callers are responsible for upstream
   * verification of the originating migration package — typically by
   * obtaining the package via `readMigrationPackage` from
   * `@internal/migration-tools/io`, which performs hash-integrity checks
   * at the load boundary. Runners do not re-verify plans and assume the
   * `(metadata, ops)` pairs on disk have not been tampered with since emit.
   *
   * Atomicity semantics differ by family: SQL targets open one outer
   * transaction across every space; Mongo iterates per-space without an
   * outer transaction and relies on per-space verify-gated marker atomicity.
   */
  execute(options: {
    readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
    readonly perSpaceOptions: ReadonlyArray<MigrationRunnerPerSpaceOptions<TFamilyId, TTargetId>>;
  }): Promise<MigrationRunnerResult>;
}

// ============================================================================
// Target Migrations Capability
// ============================================================================

/**
 * Optional capability interface for targets that support migrations.
 * Targets that implement migrations expose this via their descriptor.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 * @template TFamilyInstance - The family instance type (e.g., SqlControlFamilyInstance)
 */
export interface TargetMigrationsCapability<
  TFamilyId extends string = string,
  TTargetId extends string = string,
  TFamilyInstance extends ControlFamilyInstance<TFamilyId, unknown> = ControlFamilyInstance<
    TFamilyId,
    unknown
  >,
> {
  createPlanner(
    adapter: ControlAdapterInstance<TFamilyId, TTargetId>,
  ): MigrationPlanner<TFamilyId, TTargetId>;
  createRunner(family: TFamilyInstance): MigrationRunner<TFamilyId, TTargetId>;
  /**
   * Synthesizes a family-specific schema IR from a contract for offline planning.
   * The returned schema can be passed to `planner.plan({ schema })` as the "from" state.
   *
   * @param contract - The contract to convert, or null for a new project (empty schema).
   * @param frameworkComponents - Active framework components, used to derive database
   *   dependencies (e.g. extensions) that should be reflected in the schema IR.
   * @returns Family-specific schema IR (e.g., `SqlSchemaIR` for SQL targets).
   */
  contractToSchema(
    contract: Contract | null,
    frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>,
  ): unknown;
}

// ============================================================================
// Migration Scaffolding SPI
// ============================================================================

/**
 * Context for rendering migration source files.
 *
 * Kept minimal: only the paths a target might need to compute relative imports
 * (e.g. the contract `.d.ts` import for typed-contract builders). Passed to
 * `MigrationPlanner.emptyMigration(context)`.
 */
export interface MigrationScaffoldContext {
  /** Absolute path to the migration package directory. Used by targets to compute relative imports. */
  readonly packageDir: string;
  /** Absolute path to the contract.json file, if one exists. Used by targets that emit typed-contract imports. */
  readonly contractJsonPath?: string;
  /**
   * Storage hash of the "from" contract, or `null` for a baseline scaffold
   * with no prior state. Targets use this to populate `describe()` on the
   * rendered empty migration so that identity metadata is correctly
   * populated.
   */
  readonly fromHash: string | null;
  /**
   * Storage hash of the "to" contract. Same purpose as `fromHash` — threaded
   * through so the rendered class's `describe()` declares the correct
   * destination identity.
   */
  readonly toHash: string;
  /**
   * POSIX-relative path from the migration package dir to
   * `migrations/snapshots`, e.g. `'../../snapshots'` for an app-space
   * package. Targets that emit contract-snapshot imports pass this straight
   * through to their renderer's `RenderMigrationMeta.snapshotsImportPath`.
   */
  readonly snapshotsImportPath: string;
}
