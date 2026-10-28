/**
 * Shared runner tail (`runMigration` + `buildPerSpaceBreakdown`/`collectOrdered`).
 * Backs no command directly; consumed by db-run and migrate.
 */

import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  FailedTypeChange,
  MigrationOperationPolicy,
  MigrationRunnerFailure,
  MigrationSubject,
  RowsFailingCheck,
  RowsHoldingValue,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import {
  enumValueCoordinateFromJson,
  enumValueStatementText,
  modelStatementText,
} from '@internal/framework-components/control';
import type {
  AggregateMigrationEdgeRef,
  ContractSpaceAggregate,
  PerSpacePlan,
} from '@internal/migration-tools/aggregate';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import { schemaCheckIssues } from '../../utils/schema-check-issues';
import { subjectText } from '../statements/plan-questions';
import type {
  FailedPrecheckReport,
  FailedTypeChangeReport,
  OnControlProgress,
  PerSpaceExecutionEntry,
  RowsFailingCheckReport,
  RowsHoldingValueReport,
  RunnerFailureFacts,
} from '../types';

/**
 * Span id emitted via `onProgress` for the run phase. Stable
 * identifier consumed by the structured-output renderer and by tests.
 */
const RUN_SPAN_ID = 'apply' as const;

/**
 * Action that originated this run call. Threaded into `OnControlProgress`
 * events so the parent CLI command can attribute the span correctly,
 * and used to compose action-specific summary phrasing.
 */
export type RunAction = 'dbInit' | 'dbUpdate' | 'migrate';

function edgeOfOperation(
  edges: readonly AggregateMigrationEdgeRef[],
  operationIndex: number,
): AggregateMigrationEdgeRef | undefined {
  let end = 0;
  return edges.find((edge) => {
    end += edge.operationCount;
    return operationIndex < end;
  });
}

function failedTypeChangeReport(change: FailedTypeChange, field: string): FailedTypeChangeReport {
  return change.by === 'cast'
    ? { field, by: 'cast', reason: change.reason }
    : { field, by: 'conversion', reason: change.reason };
}

function rowsHoldingValueReport(
  fact: RowsHoldingValue,
  contract: OrderedResolution['entry']['destinationContract'],
): RowsHoldingValueReport {
  const enumValue = enumValueCoordinateFromJson(fact.enumValue);
  return {
    enumValue: enumValueStatementText(contract, enumValue),
    enumName: modelStatementText(contract, {
      namespaceId: enumValue.namespaceId,
      model: enumValue.enum,
    }),
    value: fact.value,
    rows: fact.rows,
    ...ifDefined('keepDataEdit', fact.keepDataEdit),
  };
}

function rowsFailingCheckReport(
  fact: RowsFailingCheck | undefined,
): RowsFailingCheckReport | undefined {
  if (fact === undefined) return undefined;
  const { operationIndex: _operationIndex, ...report } = fact;
  return report;
}

/** What the runner said blocked the failed operation, named as the advice names it. */
function failureReports(
  failure: MigrationRunnerFailure,
  resolutions: readonly OrderedResolution[],
): Pick<
  RunnerFailureFacts,
  | 'failedTypeChange'
  | 'rowsWithoutValue'
  | 'rowsHoldingValue'
  | 'rowsFailingCheck'
  | 'failedMigration'
> {
  const resolution = resolutions.find(({ spaceId }) => spaceId === failure.meta.failingSpace);
  if (resolution === undefined) return {};
  const fieldText = (field: MigrationSubject) =>
    subjectText(field, { origin: resolution.entry.destinationContract, statements: [] });
  const { failedTypeChange, rowsWithoutValue, rowsHoldingValue, rowsFailingCheck } = failure.meta;
  const operationIndex =
    failedTypeChange?.operationIndex ??
    rowsWithoutValue?.[0]?.operationIndex ??
    rowsHoldingValue?.operationIndex ??
    rowsFailingCheck?.operationIndex;
  const edge =
    operationIndex !== undefined
      ? edgeOfOperation(resolution.entry.migrationEdges, operationIndex)
      : schemaCheckIssues(failure) !== undefined
        ? resolution.entry.migrationEdges.at(-1)
        : undefined;
  return {
    ...ifDefined(
      'failedTypeChange',
      failedTypeChange === undefined
        ? undefined
        : failedTypeChangeReport(failedTypeChange, fieldText(failedTypeChange.field)),
    ),
    ...ifDefined(
      'rowsWithoutValue',
      rowsWithoutValue?.map(({ field, reason, rows }) => ({
        field: field === undefined ? undefined : fieldText(field),
        reason,
        rows,
      })),
    ),
    ...ifDefined(
      'rowsHoldingValue',
      rowsHoldingValue === undefined
        ? undefined
        : rowsHoldingValueReport(rowsHoldingValue, resolution.entry.destinationContract),
    ),
    ...ifDefined('rowsFailingCheck', rowsFailingCheckReport(rowsFailingCheck)),
    ...ifDefined(
      'failedMigration',
      edge === undefined ? undefined : { spaceId: resolution.spaceId, edge },
    ),
  };
}

function failedPrecheckOf(
  failure: MigrationRunnerFailure,
  resolutions: readonly OrderedResolution[],
): FailedPrecheckReport | undefined {
  const check = failure.meta.failedCheck;
  if (check === undefined || check.phase !== 'precheck') {
    return undefined;
  }
  const resolution = resolutions.find(({ spaceId }) => spaceId === failure.meta.failingSpace);
  return {
    operationId: check.operationId,
    description: check.description,
    planStartsFromMarker: resolution !== undefined && resolution.entry.plan.origin !== null,
  };
}

/** The facts the advice for `failure` names, found in the plans of `resolutions`. */
export function runnerFailureFacts(
  failure: MigrationRunnerFailure,
  resolutions: readonly OrderedResolution[],
): RunnerFailureFacts {
  return {
    ...failureReports(failure, resolutions),
    ...ifDefined('failedPrecheck', failedPrecheckOf(failure, resolutions)),
  };
}

export interface RunMigrationInputs<TFamilyId extends string, TTargetId extends string> {
  readonly aggregate: ContractSpaceAggregate;
  /**
   * Per-space plans, keyed by `spaceId`. Produced by either the full
   * {@link planMigration} pipeline (`db init` / `db update` —
   * `planFromDiff` for the app, `resolveRecordedPath` for extensions) or
   * by direct {@link resolveRecordedPath} calls (`migrate` — resolves
   * the recorded path for every contract space). Either way, the runner
   * consumes the same shape.
   */
  readonly perSpacePlans: ReadonlyMap<string, PerSpacePlan>;
  /**
   * Canonical schedule order — extensions alphabetically by `spaceId`,
   * then app. Mirrors {@link import('@internal/migration-tools/concatenate-space-apply-inputs').concatenateSpaceApplyInputs}'s
   * convention so `MigrationRunnerFailure.meta.failingSpace` attribution
   * stays byte-for-byte stable across callers.
   */
  readonly applyOrder: readonly string[];
  readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
  readonly familyInstance: ControlFamilyInstance<TFamilyId, unknown>;
  readonly migrations: TargetMigrationsCapability<
    TFamilyId,
    TTargetId,
    ControlFamilyInstance<TFamilyId, unknown>
  >;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  readonly policy: MigrationOperationPolicy;
  readonly action: RunAction;
  readonly onProgress?: OnControlProgress;
}

/**
 * Resolved per-space plan in canonical schedule order. Surfaced from
 * {@link runMigration} to callers so each one can build its own
 * action-specific success envelope (e.g. `DbInitSuccess` vs
 * `MigrateSuccess`) without re-deriving the ordering.
 */
export interface OrderedResolution {
  readonly spaceId: string;
  readonly entry: PerSpacePlan;
}

export interface RunMigrationValue {
  readonly orderedResolutions: readonly OrderedResolution[];
  readonly totalOpsPlanned: number;
  readonly totalOpsExecuted: number;
  /**
   * Per-space breakdown ready to thread into action-specific success
   * envelopes. Each entry carries the post-apply marker (live storage hash
   * plus invariants) so callers can render it directly without re-reading.
   */
  readonly perSpace: readonly PerSpaceExecutionEntry[];
}

export type RunMigrationResult = Result<RunMigrationValue, MigrationRunnerFailure>;

/**
 * Runner-driving tail shared by every run caller — `db init`,
 * `db update`, and `migrate`. Consumes already-resolved per-space
 * plans (the planner-vs-replay distinction is owned by the caller) and
 * dispatches them to the runner in canonical order.
 *
 * The runner writes each space's marker as the last step of applying that
 * space, so this primitive does not advance markers separately — by the time
 * `execute` returns ok, every space's marker has been advanced to its plan's
 * destination. A failure is returned as the runner reported it; its `why`
 * says whether the database changed.
 *
 * Span emission (`spanStart 'apply'` / `spanEnd 'apply'`) is owned here
 * so callers don't have to duplicate it; the `action` field on each
 * progress event is taken from the caller's `action` argument.
 */
export async function runMigration<TFamilyId extends string, TTargetId extends string>(
  inputs: RunMigrationInputs<TFamilyId, TTargetId>,
): Promise<RunMigrationResult> {
  const {
    aggregate,
    perSpacePlans,
    applyOrder,
    driver,
    familyInstance,
    migrations,
    frameworkComponents,
    policy,
    action,
    onProgress,
  } = inputs;

  const orderedResolutions = collectOrdered(applyOrder, perSpacePlans);

  const runner = migrations.createRunner(familyInstance);

  onProgress?.({
    action,
    kind: 'spanStart',
    spanId: RUN_SPAN_ID,
    label: progressLabelForAction(action),
  });

  const perSpaceOptions = orderedResolutions.map((r) => ({
    space: r.spaceId,
    plan: r.entry.plan,
    driver,
    destinationContract: r.entry.destinationContract,
    policy,
    frameworkComponents,
    migrationEdges: r.entry.migrationEdges,
    // Per-space post-apply schema verification is non-strict: each
    // space's `destinationContract` describes only its own slice; a
    // strict verifier would treat every other space's tables as
    // `extras`. Tolerant mode still catches missing tables / columns.
    strictVerification: false,
  }));

  const runnerResult = await runner.execute({ driver, perSpaceOptions });

  if (!runnerResult.ok) {
    onProgress?.({ action, kind: 'spanEnd', spanId: RUN_SPAN_ID, outcome: 'error' });
    return notOk(runnerResult.failure);
  }
  onProgress?.({ action, kind: 'spanEnd', spanId: RUN_SPAN_ID, outcome: 'ok' });

  const totalOpsPlanned = runnerResult.value.perSpaceResults.reduce(
    (sum, r) => sum + r.value.operationsPlanned,
    0,
  );
  const totalOpsExecuted = runnerResult.value.perSpaceResults.reduce(
    (sum, r) => sum + r.value.operationsExecuted,
    0,
  );

  const perSpace = buildPerSpaceBreakdown(orderedResolutions, aggregate.app.spaceId, {
    includeMarkers: true,
  });

  return ok({
    orderedResolutions,
    totalOpsPlanned,
    totalOpsExecuted,
    perSpace,
  });
}

/**
 * Project the planner's per-space resolutions into the
 * `PerSpaceExecutionEntry[]` shape the CLI surfaces.
 *
 * `includeMarkers` is `true` for apply-mode (each space's marker is
 * the `destination.storageHash` of its plan, which the runner
 * advances as the last step of applying each space) and `false`
 * for plan-mode (no marker has been written yet).
 *
 * Exported alongside {@link runMigration} so plan-mode callers can
 * assemble the same per-space block without going through the runner.
 */
export function buildPerSpaceBreakdown(
  orderedResolutions: readonly OrderedResolution[],
  appSpaceId: string,
  options: { readonly includeMarkers: boolean },
): readonly PerSpaceExecutionEntry[] {
  return orderedResolutions.map((r) => {
    const operations = r.entry.displayOps.map((op) => ({
      id: op.id,
      label: op.label,
      operationClass: op.operationClass,
    }));
    const base: PerSpaceExecutionEntry = {
      spaceId: r.spaceId,
      kind: r.spaceId === appSpaceId ? 'app' : 'extension',
      operations,
    };
    if (!options.includeMarkers) return base;
    return {
      ...base,
      marker: { storageHash: r.entry.plan.destination.storageHash },
    };
  });
}

/**
 * Materialise the `applyOrder` ordering into resolved per-space
 * entries. Throws if the planner output is missing a contract space listed
 * in `applyOrder` — a wiring bug that should never reach runtime.
 *
 * Exported so callers building their own success envelopes after a
 * plan-mode dispatch can replay the same ordering.
 */
export function collectOrdered(
  applyOrder: readonly string[],
  perSpace: ReadonlyMap<string, PerSpacePlan>,
): readonly OrderedResolution[] {
  return applyOrder.map((spaceId) => {
    const entry = perSpace.get(spaceId);
    if (!entry) {
      throw new InternalError(`planner output missing per-space plan for "${spaceId}"`);
    }
    return { spaceId, entry };
  });
}

/**
 * Action-appropriate label for the `spanStart` event the run
 * primitive emits. `runMigration` is shared by `db init`, `db update`,
 * and `migrate`; the span label tracks the user-visible action
 * so structured-progress output reads naturally for each surface.
 */
function progressLabelForAction(action: RunAction): string {
  switch (action) {
    case 'dbInit':
      return 'Initialising database across spaces';
    case 'dbUpdate':
      return 'Updating database across spaces';
    case 'migrate':
      return 'Running migration plan across spaces';
  }
}
