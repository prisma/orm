/**
 * Backs `db init` / `db update`. Strategy: introspect → planMigration; planFromDiff-for-app + resolveRecordedPath-extensions; plan-mode + orphan-marker preflight.
 */

import type { Contract } from '@internal/contract/types';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyInstance,
  MigrationOperationPolicy,
  MigrationPlannerConflict,
  MigrationPlanOperation,
  OperationPreview,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { hasOperationPreview } from '@internal/framework-components/control';
import {
  type ContractSpaceAggregate,
  collectAggregateNamespaces,
  type PlannerError,
  planMigration,
} from '@internal/migration-tools/aggregate';
import type { SnapshotContentVerifier } from '@internal/migration-tools/contract-snapshot-store';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok } from '@internal/utils/result';
import { CliStructuredError } from '../../utils/cli-errors';
import type {
  DbInitFailure,
  DbInitResult,
  DbInitSuccess,
  DbUpdateFailure,
  DbUpdateResult,
  DbUpdateSuccess,
  OnControlProgress,
  PerSpaceExecutionEntry,
} from '../types';
import {
  type BuildAggregateInputs,
  buildContractSpaceAggregate,
} from './contract-space-aggregate-loader';
import { stripOperations } from './migration-helpers';
import { computePlanHash } from './plan-identity';
import {
  buildPerSpaceBreakdown,
  collectOrdered,
  type OrderedResolution,
  runMigration,
} from './run-migration';

/**
 * Span IDs emitted via `onProgress` during the run flow.
 * Stable identifiers consumed by the structured-output renderer and by
 * tests asserting on span ids. The `apply` span itself is owned by
 * the {@link runMigration} primitive — only the introspect / plan
 * spans are emitted directly here.
 */
const SPAN_IDS = {
  introspect: 'introspect',
  plan: 'plan',
} as const;

/**
 * Inputs shared by `db init` and `db update` run flows.
 *
 * Accepts the already-validated app contract + descriptor list — the
 * loader gathers the rest from disk + descriptors. The CLI is the
 * descriptor-import boundary; everything downstream is descriptor-free.
 */
export interface ExecuteRunOptions<TFamilyId extends string, TTargetId extends string> {
  readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
  readonly adapter: ControlAdapterInstance<TFamilyId, TTargetId>;
  readonly familyInstance: ControlFamilyInstance<TFamilyId, unknown>;
  readonly contract: Contract;
  readonly mode: 'plan' | 'apply';
  readonly migrations: TargetMigrationsCapability<
    TFamilyId,
    TTargetId,
    ControlFamilyInstance<TFamilyId, unknown>
  >;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  readonly migrationsDir: string;
  readonly extensions: ReadonlyArray<ControlExtensionDescriptor<TFamilyId, TTargetId>>;
  readonly targetId: TTargetId;
  readonly policy: MigrationOperationPolicy;
  readonly action: 'dbInit' | 'dbUpdate';
  /**
   * Identity of the plan the caller consented to (`db update` only). When
   * set, the apply refuses with `CONSENT_PLAN_MISMATCH` if the freshly
   * computed plan differs — consent binds to one plan, not to data loss in
   * general.
   */
  readonly consentedPlanHash?: string;
  /** Content check for contract snapshots the aggregate loader resolves. */
  readonly verifySnapshotContent?: SnapshotContentVerifier;
  readonly onProgress?: OnControlProgress;
}

/**
 * Loader → planner → runner pipeline shared by `db init` and `db update`.
 *
 * The pipeline:
 *
 * 1. **Load**: build a {@link ContractSpaceAggregate} from the descriptor
 *    set + on-disk on-disk artefacts. Any layout / drift / disjointness /
 *    integrity violation short-circuits with a structured error.
 * 2. **Read DB state**: marker rows (`familyInstance.readAllMarkers`)
 *    + introspected schema (`familyInstance.introspect`).
 * 3. **Plan**: {@link planMigration} chooses `resolveRecordedPath` vs
 *    `planFromDiff` per space according to `callerPolicy.ignoreGraphFor`.
 *    The app space is forced through `planFromDiff` (today's daily-driver
 *    behaviour); every extension space walks its on-disk graph via
 *    `resolveRecordedPath`.
 * 4. **Apply** (when `mode === 'apply'`): every per-space `MigrationPlan`
 *    feeds into the runner's `execute` — one outer
 *    transaction across every space; failure on any space rolls back
 *    every space's writes.
 */
export async function executeRun<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteRunOptions<TFamilyId, TTargetId>,
): Promise<DbInitResult | DbUpdateResult> {
  const {
    driver,
    adapter,
    familyInstance,
    contract,
    mode,
    migrations,
    frameworkComponents,
    migrationsDir,
    extensions,
    targetId,
    policy,
    action,
    onProgress,
  } = options;

  // 1. Load aggregate from descriptors + on-disk state.
  const loadInputs: BuildAggregateInputs<TFamilyId, TTargetId> = {
    targetId,
    migrationsDir,
    appContract: contract,
    extensions,
    deserializeContract: (json) => familyInstance.deserializeContract(json),
    ...ifDefined('verifySnapshotContent', options.verifySnapshotContent),
  };
  const loaded = await buildContractSpaceAggregate(loadInputs);
  if (!loaded.ok) {
    throw loaded.failure;
  }
  const aggregate = loaded.value;

  // 2. Read live DB state (markers + schema).
  const markerRows = await familyInstance.readAllMarkers({ driver });

  // 2a. Orphan-marker pre-flight: refuse to *apply* when a marker row
  // exists for a space that is not declared in the aggregate. Plan mode
  // (`db init/update --dry-run`) must still be able to introspect the
  // aggregate plan in this state — a retired extension whose marker
  // happens to linger should not block the user from inspecting what a
  // run would do. Apply mode tells the user to clean up the orphan
  // before silently advancing the app's marker.
  if (mode === 'apply') {
    const orphanMarkerError = detectOrphanMarkers(aggregate, markerRows);
    if (orphanMarkerError !== null) {
      throw orphanMarkerError;
    }
  }

  onProgress?.({
    action,
    kind: 'spanStart',
    spanId: SPAN_IDS.introspect,
    label: 'Introspecting database schema',
  });
  const schemaIR = await familyInstance.introspect({
    driver,
    contract: collectAggregateNamespaces(aggregate),
  });
  onProgress?.({ action, kind: 'spanEnd', spanId: SPAN_IDS.introspect, outcome: 'ok' });

  // 3. Plan via aggregate planner. App is forced through planFromDiff
  // (today's `db init` / `db update` daily-driver behaviour); extensions
  // walk their on-disk migration graphs via resolveRecordedPath.
  onProgress?.({
    action,
    kind: 'spanStart',
    spanId: SPAN_IDS.plan,
    label: 'Planning migration',
  });
  const planResult = await planMigration<TFamilyId, TTargetId>({
    aggregate,
    currentDBState: { markersBySpaceId: markerRows, schemaIntrospection: schemaIR },
    adapter,
    migrations,
    frameworkComponents,
    callerPolicy: { ignoreGraphFor: new Set([aggregate.app.spaceId]) },
    operationPolicy: policy,
  });
  if (!planResult.ok) {
    onProgress?.({ action, kind: 'spanEnd', spanId: SPAN_IDS.plan, outcome: 'error' });
    return mapPlannerError(planResult.failure);
  }
  onProgress?.({ action, kind: 'spanEnd', spanId: SPAN_IDS.plan, outcome: 'ok' });

  const orderedResolutions = collectOrdered(planResult.value.applyOrder, planResult.value.perSpace);
  const plannerWarnings = aggregatePlannerWarnings(orderedResolutions);

  // The destination's structural shape comes from the app's plan — its
  // `destination` is the storage hash users see in CLI output.
  const appResolution = orderedResolutions.find((r) => r.spaceId === aggregate.app.spaceId);
  if (!appResolution) {
    throw new InternalError(
      'Aggregate planner returned no plan for the app space — the planner is supposed to always emit one.',
    );
  }
  const appPlan = appResolution.entry.plan;

  // 4. Plan-mode: surface aggregate operations without applying.
  if (mode === 'plan') {
    const aggregateOps = orderedResolutions.flatMap((r) => r.entry.displayOps);
    const preview = hasOperationPreview(familyInstance)
      ? familyInstance.toOperationPreview(aggregateOps)
      : undefined;
    const perSpace = buildPerSpaceBreakdown(orderedResolutions, aggregate.app.spaceId, {
      includeMarkers: false,
    });
    const summary = `Planned ${aggregateOps.length} operation(s) across ${orderedResolutions.length} space(s)`;
    return wrapPlanResult({
      operations: aggregateOps,
      destination: appPlan.destination,
      preview,
      perSpace,
      summary,
      ...ifDefined('warnings', plannerWarnings),
    });
  }

  // 4a. Consent binding: the caller consented to one specific plan. The
  // freshly computed plan must be that plan, or the apply is refused before
  // anything runs.
  if (options.consentedPlanHash !== undefined) {
    const planHash = computePlanHash({
      operations: stripOperations(orderedResolutions.flatMap((r) => r.entry.displayOps)),
      destination: appPlan.destination,
    });
    if (planHash !== options.consentedPlanHash) {
      const failure: DbUpdateFailure = {
        code: 'CONSENT_PLAN_MISMATCH',
        summary: 'The plan changed between consent and apply',
        why: 'The plan recomputed for the consented apply is not the plan that was consented to, so applying it could destroy something nobody agreed to.',
        conflicts: undefined,
        meta: undefined,
        consentPlanMismatch: { consentedPlanHash: options.consentedPlanHash, planHash },
        ...ifDefined('warnings', plannerWarnings),
      };
      return notOk(failure);
    }
  }

  // 5. Run mode: hand off to the shared `runMigration` primitive.
  // The runner-driving tail is identical for `db init` / `db update` /
  // `migrate` — only how each caller produces `perSpacePlans`
  // differs (planFromDiff + resolveRecordedPath via planMigration here;
  // resolveRecordedPath only for migrate). Each caller produces
  // perSpacePlans differently; this helper handles the shared run tail.
  const applied = await runMigration({
    aggregate,
    perSpacePlans: planResult.value.perSpace,
    applyOrder: planResult.value.applyOrder,
    driver,
    familyInstance,
    migrations,
    frameworkComponents,
    policy,
    action,
    ...ifDefined('onProgress', onProgress),
  });
  if (!applied.ok) {
    return buildRunnerFailure({
      summary: applied.failure.summary,
      ...ifDefined('why', applied.failure.why),
      meta: applied.failure.meta,
      ...ifDefined('warnings', plannerWarnings),
      ...ifDefined('cause', applied.failure.cause),
    });
  }

  const aggregateOps = applied.value.orderedResolutions.flatMap((r) => r.entry.displayOps);
  const summary =
    action === 'dbInit'
      ? `Applied ${applied.value.totalOpsExecuted} operation(s) across ${applied.value.orderedResolutions.length} space(s), database signed`
      : applied.value.totalOpsExecuted === 0
        ? `Database already matches contract across ${applied.value.orderedResolutions.length} space(s), signature updated`
        : `Applied ${applied.value.totalOpsExecuted} operation(s) across ${applied.value.orderedResolutions.length} space(s), signature updated`;

  return wrapApplyResult({
    operations: aggregateOps,
    destination: appPlan.destination,
    operationsPlanned: applied.value.totalOpsPlanned,
    operationsExecuted: applied.value.totalOpsExecuted,
    perSpace: applied.value.perSpace,
    summary,
    ...ifDefined('warnings', plannerWarnings),
  });
}

function aggregatePlannerWarnings(
  orderedResolutions: readonly OrderedResolution[],
): readonly MigrationPlannerConflict[] | undefined {
  const warnings = orderedResolutions.flatMap((r) => r.entry.warnings ?? []);
  return warnings.length > 0 ? warnings : undefined;
}

/**
 * Compare the live `_prisma_marker` rows against the aggregate's
 * declared contract spaces. Any marker row whose `space` is not a space of
 * the aggregate is an "orphan" — typically a marker left behind by
 * an extension that was removed from `extensions` without first
 * cleaning up its on-disk migrations / database tables.
 *
 * Returns a {@link CliStructuredError} envelope (code
 * `MIGRATION.CONTRACT_SPACE_VIOLATION`, `kind: 'orphanMarker'`) for the
 * first orphan it finds, or `null`
 * when every marker row maps to a declared contract space. Mirrors the M2
 * `runContractSpaceVerifierMarkerCheck` envelope so downstream
 * tooling (integration tests, JSON consumers) keeps asserting on the
 * same shape.
 */
function detectOrphanMarkers(
  aggregate: ContractSpaceAggregate,
  markerRows: ReadonlyMap<string, unknown>,
): CliStructuredError | null {
  const aggregateSpaceIds = new Set<string>([
    aggregate.app.spaceId,
    ...aggregate.extensions.map((m) => m.spaceId),
  ]);
  const orphans: string[] = [];
  for (const [spaceId, row] of markerRows) {
    if (row !== null && row !== undefined && !aggregateSpaceIds.has(spaceId)) {
      orphans.push(spaceId);
    }
  }
  if (orphans.length === 0) return null;
  orphans.sort((a, b) => a.localeCompare(b));
  const summary =
    orphans.length === 1
      ? `Orphan contract-space marker detected for "${orphans[0]}"`
      : `Orphan contract-space markers detected for ${orphans.length} spaces`;
  return new CliStructuredError('MIGRATION.CONTRACT_SPACE_VIOLATION', summary, {
    why: `The database has \`_prisma_marker\` rows for spaces (${orphans
      .map((s) => `"${s}"`)
      .join(
        ', ',
      )}) that are not declared in the project's \`extensions\`. The aggregate pipeline refuses to advance markers it cannot account for.`,
    fix: 'Either re-declare the missing extension(s) in `extensions` (so the aggregate owns them again), or remove the orphan marker row(s) from `_prisma_marker` once you have confirmed the corresponding tables can be safely retired.',
    docsUrl: 'https://pris.ly/contract-spaces',
    meta: {
      violations: orphans.map((spaceId) => ({ kind: 'orphanMarker', spaceId })),
    },
  });
}

function mapPlannerError(error: PlannerError): DbInitResult | DbUpdateResult {
  if (error.kind === 'planFromDiffFailed') {
    const failure: DbInitFailure | DbUpdateFailure = {
      code: 'PLANNING_FAILED',
      summary: 'Migration planning failed due to conflicts',
      conflicts: error.conflicts,
      why: undefined,
      meta: undefined,
    };
    return blindCast<
      DbInitResult | DbUpdateResult,
      'notOk(failure) is shape-compatible with both DbInitResult and DbUpdateResult; the union is the return type of the surrounding function'
    >(notOk(failure));
  }
  if (error.kind === 'extensionPathUnreachable') {
    return buildRunnerFailure({
      summary: `Cannot resolve apply path for extension space "${error.spaceId}"`,
      why: `No path in the on-disk migration graph for extension space "${error.spaceId}" reaches the on-disk head ref hash "${error.target}".`,
      meta: { spaceId: error.spaceId, target: error.target },
    });
  }
  if (error.kind === 'extensionPathUnsatisfiable') {
    return buildRunnerFailure({
      summary: `Cannot resolve apply path for extension space "${error.spaceId}"`,
      why: `On-disk migration graph for extension space "${error.spaceId}" reaches the on-disk head ref but does not cover required invariants: ${error.missingInvariants.join(', ')}.`,
      meta: { spaceId: error.spaceId, missingInvariants: error.missingInvariants },
    });
  }
  // policyConflict — surfaces as a runner-style failure naming the
  // space; conceptually a configuration bug, but mapping it onto the
  // existing failure surface keeps callers untouched.
  return buildRunnerFailure({
    summary: `Aggregate planner policy conflict for space "${error.spaceId}"`,
    why: error.detail,
    meta: { spaceId: error.spaceId },
  });
}

function wrapPlanResult(args: {
  readonly operations: readonly MigrationPlanOperation[];
  readonly destination: { readonly storageHash: string; readonly profileHash?: string };
  readonly preview: OperationPreview | undefined;
  readonly perSpace: readonly PerSpaceExecutionEntry[];
  readonly summary: string;
  readonly warnings?: readonly MigrationPlannerConflict[];
}): DbInitResult | DbUpdateResult {
  const success: DbInitSuccess | DbUpdateSuccess = {
    mode: 'plan',
    plan: {
      operations: stripOperations(args.operations),
      ...ifDefined('preview', args.preview),
    },
    destination: {
      storageHash: args.destination.storageHash,
      ...ifDefined('profileHash', args.destination.profileHash),
    },
    perSpace: args.perSpace,
    summary: args.summary,
    ...ifDefined('warnings', args.warnings),
  };
  return ok(success);
}

function wrapApplyResult(args: {
  readonly operations: readonly MigrationPlanOperation[];
  readonly destination: { readonly storageHash: string; readonly profileHash?: string };
  readonly operationsPlanned: number;
  readonly operationsExecuted: number;
  readonly perSpace: readonly PerSpaceExecutionEntry[];
  readonly summary: string;
  readonly warnings?: readonly MigrationPlannerConflict[];
}): DbInitResult | DbUpdateResult {
  const success: DbInitSuccess | DbUpdateSuccess = {
    mode: 'apply',
    plan: { operations: stripOperations(args.operations) },
    destination: {
      storageHash: args.destination.storageHash,
      ...ifDefined('profileHash', args.destination.profileHash),
    },
    execution: {
      operationsPlanned: args.operationsPlanned,
      operationsExecuted: args.operationsExecuted,
    },
    marker: args.destination.profileHash
      ? { storageHash: args.destination.storageHash, profileHash: args.destination.profileHash }
      : { storageHash: args.destination.storageHash },
    perSpace: args.perSpace,
    summary: args.summary,
    ...ifDefined('warnings', args.warnings),
  };
  return ok(success);
}

function buildRunnerFailure(args: {
  readonly summary: string;
  readonly why?: string;
  readonly meta: Record<string, unknown>;
  readonly warnings?: readonly MigrationPlannerConflict[];
  readonly cause?: unknown;
}): DbInitResult | DbUpdateResult {
  const failure: DbInitFailure | DbUpdateFailure = {
    code: 'RUNNER_FAILED',
    summary: args.summary,
    why: args.why,
    meta: args.meta,
    conflicts: undefined,
    ...ifDefined('warnings', args.warnings),
    ...ifDefined('cause', args.cause),
  };
  return blindCast<
    DbInitResult | DbUpdateResult,
    'notOk(failure) is shape-compatible with both DbInitResult and DbUpdateResult; the union is the return type of the surrounding function'
  >(notOk(failure));
}
