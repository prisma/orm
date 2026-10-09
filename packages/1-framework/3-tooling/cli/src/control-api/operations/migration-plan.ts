/**
 * Policy core of `migration plan`: resolves from/to contracts, runs the planner legs, and writes the planned migration packages.
 */

import { readFile } from 'node:fs/promises';
import type { PrismaNextConfig } from '@internal/config/config-types';
import type { Contract, ContractWithDomain } from '@internal/contract/types';
import {
  createControlStack,
  hasOperationPreview,
  type MigrationPlanOperation,
  type MigrationSubject,
  migrationSubjectKey,
  type OperationPreview,
  planOriginOf,
  type ResolvedMigrationStatement,
  type SchemaOwnership,
} from '@internal/framework-components/control';
import {
  snapshotsImportPathFrom,
  writeContractSnapshot,
} from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { deriveProvidedInvariants } from '@internal/migration-tools/invariants';
import { formatMigrationDirName, writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { writeMigrationTs } from '@internal/migration-tools/migration-ts';
import type { ImportSpecifierResolver } from '@internal/publish-surface/import-roots';
import { castAs } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { notOk, ok, type Result } from '@internal/utils/result';
import { join, relative } from 'pathe';
import {
  type CliErrorConflict,
  CliStructuredError,
  errorContractValidationFailed,
  errorFileNotFound,
  errorMigrationPlanningFailed,
  errorPlanProducedNoOperations,
  errorTargetMigrationNotSupported,
  type PlanDestination,
  type PlanLegOrigin,
} from '../../utils/cli-errors';
import {
  getTargetMigrations,
  resolveContractPath,
  resolveMigrationPaths,
} from '../../utils/command-helpers';
import { toExtensionInputs } from '../../utils/extension-pack-inputs';
import { assertFrameworkComponentsCompatible } from '../../utils/framework-components';
import { createProjectSpecifierResolver } from '../../utils/project-import-root';
import { snapshotVerifierFor } from '../../utils/snapshot-content-verification';
import {
  type AnswerPlanQuestions,
  askPlanQuestions,
  keepDataByHandFor,
  type PlannedSubject,
  subjectText,
} from '../statements/plan-questions';
import {
  type AppliedStatementReport,
  reportAppliedStatements,
  reportConsentStatement,
} from '../statements/report-applied-statements';
import { resolveStatements } from '../statements/resolve-statements';
import type { StatementText } from '../statements/statement-text';
import type { ControlClient } from '../types';
import { errorFromCaught } from './caught-errors';
import {
  buildContractSpaceAggregate,
  loadContractSpaceAggregateForCli,
} from './contract-space-aggregate-loader';
import {
  type ContractSpaceSeedPhaseRecord,
  runContractSpaceSeedPhase,
} from './contract-space-seed-phase';
import { resolveFromForPlan, resolveToForPlan } from './plan-resolution';
import { renderSnapshotDeclarations } from './snapshot-declarations';

function isEnoent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export interface MigrationPlanOptions {
  readonly config: PrismaNextConfig;
  /** Directory the command was invoked from. */
  readonly cwd: string;
  /** The project's directory, normally the validated config's `baseDir`; locates the project manifest. */
  readonly projectDir?: string;
  readonly name?: string;
  readonly from?: string;
  readonly to?: string;
  /**
   * The statements as the user wrote them, in the order given. A `rename`
   * resolves against the origin and destination contracts before anything is
   * written; a `delete` answers the question about the subject it names, and
   * one that answers no question, or an `allow`, which `migration plan` never
   * asks for, fails with `MIGRATION.STATEMENT_ANSWERS_NO_QUESTION`.
   */
  readonly statements?: readonly StatementText[];
  /**
   * Asks what each operation that would lose data means, before anything is
   * written. A delete answer consents to the loss; a rename answer is planned
   * again with the other renames and must remove the loss.
   */
  readonly answerQuestions: AnswerPlanQuestions;
  /** Renders the declarations of the destination snapshot from its `contract.json`. */
  readonly client: Pick<ControlClient, 'renderContractDts'>;
}

type PlannerSuccess = {
  readonly plannedOps: readonly MigrationPlanOperation[];
  readonly migrationTsContent: string;
  readonly hasPlaceholders: boolean;
  readonly appliedStatements: readonly AppliedStatementReport[];
  /** The operations that would lose data, positioned in the plan's operations. */
  readonly dataLoss: readonly PlannedSubject[];
};

/** The origin of a plan from an empty database: no models, so no statement resolves. */
const EMPTY_ORIGIN: ContractWithDomain = { domain: { namespaces: {} } };

type TargetMigrationsApi = NonNullable<ReturnType<typeof getTargetMigrations>>;

/** A plan origin whose earlier contract the planner diffs against. */
type PlanLegOriginWithContract =
  | Exclude<PlanLegOrigin, { readonly kind: 'contract' }>
  | (Extract<PlanLegOrigin, { readonly kind: 'contract' }> & { readonly contract: Contract });

/**
 * Why a planner leg failed: the planner refused (a conflict, such as a refused statement), or it
 * produced no operations for a changed contract.
 */
interface PlannerLegFailure {
  readonly reason: 'refused' | 'noOperations';
  readonly error: CliStructuredError;
}

async function runPlannerLeg(
  planner: ReturnType<TargetMigrationsApi['createPlanner']>,
  migrations: TargetMigrationsApi,
  frameworkComponents: ReturnType<typeof assertFrameworkComponentsCompatible>,
  contract: Contract,
  origin: PlanLegOriginWithContract,
  destination: PlanDestination,
  statements: readonly ResolvedMigrationStatement[],
  /**
   * True when the storage did not change and statements were given: a plan of
   * no operations then means the statements need none, not a planning failure.
   */
  noOperationsExpected: boolean,
  spaceId: string,
  ownership: SchemaOwnership,
  snapshotsImportPath: string,
  resolveImportSpecifier: ImportSpecifierResolver,
): Promise<Result<PlannerSuccess, PlannerLegFailure>> {
  const fromContract = origin.kind === 'contract' ? origin.contract : null;
  const fromSchema = migrations.contractToSchema(fromContract, frameworkComponents);
  const plannerResult = planner.plan({
    contract,
    schema: fromSchema,
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
    fromContract,
    origin: planOriginOf(fromContract),
    statements,
    frameworkComponents,
    spaceId,
    // Offline `migration plan` is the aggregate-of-(possibly one) degenerate
    // case: the same ownership consultation the live aggregate flow uses. A
    // from→to extra (a table removed from the contract) is not declared by any
    // space in the aggregate, so it stays a genuine drop; a table another
    // space owns is never dropped.
    ownership,
    snapshotsImportPath,
  });
  if (plannerResult.kind === 'failure') {
    return notOk({
      reason: 'refused',
      error: errorMigrationPlanningFailed({
        conflicts: castAs<readonly CliErrorConflict[]>(plannerResult.conflicts),
      }),
    });
  }

  // The operation at each position of the plan, or `undefined` where it is an unfilled placeholder.
  let resolved: readonly (MigrationPlanOperation | undefined)[] = [];
  let hasPlaceholders = false;
  try {
    resolved = await Promise.all(plannerResult.plan.operations);
    if (resolved.length === 0 && !noOperationsExpected) {
      return notOk({
        reason: 'noOperations',
        error: errorPlanProducedNoOperations(origin, destination),
      });
    }
  } catch (e) {
    if (CliStructuredError.is(e) && e.code === 'MIGRATION.UNFILLED_PLACEHOLDER') {
      hasPlaceholders = true;
      // The operations that DID resolve still matter: the data-loss questions
      // must see them, or a placeholder would smuggle a loss past them.
      // Writers stay gated on hasPlaceholders. A planner whose `operations`
      // accessor throws synchronously on an unfilled placeholder (rather than
      // rejecting one op's promise) exposes no operations at all.
      try {
        const settled = await Promise.allSettled(plannerResult.plan.operations);
        resolved = settled.map((entry) => (entry.status === 'fulfilled' ? entry.value : undefined));
      } catch {
        resolved = [];
      }
    } else {
      throw e;
    }
  }

  const plannedOps = resolved.filter((op): op is MigrationPlanOperation => op !== undefined);
  const position = resolvedPositions(resolved);
  return ok({
    plannedOps,
    migrationTsContent: plannerResult.plan.renderTypeScript(resolveImportSpecifier),
    hasPlaceholders,
    dataLoss: plannerResult.dataLoss.map(({ operationIndex, subject }) => ({
      operationIndex: position(operationIndex),
      subject,
      label:
        resolved[operationIndex]?.label ??
        subjectText(subject, { origin: fromContract ?? EMPTY_ORIGIN, renames: [] }),
    })),
    appliedStatements: reportAppliedStatements(
      plannerResult.appliedStatements.map((applied) => ({
        ...applied,
        operationIndexes: applied.operationIndexes.flatMap((index) => {
          const at = position(index);
          return at === undefined ? [] : [at];
        }),
      })),
      fromContract,
      contract,
      0,
    ),
  });
}

/**
 * Maps a position in the plan's operations to the position of that operation among those that
 * resolved, which is what a result's `operations` lists: `undefined` for an unfilled placeholder.
 */
function resolvedPositions(
  resolved: readonly (MigrationPlanOperation | undefined)[],
): (planIndex: number) => number | undefined {
  const positions: (number | undefined)[] = [];
  let next = 0;
  for (const op of resolved) {
    positions.push(op === undefined ? undefined : next);
    if (op !== undefined) next += 1;
  }
  return (planIndex) => positions[planIndex];
}

/**
 * The operations a result lists. For a leg with unfilled placeholders these are the operations
 * that resolved; the placeholders themselves are not operations yet.
 */
function operationSummaries(ops: readonly MigrationPlanOperation[]) {
  return ops.map((op) => ({ id: op.id, label: op.label, operationClass: op.operationClass }));
}

async function writePlannedMigrationPackage(
  packageDir: string,
  fromHash: string | null,
  toHash: string,
  createdAt: Date,
  leg: PlannerSuccess,
): Promise<void> {
  const opsForWrite = leg.hasPlaceholders ? [] : leg.plannedOps;
  const metadataWithInvariants: Omit<MigrationMetadata, 'migrationHash'> = {
    from: fromHash,
    to: toHash,
    providedInvariants: deriveProvidedInvariants(opsForWrite),
    createdAt: createdAt.toISOString(),
  };
  const metadata: MigrationMetadata = {
    ...metadataWithInvariants,
    migrationHash: computeMigrationHash(metadataWithInvariants, opsForWrite),
  };
  await writeMigrationPackage(packageDir, metadata, opsForWrite);
  await writeMigrationTs(packageDir, leg.migrationTsContent);
}

/**
 * Asks about every operation of the planned legs that would lose data, until each is answered,
 * before anything is written. A delete answer consents to the loss of its subject. A rename typed
 * at the prompt is a statement the plan did not have, so the delta is planned again with it, and
 * the loss it answered must be gone.
 */
async function answerPlannedDataLoss(input: {
  readonly baseline: PlannerSuccess | undefined;
  readonly delta: PlannerSuccess | undefined;
  readonly renames: readonly StatementText[];
  readonly consents: readonly StatementText[];
  readonly origin: ContractWithDomain;
  readonly originKnown: boolean;
  readonly keepDataByHand: ((subject: MigrationSubject) => string) | undefined;
  readonly destination: ContractWithDomain;
  readonly answer: AnswerPlanQuestions;
  readonly planDelta: (
    renames: readonly StatementText[],
  ) => Promise<Result<PlannerSuccess, CliStructuredError>>;
}): Promise<
  Result<
    {
      readonly delta: PlannerSuccess | undefined;
      readonly deletes: readonly AppliedStatementReport[];
    },
    CliStructuredError
  >
> {
  const legs = (delta: PlannerSuccess | undefined) => ({
    delta,
    dataLoss: [...(input.baseline?.dataLoss ?? []), ...(delta?.dataLoss ?? [])],
    accessWidening: [],
  });
  const answered = await askPlanQuestions({
    plan: legs(input.delta),
    askAccess: false,
    renames: input.renames,
    preAnswers: input.consents,
    consentAll: { delete: false, allow: false },
    origin: input.origin,
    originKnown: input.originKnown,
    keepDataByHand: input.keepDataByHand,
    destination: input.destination,
    answer: input.answer,
    replan: async (renames) => {
      const replanned = await input.planDelta(renames);
      return replanned.ok ? ok(legs(replanned.value)) : replanned;
    },
  });
  if (!answered.ok) return answered;
  const { delta } = answered.value.plan;
  const deletes = answered.value.consented.map((consented) =>
    reportConsentStatement(
      consented,
      (delta?.dataLoss ?? [])
        .filter(
          (loss) => migrationSubjectKey(loss.subject) === migrationSubjectKey(consented.subject),
        )
        .flatMap(({ operationIndex }) => (operationIndex === undefined ? [] : [operationIndex])),
    ),
  );
  return ok({ delta, deletes });
}

export interface MigrationPlanResult {
  readonly ok: boolean;
  readonly noOp: boolean;
  readonly from: string | null;
  readonly to: string;
  readonly dir?: string;
  readonly baselineDir?: string;
  /**
   * Extension-space migration packages materialised onto disk during this
   * `plan` run. Each entry names a `migrations/<spaceId>/<dirName>/`
   * tree the framework wrote alongside the app-space migration directory.
   * Empty when the project has no extension packs declaring a contract
   * space, or when every extension-space package is already on disk.
   *
   * Surfacing these in the result (rather than only via `ui.step` log
   * lines) makes the cross-space side effect explicit to JSON consumers
   * and the success-summary renderer — the same cross-space side effect
   * that `migrate` will replay.
   */
  readonly emittedExtensionDirs: readonly { readonly spaceId: string; readonly dirName: string }[];
  readonly operations: readonly {
    readonly id: string;
    readonly label: string;
    readonly operationClass: string;
  }[];
  /**
   * Operations of the auto-baseline package when this run wrote two packages
   * (`baselineDir` + `dir`). Kept separate from `operations` (the app-space
   * delta) so consumers keep reading `operations` as "the change", while
   * renderers and the destructive warn-summary still cover everything the
   * run wrote.
   */
  readonly baselineOperations?: readonly {
    readonly id: string;
    readonly label: string;
    readonly operationClass: string;
  }[];
  /**
   * Family-agnostic textual preview of the migration plan operations.
   * Replaces the previous `sql?: readonly string[]` field; consumers should
   * read `result.preview?.statements`.
   */
  readonly preview?: OperationPreview;
  readonly summary: string;
  /**
   * Origin-resolution caveats the user must see, e.g. the default `db` ref
   * sitting behind the graph tip. Rendered as warn summaries by the human
   * presentation and carried verbatim for JSON consumers.
   */
  readonly warnings?: readonly string[];
  /**
   * When true, `migration.ts` was written but contains unfilled
   * `placeholder(...)` calls. The user must edit the file and then run
   * `node migration.ts` to self-emit `ops.json` / `migration.json`.
   */
  readonly pendingPlaceholders?: boolean;
  /**
   * True when no `--from` was given and no `db` ref existed, so the origin
   * defaulted to the empty contract. Absent when the user named the origin.
   */
  readonly fromDefaulted?: boolean;
  /**
   * The statements the plan applied, in the order given, each with the
   * family's description and its number of operations. Empty when no
   * `--rename` was given.
   */
  readonly appliedStatements: readonly AppliedStatementReport[];
  readonly timings: {
    readonly total: number;
  };
}

export async function executeMigrationPlanCommand(
  options: MigrationPlanOptions,
  startTime: number,
  callbacks?: {
    readonly onContextResolved?: (ctx: {
      readonly configPath: string;
      readonly contractPath: string;
      readonly appMigrationsRelative: string;
    }) => void;
    readonly onSeeded?: (record: ContractSpaceSeedPhaseRecord) => void;
  },
): Promise<Result<MigrationPlanResult, CliStructuredError>> {
  // Guard the whole command, including the mutation prologue (context
  // resolution, from/to resolution, the contract-space seed phase): a throw
  // anywhere must surface as notOk(CliStructuredError), never as an
  // unhandled rejection past the Result contract.
  try {
    return await executeMigrationPlanCommandInner(options, startTime, callbacks);
  } catch (error) {
    return notOk(
      errorFromCaught(error, (message) => `Unexpected error during migration plan: ${message}`),
    );
  }
}

async function executeMigrationPlanCommandInner(
  options: MigrationPlanOptions,
  startTime: number,
  callbacks?: {
    readonly onContextResolved?: (ctx: {
      readonly configPath: string;
      readonly contractPath: string;
      readonly appMigrationsRelative: string;
    }) => void;
    readonly onSeeded?: (record: ContractSpaceSeedPhaseRecord) => void;
  },
): Promise<Result<MigrationPlanResult, CliStructuredError>> {
  const config = options.config;
  const cwd = options.cwd;
  const { configPath, migrationsDir, appMigrationsDir, appMigrationsRelative } =
    resolveMigrationPaths(config, cwd);

  const contractPathAbsolute = resolveContractPath(config);
  const contractPath = relative(cwd, contractPathAbsolute);

  callbacks?.onContextResolved?.({ configPath, contractPath, appMigrationsRelative });

  // Load contract file (the "to" contract)
  let contractJsonContent: string;
  try {
    contractJsonContent = await readFile(contractPathAbsolute, 'utf-8');
  } catch (error) {
    if (isEnoent(error)) {
      return notOk(
        errorFileNotFound(contractPathAbsolute, {
          why: `Contract file not found at ${contractPathAbsolute}`,
          fix: `Run \`{bin} contract emit\` to generate ${contractPath}, or update \`config.contract.output\` in ${configPath}`,
        }),
      );
    }
    return notOk(errorFromCaught(error, (message) => `Failed to read contract file: ${message}`));
  }

  // Construct the family instance up-front so on-disk contract reads cross the
  // serializer seam at the read site, not after the planner has already
  // started dispatching on raw shapes. See TML-2536.
  const stack = createControlStack(config);
  const familyInstance = config.family.create(stack);
  const controlAdapter = config.adapter.create(stack);

  let emittedContractJson: unknown;
  let toContract: Contract;
  try {
    emittedContractJson = castAs<unknown>(JSON.parse(contractJsonContent));
    toContract = familyInstance.deserializeContract(emittedContractJson);
  } catch (error) {
    return notOk(
      errorContractValidationFailed(
        `Contract at ${contractPathAbsolute} failed to deserialize: ${error instanceof Error ? error.message : String(error)}`,
        { where: { path: contractPathAbsolute } },
      ),
    );
  }

  const rawStorageHash = toContract.storage?.storageHash;
  if (typeof rawStorageHash !== 'string') {
    return notOk(
      errorContractValidationFailed('Contract is missing storageHash', {
        where: { path: contractPathAbsolute },
      }),
    );
  }
  let toStorageHash: string = rawStorageHash;

  // A destination named by `--to` resolves through the snapshot store, so its
  // entry already exists; only the emitted contract needs a snapshot written.
  let destinationInStore = false;

  let fromContract: Contract | null = null;
  let fromHash: string | null = null;
  let fromContractInStore = false;
  let isAutoBaseline = false;
  let fromDefaulted = false;

  const verifySnapshotContent = snapshotVerifierFor(config);
  const tolerantAggregateResult = await loadContractSpaceAggregateForCli({
    targetId: config.target.targetId,
    migrationsDir,
    appContract: toContract,
    extensions: config.extensions ?? [],
    deserializeContract: (json: unknown) => familyInstance.deserializeContract(json),
    ...ifDefined('verifySnapshotContent', verifySnapshotContent),
  });
  if (!tolerantAggregateResult.ok) {
    return notOk(tolerantAggregateResult.failure);
  }
  const resolutionSpace = tolerantAggregateResult.value.app;

  const resolutionResult = await resolveFromForPlan({
    optionsFrom: options.from,
    space: resolutionSpace,
  });

  if (!resolutionResult.ok) {
    return notOk(resolutionResult.failure);
  }

  const warnings: string[] = [];
  const warnForks = (forks: {
    readonly refName: string;
    readonly refHash: string;
    readonly outgoingTo: readonly string[];
  }): void => {
    warnings.push(
      `The default origin ref '${forks.refName}' points at ${forks.refHash}, which already has a migration leading to ${forks.outgoingTo.join(', ')}. Planning from it forks the migration graph; pass --from to choose the origin explicitly.`,
    );
  };

  switch (resolutionResult.value.kind) {
    case 'greenfield':
      fromDefaulted = resolutionResult.value.defaulted;
      break;
    case 'graph-node':
      fromHash = resolutionResult.value.fromHash;
      fromContract = resolutionResult.value.fromContract;
      if (resolutionResult.value.defaultOriginForks !== undefined) {
        warnForks(resolutionResult.value.defaultOriginForks);
      }
      break;
    case 'ref':
      fromHash = resolutionResult.value.fromHash;
      fromContract = resolutionResult.value.fromContract;
      fromContractInStore = true;
      if (resolutionResult.value.defaultOriginForks !== undefined) {
        warnForks(resolutionResult.value.defaultOriginForks);
      }
      break;
    case 'auto-baseline':
      fromHash = resolutionResult.value.fromHash;
      fromContract = resolutionResult.value.fromContract;
      fromContractInStore = true;
      isAutoBaseline = true;
      break;
  }
  const resolvedFrom = resolutionResult.value;
  const fromOrigin: PlanLegOriginWithContract =
    resolvedFrom.kind === 'greenfield'
      ? { kind: 'empty' }
      : {
          kind: 'contract',
          hash: resolvedFrom.fromHash,
          contract: resolvedFrom.fromContract,
        };

  // `--to <ref>` swaps the planner destination to an arbitrary resolved
  // contract (e.g. an ancestor / rollback target). The from-side resolution
  // above is untouched; only the destination + its snapshot store entry
  // change.
  if (options.to !== undefined) {
    const toResolution = await resolveToForPlan(options.to, {
      space: resolutionSpace,
    });
    if (!toResolution.ok) {
      return notOk(toResolution.failure);
    }
    toContract = toResolution.value.contract;
    toStorageHash = toResolution.value.hash;
    destinationInStore = true;
  }

  // Statements resolve against the two contracts now settled, before anything
  // is written. A plan from an empty database has no model to rename.
  let statements: readonly ResolvedMigrationStatement[] = [];
  const statementTexts = options.statements ?? [];
  if (statementTexts.length > 0) {
    const resolved = resolveStatements({
      statements: statementTexts,
      origin: { kind: 'contract', contract: fromContract ?? EMPTY_ORIGIN },
      destination: toContract,
    });
    if (!resolved.ok) {
      return notOk(resolved.failure);
    }
    statements = resolved.value;
  }

  // Before the seed phase, which is the first thing here that writes: an
  // unreadable or contradictory project manifest fails the command outright
  // rather than after artifacts are already on disk.
  const resolveImportSpecifier = createProjectSpecifierResolver(options.projectDir);

  // Likewise the destination snapshot's declarations: rendered now, written
  // with the planned package later. A plan whose source already is the
  // destination writes no new snapshot, so it renders nothing.
  let destinationDeclarations: string | null = null;
  if (!destinationInStore && fromHash !== toStorageHash) {
    const rendered = await renderSnapshotDeclarations({
      client: options.client,
      contractJson: emittedContractJson,
      contractJsonPath: contractPathAbsolute,
      resolveImportSpecifier,
    });
    if (!rendered.ok) {
      return notOk(rendered.failure);
    }
    destinationDeclarations = rendered.value;
  }

  // Phase 1 — seed: unconditionally re-emit per-space pinned artifacts
  // (contract.json / contract.d.ts / refs/head.json) and materialise any
  // descriptor-shipped migration packages not yet on disk. Runs before
  // the no-op check so that an extension bump alone (with no structural
  // app-space change) still re-pins extension artifacts on disk.
  const canonicalExtensionInputs = toExtensionInputs(config.extensions ?? []);
  const seedResult = await runContractSpaceSeedPhase({
    migrationsDir,
    extensions: canonicalExtensionInputs,
  });
  for (const record of seedResult.seeded) {
    callbacks?.onSeeded?.(record);
  }
  const emittedExtensionDirs = seedResult.seeded.flatMap((r) =>
    r.newMigrationDirs.map((dirName) => ({ spaceId: r.spaceId, dirName })),
  );

  // Check for no-op (same hash means no changes). Auto-baseline is exempt:
  // an empty graph with db ref at the current contract still needs a
  // null → fromHash baseline bundle so migrate can anchor the marker.
  if (fromHash === toStorageHash && !isAutoBaseline && statements.length === 0) {
    const result: MigrationPlanResult = {
      ok: true,
      noOp: true,
      from: fromHash,
      to: toStorageHash,
      operations: [],
      emittedExtensionDirs,
      ...(warnings.length > 0 ? { warnings } : {}),
      appliedStatements: [],
      summary: 'No changes detected between contracts',
      timings: { total: Date.now() - startTime },
    };
    return ok(result);
  }

  // Check target supports migrations
  const migrations = getTargetMigrations(config.target);
  if (!migrations) {
    return notOk(
      errorTargetMigrationNotSupported({
        why: `Target "${config.target.id}" does not support migrations`,
      }),
    );
  }

  // Phase 2 — load: build the aggregate against the now-consistent disk
  // state that phase 1 just seeded. The seed phase guarantees every
  // declared extension has its head ref pinned, so the loader's
  // declaredButUnmigrated precheck always passes here. The app contract
  // was already routed through `familyInstance.deserializeContract` at the
  // read site above (see TML-2536), so it's the hydrated `Contract`
  // here — no second validation pass needed.
  const aggregateResult = await buildContractSpaceAggregate({
    targetId: config.target.targetId,
    migrationsDir,
    appContract: toContract,
    extensions: config.extensions ?? [],
    deserializeContract: (json: unknown) => familyInstance.deserializeContract(json),
    ...ifDefined('verifySnapshotContent', verifySnapshotContent),
  });
  if (!aggregateResult.ok) {
    return notOk(aggregateResult.failure);
  }
  const aggregate = aggregateResult.value;

  const frameworkComponents = assertFrameworkComponentsCompatible(
    config.family.familyId,
    config.target.targetId,
    [config.target, config.adapter, ...(config.extensions ?? [])],
  );

  async function writeDestinationSnapshot(destHash: string): Promise<void> {
    if (destinationDeclarations === null) {
      return;
    }
    await writeContractSnapshot(migrationsDir, destHash, {
      contractJson: emittedContractJson,
      contractDts: destinationDeclarations,
    });
  }

  try {
    const planner = migrations.createPlanner(controlAdapter);
    const planDestination: PlanDestination = {
      hash: toStorageHash,
      isEmitted: options.to === undefined,
    };
    const answerDataLoss = (
      baseline: PlannerSuccess | undefined,
      delta: PlannerSuccess | undefined,
      planDelta: (
        resolved: readonly ResolvedMigrationStatement[],
      ) => Promise<Result<PlannerSuccess, PlannerLegFailure>>,
    ) =>
      answerPlannedDataLoss({
        baseline,
        delta,
        renames: statementTexts.filter((statement) => statement.verb === 'rename'),
        consents: statementTexts.filter((statement) => statement.verb !== 'rename'),
        origin: fromContract ?? EMPTY_ORIGIN,
        originKnown: true,
        keepDataByHand: keepDataByHandFor(migrations, fromContract ?? EMPTY_ORIGIN),
        destination: toContract,
        answer: options.answerQuestions,
        planDelta: async (renames) => {
          const resolved = resolveStatements({
            statements: renames,
            origin: { kind: 'contract', contract: fromContract ?? EMPTY_ORIGIN },
            destination: toContract,
          });
          if (!resolved.ok) return resolved;
          const leg = await planDelta(resolved.value);
          return leg.ok ? leg : notOk(leg.failure.error);
        },
      });

    if (isAutoBaseline && fromHash !== null && fromContract !== null && fromContractInStore) {
      const deltaTimestamp = new Date();
      const baselineTimestamp = new Date(deltaTimestamp.getTime() - 60_000);
      const baselineDirName = formatMigrationDirName(baselineTimestamp, 'baseline');
      const deltaDirName = formatMigrationDirName(deltaTimestamp, options.name ?? 'migration');
      const baselinePackageDir = join(appMigrationsDir, baselineDirName);
      const deltaPackageDir = join(appMigrationsDir, deltaDirName);

      const baselineLeg = await runPlannerLeg(
        planner,
        migrations,
        frameworkComponents,
        fromContract,
        { kind: 'baseline', hash: fromHash },
        { hash: fromHash, isEmitted: false },
        [],
        false,
        aggregate.app.spaceId,
        aggregate,
        snapshotsImportPathFrom(baselinePackageDir, migrationsDir),
        resolveImportSpecifier,
      );
      if (!baselineLeg.ok) {
        return notOk(baselineLeg.failure.error);
      }

      const planBaselineDelta = (resolved: readonly ResolvedMigrationStatement[]) =>
        runPlannerLeg(
          planner,
          migrations,
          frameworkComponents,
          aggregate.app.contract(),
          fromOrigin,
          planDestination,
          resolved,
          false,
          aggregate.app.spaceId,
          aggregate,
          snapshotsImportPathFrom(deltaPackageDir, migrationsDir),
          resolveImportSpecifier,
        );
      const plannedDelta =
        fromHash === toStorageHash ? undefined : await planBaselineDelta(statements);
      // A refused delta writes nothing. A delta with no operations still writes the baseline, so
      // the `migration new --from` its error advises has the history to start from.
      if (
        plannedDelta !== undefined &&
        !plannedDelta.ok &&
        plannedDelta.failure.reason === 'refused'
      ) {
        return notOk(plannedDelta.failure.error);
      }

      const answered = await answerDataLoss(
        baselineLeg.value,
        plannedDelta?.ok === true ? plannedDelta.value : undefined,
        planBaselineDelta,
      );
      if (!answered.ok) {
        return notOk(answered.failure);
      }
      const deltaLeg =
        plannedDelta === undefined || !plannedDelta.ok || answered.value.delta === undefined
          ? plannedDelta
          : ok(answered.value.delta);
      const deletes = answered.value.deletes;

      await writePlannedMigrationPackage(
        baselinePackageDir,
        null,
        fromHash,
        baselineTimestamp,
        baselineLeg.value,
      );

      if (deltaLeg !== undefined && !deltaLeg.ok) {
        return notOk(deltaLeg.failure.error);
      }

      if (deltaLeg === undefined) {
        const statementsWithoutOperations = reportAppliedStatements(
          statements.map((statement) => ({ statement, operationIndexes: [] })),
          fromContract,
          aggregate.app.contract(),
          0,
        );
        const baselineOps = baselineLeg.value.hasPlaceholders ? [] : baselineLeg.value.plannedOps;
        if (baselineLeg.value.hasPlaceholders) {
          const baselineDir = relative(cwd, baselinePackageDir);
          const result: MigrationPlanResult = {
            ok: true,
            noOp: false,
            from: fromHash,
            to: toStorageHash,
            dir: baselineDir,
            baselineDir,
            operations: operationSummaries(baselineLeg.value.plannedOps),
            emittedExtensionDirs,
            ...(warnings.length > 0 ? { warnings } : {}),
            pendingPlaceholders: true,
            appliedStatements: [...statementsWithoutOperations, ...deletes],
            summary:
              'Planned baseline with placeholder(s) — edit migration.ts then run `node migration.ts` to self-emit',
            timings: { total: Date.now() - startTime },
          };
          return ok(result);
        }

        const preview = hasOperationPreview(familyInstance)
          ? familyInstance.toOperationPreview(baselineOps)
          : undefined;
        const result: MigrationPlanResult = {
          ok: true,
          noOp: false,
          from: fromHash,
          to: toStorageHash,
          baselineDir: relative(cwd, baselinePackageDir),
          operations: baselineOps.map((op) => ({
            id: op.id,
            label: op.label,
            operationClass: op.operationClass,
          })),
          emittedExtensionDirs,
          ...(preview !== undefined ? { preview } : {}),
          ...(warnings.length > 0 ? { warnings } : {}),
          appliedStatements: [...statementsWithoutOperations, ...deletes],
          summary: buildAutoBaselinePlanSummary(baselineOps.length, 0, emittedExtensionDirs.length),
          timings: { total: Date.now() - startTime },
        };
        return ok(result);
      }

      await writePlannedMigrationPackage(
        deltaPackageDir,
        fromHash,
        toStorageHash,
        deltaTimestamp,
        deltaLeg.value,
      );
      await writeDestinationSnapshot(toStorageHash);

      const baselineOps = baselineLeg.value.hasPlaceholders ? [] : baselineLeg.value.plannedOps;
      const deltaOps = deltaLeg.value.hasPlaceholders ? [] : deltaLeg.value.plannedOps;
      if (baselineLeg.value.hasPlaceholders || deltaLeg.value.hasPlaceholders) {
        const result: MigrationPlanResult = {
          ok: true,
          noOp: false,
          from: fromHash,
          to: toStorageHash,
          dir: relative(cwd, deltaPackageDir),
          baselineDir: relative(cwd, baselinePackageDir),
          operations: operationSummaries(deltaLeg.value.plannedOps),
          baselineOperations: operationSummaries(baselineLeg.value.plannedOps),
          emittedExtensionDirs,
          ...(warnings.length > 0 ? { warnings } : {}),
          pendingPlaceholders: true,
          appliedStatements: [...deltaLeg.value.appliedStatements, ...deletes],
          summary:
            'Planned baseline + migration with placeholder(s) — edit migration.ts then run `node migration.ts` to self-emit',
          timings: { total: Date.now() - startTime },
        };
        return ok(result);
      }

      // The preview covers both legs — the consented destructive baseline DDL
      // must appear in the statements a user reads before applying.
      const preview = hasOperationPreview(familyInstance)
        ? familyInstance.toOperationPreview([...baselineOps, ...deltaOps])
        : undefined;
      const result: MigrationPlanResult = {
        ok: true,
        noOp: false,
        from: fromHash,
        to: toStorageHash,
        dir: relative(cwd, deltaPackageDir),
        baselineDir: relative(cwd, baselinePackageDir),
        operations: deltaOps.map((op) => ({
          id: op.id,
          label: op.label,
          operationClass: op.operationClass,
        })),
        baselineOperations: baselineOps.map((op) => ({
          id: op.id,
          label: op.label,
          operationClass: op.operationClass,
        })),
        emittedExtensionDirs,
        ...(preview !== undefined ? { preview } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
        appliedStatements: [...deltaLeg.value.appliedStatements, ...deletes],
        summary: buildAutoBaselinePlanSummary(
          baselineOps.length,
          deltaOps.length,
          emittedExtensionDirs.length,
        ),
        timings: { total: Date.now() - startTime },
      };
      return ok(result);
    }

    const timestamp = new Date();
    const slug = options.name ?? 'migration';
    const dirName = formatMigrationDirName(timestamp, slug);
    const packageDir = join(appMigrationsDir, dirName);

    const planDelta = (resolved: readonly ResolvedMigrationStatement[]) =>
      runPlannerLeg(
        planner,
        migrations,
        frameworkComponents,
        aggregate.app.contract(),
        fromOrigin,
        planDestination,
        resolved,
        resolved.length > 0 && fromHash === toStorageHash,
        aggregate.app.spaceId,
        aggregate,
        snapshotsImportPathFrom(packageDir, migrationsDir),
        resolveImportSpecifier,
      );
    const plannedDelta = await planDelta(statements);
    if (!plannedDelta.ok) {
      return notOk(plannedDelta.failure.error);
    }
    const answered = await answerDataLoss(undefined, plannedDelta.value, planDelta);
    if (!answered.ok) {
      return notOk(answered.failure);
    }
    const deltaLeg = ok(answered.value.delta ?? plannedDelta.value);
    const deletes = answered.value.deletes;

    if (!deltaLeg.value.hasPlaceholders && deltaLeg.value.plannedOps.length === 0) {
      const result: MigrationPlanResult = {
        ok: true,
        noOp: true,
        from: fromHash,
        to: toStorageHash,
        operations: [],
        emittedExtensionDirs,
        ...(warnings.length > 0 ? { warnings } : {}),
        appliedStatements: [...deltaLeg.value.appliedStatements, ...deletes],
        summary: 'No changes to plan: the statements need no operations',
        timings: { total: Date.now() - startTime },
      };
      return ok(result);
    }

    await writePlannedMigrationPackage(
      packageDir,
      fromHash,
      toStorageHash,
      timestamp,
      deltaLeg.value,
    );
    await writeDestinationSnapshot(toStorageHash);

    if (deltaLeg.value.hasPlaceholders) {
      const result: MigrationPlanResult = {
        ok: true,
        noOp: false,
        from: fromHash,
        to: toStorageHash,
        dir: relative(cwd, packageDir),
        operations: operationSummaries(deltaLeg.value.plannedOps),
        emittedExtensionDirs,
        ...(warnings.length > 0 ? { warnings } : {}),
        pendingPlaceholders: true,
        ...(fromDefaulted ? { fromDefaulted } : {}),
        appliedStatements: [...deltaLeg.value.appliedStatements, ...deletes],
        summary:
          'Planned migration with placeholder(s) — edit migration.ts then run `node migration.ts` to self-emit',
        timings: { total: Date.now() - startTime },
      };
      return ok(result);
    }

    const plannedOps = deltaLeg.value.plannedOps;
    const preview = hasOperationPreview(familyInstance)
      ? familyInstance.toOperationPreview(plannedOps)
      : undefined;
    const result: MigrationPlanResult = {
      ok: true,
      noOp: false,
      from: fromHash,
      to: toStorageHash,
      dir: relative(cwd, packageDir),
      operations: plannedOps.map((op) => ({
        id: op.id,
        label: op.label,
        operationClass: op.operationClass,
      })),
      emittedExtensionDirs,
      ...(preview !== undefined ? { preview } : {}),
      ...(fromDefaulted ? { fromDefaulted } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      appliedStatements: [...deltaLeg.value.appliedStatements, ...deletes],
      summary: buildPlanSummary(plannedOps.length, emittedExtensionDirs.length),
      timings: { total: Date.now() - startTime },
    };
    return ok(result);
  } catch (error) {
    return notOk(
      errorFromCaught(error, (message) => `Unexpected error during migration plan: ${message}`),
    );
  }
}

/**
 * Compose the success-line summary so the cross-space side effect
 * (extension-space migration packages materialised on disk during
 * this `plan` run) is visible in the top line — not just in the
 * step log above it.
 *
 * Example outputs:
 *   - `Planned 3 operation(s)` (app-space-only project)
 *   - `Planned 3 operation(s); materialised 1 extension-space migration` (one extension)
 *   - `Planned 3 operation(s); materialised 2 extension-space migrations` (two extensions)
 *
 * Locks AC3 at the summary-line level: a reader of the success line
 * can tell that something happened beyond the app space.
 */
function buildPlanSummary(plannedOpsCount: number, emittedExtensionDirsCount: number): string {
  const base = `Planned ${plannedOpsCount} operation(s)`;
  if (emittedExtensionDirsCount === 0) return base;
  const noun =
    emittedExtensionDirsCount === 1 ? 'extension-space migration' : 'extension-space migrations';
  return `${base}; materialised ${emittedExtensionDirsCount} ${noun}`;
}

function buildAutoBaselinePlanSummary(
  baselineOpsCount: number,
  deltaOpsCount: number,
  emittedExtensionDirsCount: number,
): string {
  const base = `Planned baseline (${baselineOpsCount} operation(s)) + ${deltaOpsCount} operation(s)`;
  if (emittedExtensionDirsCount === 0) return base;
  const noun =
    emittedExtensionDirsCount === 1 ? 'extension-space migration' : 'extension-space migrations';
  return `${base}; materialised ${emittedExtensionDirsCount} ${noun}`;
}
