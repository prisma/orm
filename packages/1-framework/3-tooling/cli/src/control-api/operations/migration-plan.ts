/**
 * Policy core of `migration plan`: resolves from/to contracts, runs the planner legs, and writes the planned migration packages.
 */

import { readFile } from 'node:fs/promises';
import type { PrismaNextConfig } from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import {
  createControlStack,
  hasOperationPreview,
  type MigrationPlanOperation,
  type OperationPreview,
  type SchemaOwnership,
} from '@internal/framework-components/control';
import {
  snapshotsImportPathFrom,
  writeContractSnapshot,
} from '@internal/migration-tools/contract-snapshot-store';
import { MigrationToolsError } from '@internal/migration-tools/errors';
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
  errorConsentPlanMismatch,
  errorContractValidationFailed,
  errorDestructiveChanges,
  errorFileNotFound,
  errorMigrationPlanningFailed,
  errorTargetMigrationNotSupported,
  errorUnexpected,
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
import type { ControlClient, DestructivePlanOperation } from '../types';
import {
  buildContractSpaceAggregate,
  loadContractSpaceAggregateForCli,
} from './contract-space-aggregate-loader';
import {
  type ContractSpaceSeedPhaseRecord,
  runContractSpaceSeedPhase,
} from './contract-space-seed-phase';
import { computePlanHash } from './plan-identity';
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
  /** Renders the declarations of the destination snapshot from its `contract.json`. */
  readonly client: Pick<ControlClient, 'renderContractDts'>;
  /**
   * Consent to the auto-baseline plan a prior `MIGRATION.DESTRUCTIVE_CHANGES`
   * refusal named by its `planHash`. The consented run recomputes the baseline
   * plan and refuses with `MIGRATION.CONSENT_PLAN_MISMATCH` when it differs.
   */
  readonly consent?: { readonly planHash: string };
  /**
   * Extension-space migration packages a refused first run of this same
   * invocation already materialised. The consented re-run finds them on disk
   * (its seed phase reports `unchanged`), so the caller threads them back in
   * to keep `emittedExtensionDirs` and the summary describing the whole
   * invocation, not just the second run.
   */
  readonly carryEmittedExtensionDirs?: readonly {
    readonly spaceId: string;
    readonly dirName: string;
  }[];
}

/** The verdict a `MIGRATION.DESTRUCTIVE_CHANGES` plan refusal carries in its meta. */
export interface DestructiveBaselineVerdict {
  readonly destructiveOperations: ReadonlyArray<DestructivePlanOperation>;
  /** Content hash of the refused baseline plan; consent is granted against it. */
  readonly planHash: string;
}

type PlannerSuccess = {
  readonly plannedOps: readonly MigrationPlanOperation[];
  readonly migrationTsContent: string;
  readonly hasPlaceholders: boolean;
};

type TargetMigrationsApi = NonNullable<ReturnType<typeof getTargetMigrations>>;

async function runPlannerLeg(
  planner: ReturnType<TargetMigrationsApi['createPlanner']>,
  migrations: TargetMigrationsApi,
  frameworkComponents: ReturnType<typeof assertFrameworkComponentsCompatible>,
  contract: Contract,
  fromContract: Contract | null,
  spaceId: string,
  ownership: SchemaOwnership,
  snapshotsImportPath: string,
  resolveImportSpecifier: ImportSpecifierResolver,
): Promise<Result<PlannerSuccess, CliStructuredError>> {
  const fromSchema = migrations.contractToSchema(fromContract, frameworkComponents);
  const plannerResult = planner.plan({
    contract,
    schema: fromSchema,
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
    fromContract,
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
    return notOk(
      errorMigrationPlanningFailed({
        conflicts: castAs<readonly CliErrorConflict[]>(plannerResult.conflicts),
      }),
    );
  }

  let plannedOps: readonly MigrationPlanOperation[] = [];
  let hasPlaceholders = false;
  try {
    plannedOps = await Promise.all(plannerResult.plan.operations);
    if (plannedOps.length === 0) {
      return notOk(
        errorMigrationPlanningFailed({
          conflicts: [
            {
              kind: 'unsupportedChange',
              summary:
                'Contract changed but planner produced no operations. ' +
                'This indicates unsupported or ignored changes.',
            },
          ],
        }),
      );
    }
  } catch (e) {
    if (CliStructuredError.is(e) && e.code === 'MIGRATION.UNFILLED_PLACEHOLDER') {
      hasPlaceholders = true;
      // The operations that DID resolve still matter: the destructive-consent
      // check must see them, or a placeholder would smuggle a destructive
      // baseline past the prompt. Writers stay gated on hasPlaceholders. A
      // planner whose `operations` accessor throws synchronously on an
      // unfilled placeholder (rather than rejecting one op's promise) exposes
      // no operations at all; the check then sees none.
      try {
        const settled = await Promise.allSettled(plannerResult.plan.operations);
        plannedOps = settled.flatMap((entry) =>
          entry.status === 'fulfilled' ? [entry.value] : [],
        );
      } catch {
        plannedOps = [];
      }
    } else {
      throw e;
    }
  }

  return ok({
    plannedOps,
    migrationTsContent: plannerResult.plan.renderTypeScript(resolveImportSpecifier),
    hasPlaceholders,
  });
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
 * The consent check for an auto-baseline write, mirroring `db update`'s
 * destructive-changes refusal: a baseline leg carrying destructive operations
 * is only written when the caller consents to that exact plan by its hash.
 * Runs before the baseline and delta packages are written, so a refusal
 * leaves the app-space migrations directory untouched (the extension seed
 * phase runs earlier and unconditionally, as it does for no-op runs).
 * A leg with unfilled placeholders is still checked over the operations
 * that did resolve. Returns `null` when the write may proceed.
 */
function refuseUnconsentedDestructiveBaseline(
  leg: PlannerSuccess,
  baselineToHash: string,
  consent: { readonly planHash: string } | undefined,
): CliStructuredError | null {
  const ops = leg.plannedOps;
  const destructiveOps = ops.filter((op) => op.operationClass === 'destructive');
  if (destructiveOps.length === 0) {
    return null;
  }
  const planHash = computePlanHash({
    operations: ops.map((op) => ({
      id: op.id,
      label: op.label,
      operationClass: op.operationClass,
    })),
    destination: { storageHash: baselineToHash },
  });
  if (consent === undefined) {
    const verdict: DestructiveBaselineVerdict = {
      destructiveOperations: destructiveOps.map((op) => ({ id: op.id, label: op.label })),
      planHash,
    };
    return errorDestructiveChanges(
      `The baseline migration contains ${destructiveOps.length} destructive operation(s) that require confirmation`,
      {
        why: 'The migrations directory is empty, so planning writes a baseline derived from the `db` ref — and that baseline contains operations that would remove data when the migration is applied.',
        fix: 'Re-run `prisma migration plan` and type the project directory name when asked, or pass `--no-interactive --confirm <directory>` where there is nobody to ask.',
        meta: { ...verdict },
      },
    );
  }
  if (consent.planHash !== planHash) {
    return errorConsentPlanMismatch({ consentedPlanHash: consent.planHash, planHash });
  }
  return null;
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
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    const message = error instanceof Error ? error.message : String(error);
    return notOk(
      errorUnexpected(message, {
        why: `Unexpected error during migration plan: ${message}`,
      }),
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
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to read contract file: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
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
  const seededThisRun = seedResult.seeded.flatMap((r) =>
    r.newMigrationDirs.map((dirName) => ({ spaceId: r.spaceId, dirName })),
  );
  const carried = options.carryEmittedExtensionDirs ?? [];
  const emittedExtensionDirs = [
    ...carried,
    ...seededThisRun.filter(
      (entry) =>
        !carried.some(
          (prior) => prior.spaceId === entry.spaceId && prior.dirName === entry.dirName,
        ),
    ),
  ];

  // Check for no-op (same hash means no changes). Auto-baseline is exempt:
  // an empty graph with db ref at the current contract still needs a
  // null → fromHash baseline bundle so migrate can anchor the marker.
  if (fromHash === toStorageHash && !isAutoBaseline) {
    const result: MigrationPlanResult = {
      ok: true,
      noOp: true,
      from: fromHash,
      to: toStorageHash,
      operations: [],
      emittedExtensionDirs,
      ...(warnings.length > 0 ? { warnings } : {}),
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

    if (isAutoBaseline && fromHash !== null && fromContract !== null && fromContractInStore) {
      const baselineTimestamp = new Date();
      const deltaTimestamp = new Date(baselineTimestamp.getTime() + 60_000);
      const baselineDirName = formatMigrationDirName(baselineTimestamp, 'baseline');
      const deltaDirName = formatMigrationDirName(deltaTimestamp, options.name ?? 'migration');
      const baselinePackageDir = join(appMigrationsDir, baselineDirName);
      const deltaPackageDir = join(appMigrationsDir, deltaDirName);

      const baselineLeg = await runPlannerLeg(
        planner,
        migrations,
        frameworkComponents,
        fromContract,
        null,
        aggregate.app.spaceId,
        aggregate,
        snapshotsImportPathFrom(baselinePackageDir, migrationsDir),
        resolveImportSpecifier,
      );
      if (!baselineLeg.ok) {
        return notOk(baselineLeg.failure);
      }

      const consentFailure = refuseUnconsentedDestructiveBaseline(
        baselineLeg.value,
        fromHash,
        options.consent,
      );
      if (consentFailure !== null) {
        return notOk(consentFailure);
      }

      await writePlannedMigrationPackage(
        baselinePackageDir,
        null,
        fromHash,
        baselineTimestamp,
        baselineLeg.value,
      );

      if (fromHash === toStorageHash) {
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
            operations: [],
            emittedExtensionDirs,
            ...(warnings.length > 0 ? { warnings } : {}),
            pendingPlaceholders: true,
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
          summary: buildAutoBaselinePlanSummary(baselineOps.length, 0, emittedExtensionDirs.length),
          timings: { total: Date.now() - startTime },
        };
        return ok(result);
      }

      const deltaLeg = await runPlannerLeg(
        planner,
        migrations,
        frameworkComponents,
        aggregate.app.contract(),
        fromContract,
        aggregate.app.spaceId,
        aggregate,
        snapshotsImportPathFrom(deltaPackageDir, migrationsDir),
        resolveImportSpecifier,
      );
      if (!deltaLeg.ok) {
        return notOk(deltaLeg.failure);
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
          operations: [],
          emittedExtensionDirs,
          ...(warnings.length > 0 ? { warnings } : {}),
          pendingPlaceholders: true,
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

    const deltaLeg = await runPlannerLeg(
      planner,
      migrations,
      frameworkComponents,
      aggregate.app.contract(),
      fromContract,
      aggregate.app.spaceId,
      aggregate,
      snapshotsImportPathFrom(packageDir, migrationsDir),
      resolveImportSpecifier,
    );
    if (!deltaLeg.ok) {
      return notOk(deltaLeg.failure);
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
        operations: [],
        emittedExtensionDirs,
        ...(warnings.length > 0 ? { warnings } : {}),
        pendingPlaceholders: true,
        ...(fromDefaulted ? { fromDefaulted } : {}),
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
      summary: buildPlanSummary(plannedOps.length, emittedExtensionDirs.length),
      timings: { total: Date.now() - startTime },
    };
    return ok(result);
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    if (MigrationToolsError.is(error)) {
      return notOk(error);
    }
    const message = error instanceof Error ? error.message : String(error);
    return notOk(
      errorUnexpected(message, {
        why: `Unexpected error during migration plan: ${message}`,
      }),
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
