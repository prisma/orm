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
  MigrationOperationSubject,
  MigrationPlannerConflict,
  MigrationPlanOperation,
  MigrationPlanSubjects,
  OperationPreview,
  ResolvedMigrationStatement,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import {
  CONTRACT_SNAPSHOTS_DIRNAME,
  hasOperationPreview,
  isStorageHashHex,
  migrationSubjectKey,
} from '@internal/framework-components/control';
import type { ContractMarkerRecordLike } from '@internal/migration-tools/aggregate';
import {
  type PlannerSuccess as AggregatePlan,
  type ContractSpaceAggregate,
  collectAggregateNamespaces,
  type PlannerError,
  planMigration,
} from '@internal/migration-tools/aggregate';
import {
  contractSnapshotDir,
  readContractSnapshotJson,
  type SnapshotContentVerifier,
} from '@internal/migration-tools/contract-snapshot-store';
import { MigrationToolsError } from '@internal/migration-tools/errors';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import { join } from 'pathe';
import { CliStructuredError } from '../../utils/cli-errors';
import {
  type AnswerPlanQuestions,
  askPlanQuestions,
  type ConsentedSubject,
  keepDataByHandFor,
  type PlannedQuestions,
  refuseUnusedConsents,
  subjectText,
} from '../statements/plan-questions';
import {
  type AppliedStatementReport,
  reportAppliedStatements,
  reportConsentStatement,
} from '../statements/report-applied-statements';
import { resolveStatements, type StatementOrigin } from '../statements/resolve-statements';
import type { StatementText } from '../statements/statement-text';
import type {
  AskedAccessChange,
  AskedSubject,
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
export interface ExecuteRunSharedOptions<TFamilyId extends string, TTargetId extends string> {
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
  /** Content check for contract snapshots the aggregate loader resolves. */
  readonly verifySnapshotContent?: SnapshotContentVerifier;
  readonly onProgress?: OnControlProgress;
}

/**
 * `db init` takes no statements. `db update` takes the statements as the user wrote them, in
 * order, and the answer to each question its plan raises: what an operation that would lose data
 * means and, when it applies, whether an operation may widen access. `acceptDataLoss` answers
 * every data-loss question with consent, and `acceptAccessWidening` every access question.
 */
export type ExecuteRunOptions<
  TFamilyId extends string,
  TTargetId extends string,
> = ExecuteRunSharedOptions<TFamilyId, TTargetId> &
  (
    | { readonly action: 'dbInit' }
    | {
        readonly action: 'dbUpdate';
        readonly statements: readonly StatementText[];
        readonly answerQuestions: AnswerPlanQuestions;
        readonly acceptDataLoss: boolean;
        readonly acceptAccessWidening: boolean;
      }
  );

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

  // 2b. The application space's origin is the contract its marker names, read from the snapshot
  // store. The planner names each subject it would lose through it, and rename statements resolve
  // against it. Without a readable snapshot every subject is a storage name, and a rename cannot
  // resolve.
  const appOrigin =
    options.action === 'dbUpdate'
      ? await readAppOrigin({
          marker: markerRows.get(aggregate.app.spaceId) ?? null,
          migrationsDir,
          deserializeContract: (json) => familyInstance.deserializeContract(json),
          ...ifDefined('verifySnapshotContent', options.verifySnapshotContent),
        })
      : undefined;
  const fromContract = appOrigin?.contract ?? null;
  const statementTexts = options.action === 'dbUpdate' ? options.statements : [];
  const resolveRenames = (
    texts: readonly StatementText[],
  ): readonly ResolvedMigrationStatement[] => {
    if (texts.length === 0 || appOrigin === undefined) return [];
    const resolved = resolveStatements({
      statements: texts,
      origin: appOrigin.origin,
      destination: contract,
    });
    if (!resolved.ok) {
      throw resolved.failure;
    }
    return resolved.value;
  };
  const statements = resolveRenames(statementTexts);

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
  const plan = async (
    resolved: readonly ResolvedMigrationStatement[],
  ): Promise<Result<PlannedRun, DbInitResult | DbUpdateResult>> => {
    onProgress?.({
      action,
      kind: 'spanStart',
      spanId: SPAN_IDS.plan,
      label: 'Planning migration',
    });
    const planned = await planMigration<TFamilyId, TTargetId>({
      aggregate,
      currentDBState: { markersBySpaceId: markerRows, schemaIntrospection: schemaIR },
      adapter,
      migrations,
      frameworkComponents,
      callerPolicy: { ignoreGraphFor: new Set([aggregate.app.spaceId]) },
      operationPolicy: policy,
      appSpace: { fromContract, statements: resolved },
      storageNameOf: (operation) => familyInstance.storageNameOf(operation),
    });
    if (!planned.ok) {
      onProgress?.({ action, kind: 'spanEnd', spanId: SPAN_IDS.plan, outcome: 'error' });
      return notOk(mapPlannerError(planned.failure));
    }
    onProgress?.({ action, kind: 'spanEnd', spanId: SPAN_IDS.plan, outcome: 'ok' });
    const orderedResolutions = collectOrdered(planned.value.applyOrder, planned.value.perSpace);
    const subjects: MigrationPlanSubjects =
      action === 'dbUpdate'
        ? subjectsAcrossSpaces(orderedResolutions)
        : { dataLoss: [], accessWidening: [] };
    const operations = orderedResolutions.flatMap((r) => r.entry.displayOps);
    const labelled = <TEntry extends MigrationOperationSubject>(entries: readonly TEntry[]) =>
      entries.map((entry) => ({
        ...entry,
        label: operations[entry.operationIndex]?.label ?? JSON.stringify(entry.subject),
      }));
    return ok({
      planned: planned.value,
      orderedResolutions,
      subjects,
      dataLoss: labelled(subjects.dataLoss),
      accessWidening: labelled(subjects.accessWidening),
    });
  };

  const first = await plan(statements);
  if (!first.ok) {
    return first.failure;
  }
  let run = first.value;
  let renameTexts = statementTexts.filter((statement) => statement.verb === 'rename');
  let consented: readonly ConsentedSubject[] = [];
  // 3a. Questions: an apply of `db update` asks what each operation that would lose data means,
  // and whether each that would widen access may run, before it applies anything. A dry run asks
  // nothing and lists them.
  if (options.action === 'dbUpdate' && mode === 'apply') {
    const answered = await askPlanQuestions({
      plan: run,
      askAccess: true,
      renames: renameTexts,
      preAnswers: statementTexts.filter((statement) => statement.verb !== 'rename'),
      consentAll: { delete: options.acceptDataLoss, allow: options.acceptAccessWidening },
      origin: fromContract ?? EMPTY_ORIGIN,
      originKnown: fromContract !== null,
      keepDataByHand: keepDataByHandFor(migrations, fromContract ?? EMPTY_ORIGIN),
      destination: contract,
      answer: options.answerQuestions,
      replan: (renames) => plan(resolveRenames(renames)),
    });
    if (!answered.ok) {
      if (CliStructuredError.is(answered.failure)) {
        throw answered.failure;
      }
      return answered.failure;
    }
    run = answered.value.plan;
    renameTexts = [...answered.value.renames];
    consented = answered.value.consented;
  }
  if (options.action === 'dbUpdate' && mode === 'plan') {
    const refused = refuseUnusedConsents({
      plan: run,
      statements: statementTexts,
      contracts: {
        origin: fromContract ?? EMPTY_ORIGIN,
        destination: contract,
        renames: renameTexts,
      },
    });
    if (!refused.ok) {
      throw refused.failure;
    }
  }
  const { planned, orderedResolutions } = run;
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
  const appliedStatements =
    action === 'dbUpdate'
      ? [
          ...reportAppliedStatements(
            appResolution.entry.appliedStatements,
            fromContract,
            contract,
            operationsBefore(orderedResolutions, aggregate.app.spaceId),
          ),
          ...consented.map((entry) =>
            reportConsentStatement(
              entry,
              entry.verb === 'allow' && entry.operationIndex !== undefined
                ? [entry.operationIndex]
                : run.subjects.dataLoss
                    .filter(
                      ({ subject }) =>
                        migrationSubjectKey(subject) === migrationSubjectKey(entry.subject),
                    )
                    .map(({ operationIndex }) => operationIndex),
            ),
          ),
        ]
      : undefined;
  const contractsAsked = {
    origin: fromContract ?? EMPTY_ORIGIN,
    destination: contract,
    renames: renameTexts,
  };
  const asked = <TEntry extends MigrationOperationSubject>(entries: readonly TEntry[]) =>
    entries.map((entry) => ({ ...entry, text: subjectText(entry.subject, contractsAsked) }));
  const subjects =
    action === 'dbUpdate'
      ? {
          dataLoss: asked(run.subjects.dataLoss),
          accessWidening: asked(run.subjects.accessWidening),
        }
      : undefined;

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
      appliedStatements,
      subjects,
      ...ifDefined('warnings', plannerWarnings),
    });
  }

  // 5. Run mode: hand off to the shared `runMigration` primitive.
  // The runner-driving tail is identical for `db init` / `db update` /
  // `migrate` — only how each caller produces `perSpacePlans`
  // differs (planFromDiff + resolveRecordedPath via planMigration here;
  // resolveRecordedPath only for migrate). Each caller produces
  // perSpacePlans differently; this helper handles the shared run tail.
  const applied = await runMigration({
    aggregate,
    perSpacePlans: planned.perSpace,
    applyOrder: planned.applyOrder,
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
    appliedStatements,
    subjects,
    ...ifDefined('warnings', plannerWarnings),
  });
}

/** The origin of a database whose marker names no readable contract: no models. */
const EMPTY_ORIGIN = { domain: { namespaces: {} } };

/** A plan of every space, and what it would lose and whose access it would widen. */
interface PlannedRun extends PlannedQuestions {
  readonly planned: AggregatePlan;
  readonly orderedResolutions: readonly OrderedResolution[];
  readonly subjects: MigrationPlanSubjects;
}

/**
 * The contract the application space's marker names, from the local snapshot
 * store, or where it was looked for and why it could not be used.
 */
async function readAppOrigin(input: {
  readonly marker: ContractMarkerRecordLike | null;
  readonly migrationsDir: string;
  readonly deserializeContract: (json: unknown) => Contract;
  readonly verifySnapshotContent?: SnapshotContentVerifier;
}): Promise<{ readonly origin: StatementOrigin; readonly contract: Contract | null }> {
  const snapshotsDir = join(input.migrationsDir, CONTRACT_SNAPSHOTS_DIRNAME);
  if (input.marker === null) {
    const origin: StatementOrigin = {
      kind: 'missing',
      hash: null,
      snapshotDirectory: snapshotsDir,
      unreadable: undefined,
    };
    return { origin, contract: null };
  }
  const hash = input.marker.storageHash;
  if (!isStorageHashHex(hash)) {
    return {
      origin: { kind: 'missing', hash, snapshotDirectory: snapshotsDir, unreadable: undefined },
      contract: null,
    };
  }
  const snapshotDirectory = contractSnapshotDir(input.migrationsDir, hash);
  let json: unknown;
  try {
    json = await readContractSnapshotJson(input.migrationsDir, hash, input.verifySnapshotContent);
  } catch (error) {
    if (!MigrationToolsError.is(error)) throw error;
    const unreadable = error.code === 'MIGRATION.CONTRACT_SNAPSHOT_MISSING' ? undefined : error.why;
    return { origin: { kind: 'missing', hash, snapshotDirectory, unreadable }, contract: null };
  }
  try {
    const contract = input.deserializeContract(json);
    return { origin: { kind: 'contract', contract }, contract };
  } catch (error) {
    const unreadable = error instanceof Error ? error.message : String(error);
    return { origin: { kind: 'missing', hash, snapshotDirectory, unreadable }, contract: null };
  }
}

/** How many operations the spaces applied before `spaceId` list ahead of it in `operations`. */
function operationsBefore(
  orderedResolutions: readonly OrderedResolution[],
  spaceId: string,
): number {
  const position = orderedResolutions.findIndex((resolution) => resolution.spaceId === spaceId);
  return orderedResolutions
    .slice(0, position)
    .reduce((count, resolution) => count + resolution.entry.displayOps.length, 0);
}

/**
 * What the planned operations lose and whose access they widen, across every space, each at its
 * position in the operations the result reports.
 */
function subjectsAcrossSpaces(
  orderedResolutions: readonly OrderedResolution[],
): MigrationPlanSubjects {
  const offset = <TEntry extends MigrationOperationSubject>(
    resolution: OrderedResolution,
    entries: readonly TEntry[],
  ) =>
    entries.map((entry) => ({
      ...entry,
      operationIndex:
        entry.operationIndex + operationsBefore(orderedResolutions, resolution.spaceId),
    }));
  return {
    dataLoss: orderedResolutions.flatMap((resolution) =>
      offset(resolution, resolution.entry.dataLoss),
    ),
    accessWidening: orderedResolutions.flatMap((resolution) =>
      offset(resolution, resolution.entry.accessWidening),
    ),
  };
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
  /** `undefined` for `db init`, which reports no statements. */
  readonly appliedStatements: readonly AppliedStatementReport[] | undefined;
  /** `undefined` for `db init`, which reports no data loss. */
  readonly subjects: MigrationPlanSubjects<AskedSubject, AskedAccessChange> | undefined;
  readonly warnings?: readonly MigrationPlannerConflict[];
}): DbInitResult | DbUpdateResult {
  const success: DbInitSuccess | DbUpdateSuccess = {
    mode: 'plan',
    ...ifDefined('appliedStatements', args.appliedStatements),
    ...args.subjects,
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
  /** `undefined` for `db init`, which reports no statements. */
  readonly appliedStatements: readonly AppliedStatementReport[] | undefined;
  /** `undefined` for `db init`, which reports no data loss. */
  readonly subjects: MigrationPlanSubjects<AskedSubject, AskedAccessChange> | undefined;
  readonly warnings?: readonly MigrationPlannerConflict[];
}): DbInitResult | DbUpdateResult {
  const success: DbInitSuccess | DbUpdateSuccess = {
    mode: 'apply',
    ...ifDefined('appliedStatements', args.appliedStatements),
    ...args.subjects,
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
