import type { Contract } from '@internal/contract/types';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type {
  AppliedMigrationStatement,
  ControlAdapterInstance,
  ControlFamilyInstance,
  MigrationOperationPolicy,
  MigrationPlan,
  MigrationPlannerConflict,
  MigrationPlanOperation,
  ResolvedMigrationStatement,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import type { Result } from '@internal/utils/result';
import type { PathDecision } from '../migration-graph';
import type { ContractMarkerRecordLike } from './marker-types';
import type { ContractSpaceAggregate } from './types';

/**
 * Caller-provided policy for {@link planMigration}. Today this carries
 * just one knob:
 *
 * - `ignoreGraphFor`: `Set<spaceId>`. For listed contract spaces, the planner
 *   forces **`planFromDiff`** (fabricate a plan from a diff against the
 *   contract IR via `familyInstance.createPlanner(...).plan(...)`)
 *   regardless of whether a graph is available. The CLI's daily-driver
 *   `db init` / `db update` pipelines pass `new Set([aggregate.app.spaceId])`
 *   to keep today's app-space behaviour: the user's authored
 *   `migrations/` directory is **not** walked for the app space, the
 *   plan is fabricated on the fly. Extension spaces are walked.
 *
 *   Listing a contract space here whose `headRef.invariants` is non-empty is
 *   a `policyConflict` — a diff-fabricated plan cannot satisfy authored
 *   invariants.
 */
export interface CallerPolicy {
  readonly ignoreGraphFor: ReadonlySet<string>;
}

/**
 * Snapshot of the live database state the planner needs to drive
 * strategy selection.
 *
 * - `markersBySpaceId`: per-space marker rows. Absent entry = no
 *   marker yet (greenfield space). The planner treats the marker's
 *   `storageHash` as the recorded-path resolution's `from` node, falling
 *   back to {@link import('../constants').EMPTY_CONTRACT_HASH} when absent.
 * - `schemaIntrospection`: the family's full live schema IR. Fed into
 *   `planFromDiff` in full; the aggregate itself is handed to the planner as
 *   an ownership oracle, which the planner asks per live extra node whether
 *   any space owns it — no schema is pruned up front, and the planner never
 *   drops a node a sibling space owns.
 *
 * Callers (CLI commands) gather this via the family's
 * `readAllMarkers` + `introspect` calls before invoking the planner.
 * The planner itself does not touch the database.
 */
export interface AggregateCurrentDBState {
  readonly markersBySpaceId: ReadonlyMap<string, ContractMarkerRecordLike | null>;
  readonly schemaIntrospection: unknown;
}

/**
 * Inputs to {@link planMigration}.
 *
 * The planner is target-agnostic but family-aware: per-space
 * `planFromDiff` delegates to the family's `createPlanner(adapter).plan(...)`,
 * which is why `adapter`, `migrations` (the
 * `TargetMigrationsCapability`), and `frameworkComponents` are all
 * threaded through. (`frameworkComponents` is passed verbatim into
 * `planner.plan(...)` per ADR 212; the planner does not interpret it.)
 *
 * The planner does **not** receive a `targetId` separately —
 * it reads `aggregate.targetId` and stamps it onto every emitted
 * `MigrationPlan` from construction. No placeholder, no patch step.
 */
export interface PlannerInput<TFamilyId extends string, TTargetId extends string> {
  readonly aggregate: ContractSpaceAggregate;
  readonly currentDBState: AggregateCurrentDBState;
  readonly adapter: ControlAdapterInstance<TFamilyId, TTargetId>;
  readonly migrations: TargetMigrationsCapability<
    TFamilyId,
    TTargetId,
    ControlFamilyInstance<TFamilyId, unknown>
  >;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  readonly callerPolicy: CallerPolicy;
  readonly operationPolicy: MigrationOperationPolicy;
  /**
   * What the application space's diff plan starts from: the contract the
   * database is at, when the caller knows it, and the statements the user gave.
   * Other spaces plan with no origin contract and no statements. Statements need the app space
   * in `callerPolicy.ignoreGraphFor`; otherwise the planner refuses them with `policyConflict`.
   */
  readonly appSpace: AppSpacePlanningInputs;
}

/** See {@link PlannerInput.appSpace}. */
export interface AppSpacePlanningInputs {
  readonly fromContract: Contract | null;
  readonly statements: readonly ResolvedMigrationStatement[];
}

/**
 * Per-space output of the planner. The runner ingests this
 * shape directly via a thin `toRunnerInput` adapter at the CLI.
 *
 * - `plan`: ready-to-execute `MigrationPlan` with `targetId` already
 *   set from `aggregate.targetId`.
 * - `displayOps`: same operation list, surfaced separately so plan-mode
 *   output can render without touching the runner-bound `plan`.
 * - `destinationContract`: the typed contract value the runner uses
 *   for post-apply verification. For the app space, the user's
 *   contract; for extension spaces, the on-disk `contract.json`.
 * - `strategy`: which operation produced this plan — `'resolve-recorded-path'`
 *   (walked a recorded migration path), `'plan-from-diff'` (fabricated a
 *   plan from a state diff), or `'declared-state'` (the space ships no
 *   migration packages at all; the aggregate declares the no-op directly
 *   without invoking either). Surfaced for diagnostics; not consumed by
 *   the runner.
 */
/**
 * Per-edge metadata for the chain assembled by resolving a contract
 * space's recorded migration path. Lets `migrate` surface a per-migration
 * `applied[]` entry (preserving the `migrationsApplied` count semantics)
 * without re-walking the graph.
 *
 * `plan-from-diff`/`declared-state` plans leave this absent — they don't
 * have authored edges to surface (a single fabricated edge is used
 * instead, see {@link import('./fabricated-migration-edge').buildFabricatedMigrationEdge}).
 */
export interface AggregateMigrationEdgeRef {
  readonly migrationHash: string;
  readonly dirName: string;
  readonly from: string;
  readonly to: string;
  readonly operationCount: number;
  /**
   * Contract IR JSON of the edge's destination state, threaded from the
   * bundle's snapshot store entry (`resolveRecordedPath`) or the space's
   * destination contract (`planFromDiff`). Runners persist it as the
   * edge's ledger-linked contract row so database tooling can render
   * model-level diffs per applied migration; an edge's *before* state is
   * the previous row's snapshot by chain construction. Absent when the
   * source bundle's snapshot store entry cannot be resolved.
   */
  readonly destinationContractJson?: unknown;
}

export interface PerSpacePlan {
  readonly plan: MigrationPlan;
  readonly displayOps: readonly MigrationPlanOperation[];
  readonly destinationContract: Contract;
  readonly strategy: 'resolve-recorded-path' | 'plan-from-diff' | 'declared-state';
  readonly warnings?: readonly MigrationPlannerConflict[];
  /** The statements the plan applied; empty for a space planned without statements. */
  readonly appliedStatements: readonly AppliedMigrationStatement[];
  /**
   * Per-edge breakdown of the chain. `resolve-recorded-path` plans carry
   * one entry per authored edge; `plan-from-diff` and `declared-state`
   * plans carry a single fabricated edge.
   */
  readonly migrationEdges: readonly AggregateMigrationEdgeRef[];
  /**
   * Path decision data used to select the chain (alternative count,
   * tie-break reasons, required/satisfied invariants, per-edge
   * invariants). Populated by `resolveRecordedPath`; absent for
   * `plan-from-diff`/`declared-state` plans.
   *
   * `migrate` surfaces this for the app space as
   * `MigrateSuccess.pathDecision` (back-compat with single-
   * space callers).
   */
  readonly pathDecision?: PathDecision;
}

export interface PlannerSuccess {
  readonly perSpace: ReadonlyMap<string, PerSpacePlan>;
  /**
   * `applyOrder` is the order the runner must walk per-space inputs.
   * Mirrors the existing `concatenateSpaceApplyInputs` convention:
   * extensions alphabetically by `spaceId`, then the app. Tests assert
   * on `MigrationRunnerFailure.failingSpace`, which is positional in
   * the runner's input array — preserving the literal ordering keeps
   * `failingSpace` attribution byte-for-byte.
   */
  readonly applyOrder: readonly string[];
}

/**
 * Discriminated failure variants for {@link planMigration}. Each
 * variant short-circuits the plan; per-space errors carry the
 * `spaceId` so the CLI can surface a precise envelope.
 */
export type PlannerError =
  | { readonly kind: 'extensionPathUnreachable'; readonly spaceId: string; readonly target: string }
  | {
      readonly kind: 'extensionPathUnsatisfiable';
      readonly spaceId: string;
      readonly missingInvariants: readonly string[];
    }
  | {
      readonly kind: 'planFromDiffFailed';
      readonly spaceId: string;
      readonly conflicts: readonly MigrationPlannerConflict[];
    }
  | { readonly kind: 'policyConflict'; readonly spaceId: string; readonly detail: string };

export type PlannerOutput = Result<PlannerSuccess, PlannerError>;
