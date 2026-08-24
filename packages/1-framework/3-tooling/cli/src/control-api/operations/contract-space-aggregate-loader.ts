import { readFile } from 'node:fs/promises';
import type { PrismaNextConfig } from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import type {
  ContractSpaceAggregate,
  DeclaredExtensionEntry,
  IntegrityQueryOptions,
  IntegrityViolation,
} from '@internal/migration-tools/aggregate';
import { loadContractSpaceAggregate } from '@internal/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { MigrationToolsError } from '@internal/migration-tools/errors';
import { blindCast } from '@internal/utils/casts';
import { notOk, ok, type Result } from '@internal/utils/result';
import { CliStructuredError, errorUnexpected } from '../../utils/cli-errors';
import { readContractEnvelope, resolveContractPath } from '../../utils/command-helpers';
import { toDeclaredExtensionsFromRaw } from '../../utils/extension-pack-inputs';

const CONTRACT_SPACES_DOCS_URL = 'https://pris.ly/contract-spaces';

function contractSpaceViolationError(
  summary: string,
  options: {
    readonly why: string;
    readonly fix: string;
    readonly violations: readonly IntegrityViolation[];
  },
): CliStructuredError {
  return new CliStructuredError('MIGRATION.CONTRACT_SPACE_VIOLATION', summary, {
    why: options.why,
    fix: options.fix,
    docsUrl: CONTRACT_SPACES_DOCS_URL,
    meta: { violations: options.violations },
  });
}

/**
 * Build the `MIGRATION.CONTRACT_SPACE_VIOLATION` structured-error envelope for a contract-space
 * target mismatch. Shared between the declared-extension precheck (the
 * descriptor's configured target disagrees with the project target) and
 * the on-disk-contract check surfaced by `checkIntegrity`.
 */
function targetMismatchError(
  spaceId: string,
  expected: string,
  actual: string,
): CliStructuredError {
  return contractSpaceViolationError(`Contract-space target mismatch for "${spaceId}"`, {
    why: `Space "${spaceId}" targets "${actual}" but the project's adapter targets "${expected}".`,
    fix: 'Update the extension descriptor to target the configured database, or change the project adapter.',
    violations: [{ kind: 'targetMismatch', spaceId, expected, actual }],
  });
}

/**
 * Human-readable detail for an integrity violation, used as the `why`
 * of the `integrityFailure` envelope. Mirrors the messages the prior
 * throw-on-load loader produced so downstream consumers see the same
 * text for the same on-disk state.
 */
function describeIntegrityViolation(violation: IntegrityViolation): string {
  switch (violation.kind) {
    case 'hashMismatch':
      return `Migration "${violation.dirName}" stored hash "${violation.stored}" does not match computed hash "${violation.computed}".`;
    case 'providedInvariantsMismatch':
      return `Migration "${violation.dirName}" providedInvariants in migration.json disagrees with ops.json.`;
    case 'packageUnloadable':
      return `Migration "${violation.dirName}" could not be loaded: ${violation.detail}`;
    case 'sameSourceAndTarget':
      return `Migration "${violation.dirName}" has source equal to target (${violation.hash}) with no data invariant — a true no-op self-edge.`;
    case 'headRefMissing':
      return `Head ref \`refs/head.json\` is missing for contract space "${violation.spaceId}".`;
    case 'headRefNotInGraph':
      return `Head ref ${violation.hash} for contract space "${violation.spaceId}" is not present in the migration graph.`;
    case 'refUnreadable':
      return `Ref "${violation.refName}" for contract space "${violation.spaceId}" is unreadable: ${violation.detail}`;
    case 'duplicateMigrationHash':
      return `Multiple migrations in space "${violation.spaceId}" share migrationHash "${violation.migrationHash}" (${violation.dirNames.join(', ')}).`;
    default: {
      const spaceId = 'spaceId' in violation ? violation.spaceId : '*';
      return `Integrity violation "${violation.kind}" for contract space "${spaceId}".`;
    }
  }
}

/**
 * Map the integrity violations `checkIntegrity` reports into a single
 * CLI structured-error envelope, preserving the error codes the prior
 * throw-on-load loader emitted: `MIGRATION.CONTRACT_SPACE_LAYOUT_VIOLATION`
 * (layout drift, bundled) and `MIGRATION.CONTRACT_SPACE_VIOLATION` (target /
 * disjointness / contract-validation / structural integrity). Returns
 * `null` when there is nothing to refuse on.
 *
 * Precedence reproduces the prior loader's first-failure ordering:
 * layout drift first (every offence bundled into one envelope), then
 * target mismatch, then disjointness, then a contract-validation
 * failure, then any remaining structural integrity violation.
 */
export function mapIntegrityViolations(
  violations: readonly IntegrityViolation[],
  migrationsDir: string,
): CliStructuredError | null {
  if (violations.length === 0) return null;

  const layout = violations.filter(
    (v): v is Extract<IntegrityViolation, { kind: 'orphanSpaceDir' | 'declaredButUnmigrated' }> =>
      v.kind === 'orphanSpaceDir' || v.kind === 'declaredButUnmigrated',
  );
  if (layout.length > 0) {
    const lines = layout.map((v) => `- [${v.kind}] ${v.spaceId}`);
    const summary =
      layout.length === 1
        ? 'Contract-space layout violation detected'
        : `Contract-space layout violations detected (${layout.length})`;
    return new CliStructuredError('MIGRATION.CONTRACT_SPACE_LAYOUT_VIOLATION', summary, {
      why: `The on-disk \`${migrationsDir}/\` directory and your \`extensions\` declaration are not in agreement.\n${lines.join('\n')}`,
      fix: `Declare the extension in \`extensions\` and re-emit its contract-space artefacts, or remove the orphan \`${migrationsDir}/<space>\` directory.`,
      docsUrl: CONTRACT_SPACES_DOCS_URL,
      meta: { violations: layout },
    });
  }

  const targetMismatch = violations.find((v) => v.kind === 'targetMismatch');
  if (targetMismatch && targetMismatch.kind === 'targetMismatch') {
    return targetMismatchError(
      targetMismatch.spaceId,
      targetMismatch.expected,
      targetMismatch.actual,
    );
  }

  const disjointness = violations.find((v) => v.kind === 'disjointness');
  if (disjointness && disjointness.kind === 'disjointness') {
    return contractSpaceViolationError(
      `Contract-space disjointness violation: storage element "${disjointness.element}" claimed by multiple spaces`,
      {
        why: `Spaces ${disjointness.claimedBy.map((s) => `"${s}"`).join(', ')} all claim the storage element "${disjointness.element}". Each storage element must be owned by exactly one contract space.`,
        fix: 'Update the conflicting contracts so each storage element is claimed by exactly one space.',
        violations: [disjointness],
      },
    );
  }

  const contractUnreadable = violations.find((v) => v.kind === 'contractUnreadable');
  if (contractUnreadable && contractUnreadable.kind === 'contractUnreadable') {
    return contractSpaceViolationError(
      `Contract-space contract validation failed for "${contractUnreadable.spaceId}"`,
      {
        why: contractUnreadable.detail,
        fix: 'Re-emit the extension contract with `{bin} contract emit`, or fix the extension pack descriptor producing the invalid contract.',
        violations: [contractUnreadable],
      },
    );
  }

  // Any remaining recoverable structural violation refuses as an
  // integrity failure, surfacing the first one's detail (every violation
  // is still computed; the gate just renders one envelope).
  const structural = violations[0]!;
  const spaceId = 'spaceId' in structural ? structural.spaceId : '*';
  return contractSpaceViolationError(`Contract-space integrity failure for "${spaceId}"`, {
    why: describeIntegrityViolation(structural),
    fix: `Re-emit the affected migration package(s) or restore the on-disk \`${migrationsDir}\` directory from version control.`,
    violations: [structural],
  });
}

/**
 * Inputs needed to compose the aggregate loader at the CLI surface.
 *
 * Keeps the loader framework-neutral (no `Config` import) by accepting
 * already-resolved structural inputs: validated app contract, target
 * id, migrations root directory, and the set of extension descriptors.
 */
export interface BuildAggregateInputs<TFamilyId extends string, TTargetId extends string> {
  readonly targetId: TTargetId;
  readonly migrationsDir: string;
  readonly appContract: Contract;
  readonly extensions: ReadonlyArray<ControlExtensionDescriptor<TFamilyId, TTargetId>>;
  readonly deserializeContract: (contractJson: unknown) => Contract;
}

function declaredExtensionsFromInputs(
  extensions: BuildAggregateInputs<string, string>['extensions'],
): readonly DeclaredExtensionEntry[] {
  return toDeclaredExtensionsFromRaw(extensions as ReadonlyArray<unknown>);
}

/**
 * Reject extension descriptors whose configured target disagrees with
 * the project target before any on-disk read.
 */
export function refuseDeclaredExtensionTargetMismatch<
  TFamilyId extends string,
  TTargetId extends string,
>(inputs: BuildAggregateInputs<TFamilyId, TTargetId>): CliStructuredError | null {
  for (const declared of declaredExtensionsFromInputs(inputs.extensions)) {
    if (declared.targetId !== inputs.targetId) {
      return targetMismatchError(declared.id, inputs.targetId, declared.targetId);
    }
  }
  return null;
}

/**
 * Load the tolerant {@link ContractSpaceAggregate} once at the CLI
 * surface. Construction never throws on disk content; callers query
 * {@link ContractSpaceAggregate.app} / extension facets instead of
 * re-reading `migrations/`.
 */
export async function loadContractSpaceAggregateForCli<
  TFamilyId extends string,
  TTargetId extends string,
>(
  inputs: BuildAggregateInputs<TFamilyId, TTargetId>,
): Promise<Result<ContractSpaceAggregate, CliStructuredError>> {
  const targetFailure = refuseDeclaredExtensionTargetMismatch(inputs);
  if (targetFailure) {
    return notOk(targetFailure);
  }

  const aggregate = await loadContractSpaceAggregate({
    migrationsDir: inputs.migrationsDir,
    deserializeContract: inputs.deserializeContract,
    appContract: inputs.appContract,
  });
  return ok(aggregate);
}

/**
 * Run `checkIntegrity` on a loaded aggregate and map violations into
 * the contract-space refusal envelope, or return `null` when the model
 * is acceptable for the requested check scope.
 */
export function refuseContractSpaceIntegrity(
  aggregate: ContractSpaceAggregate,
  options: IntegrityQueryOptions,
  migrationsDir: string,
): CliStructuredError | null {
  return mapIntegrityViolations(aggregate.checkIntegrity(options), migrationsDir);
}

const PACKAGE_CORRUPTION_KINDS = new Set<IntegrityViolation['kind']>([
  'hashMismatch',
  'providedInvariantsMismatch',
  'packageUnloadable',
]);

/**
 * Reader-subset integrity refusal for `migration status`: package
 * corruptions only (`hashMismatch`, `providedInvariantsMismatch`,
 * `packageUnloadable`).
 */
export function refusePackageCorruptionOnAggregate(
  aggregate: ContractSpaceAggregate,
  migrationsDir: string,
): CliStructuredError | null {
  const corruption = aggregate.checkIntegrity().filter((v) => PACKAGE_CORRUPTION_KINDS.has(v.kind));
  return mapIntegrityViolations(corruption, migrationsDir);
}

/**
 * Construct the tolerant {@link ContractSpaceAggregate} at the CLI
 * surface and apply the explicit integrity refusal.
 *
 * App-space migration packages are read from `migrations/<app>/` by the
 * loader itself; callers no longer thread them through.
 */
export async function buildContractSpaceAggregate<
  TFamilyId extends string,
  TTargetId extends string,
>(
  inputs: BuildAggregateInputs<TFamilyId, TTargetId>,
): Promise<Result<ContractSpaceAggregate, CliStructuredError>> {
  const declaredExtensions = declaredExtensionsFromInputs(inputs.extensions);
  const loaded = await loadContractSpaceAggregateForCli(inputs);
  if (!loaded.ok) {
    return loaded;
  }
  const failure = refuseContractSpaceIntegrity(
    loaded.value,
    {
      declaredExtensions,
      checkContracts: true,
    },
    inputs.migrationsDir,
  );
  if (failure) {
    return notOk(failure);
  }
  return ok(loaded.value);
}

/**
 * Build a minimal app {@link Contract} carrying only the project's
 * contract-identity (`storage.storageHash` + `target` / `targetFamily`)
 * when the real `contract.json` is absent or undeserializable.
 *
 * `loadContractSpaceAggregate` requires an `appContract` to synthesise the
 * app space's head ref from its storage hash. Read commands query only that
 * hash and the target — never `models` — so an empty-`models` stand-in is
 * sufficient for them. It is *not* a valid contract for any consumer that
 * reads schema, which is why this is confined to the read-aggregate path.
 */
export function appContractStandInFromIdentity(args: {
  readonly contractHash: string;
  readonly targetId: string;
  readonly targetFamily: string;
}): Contract {
  return blindCast<
    Contract,
    'read-aggregate consumers query only storage.storageHash and target; empty models stand in for an unreadable contract.json'
  >({
    storage: { storageHash: args.contractHash },
    schemaVersion: '0.0.0',
    target: args.targetId,
    targetFamily: args.targetFamily,
    models: {},
    profileHash: EMPTY_CONTRACT_HASH,
  });
}

export async function loadContractRawSafely(config: {
  contract?: { output?: string };
}): Promise<unknown | null> {
  try {
    const path = resolveContractPath(config);
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Tolerant {@link ContractSpaceAggregate} assembly for read-only CLI
 * commands. No integrity gate — callers query `aggregate.app` (or other
 * facets) without re-reading `migrations/`. When `contract.json` is absent
 * or undeserializable, the app contract falls back to an identity-only
 * stand-in ({@link appContractStandInFromIdentity}), so these commands
 * load without requiring a readable contract.
 */
export async function buildReadAggregate(
  config: PrismaNextConfig,
  options: { readonly migrationsDir: string },
): Promise<
  Result<
    { readonly aggregate: ContractSpaceAggregate; readonly contractHash: string },
    CliStructuredError
  >
> {
  let contractHash: string = EMPTY_CONTRACT_HASH;
  try {
    const envelope = await readContractEnvelope(config);
    contractHash = envelope.storageHash;
  } catch {
    // Contract unreadable — marker uses EMPTY_CONTRACT_HASH
  }

  try {
    const contractRawForAggregate = await loadContractRawSafely(config);
    const stack = createControlStack(config);
    const familyInstance = config.family.create(stack);
    const deserializeContract = (json: unknown): Contract =>
      familyInstance.deserializeContract(json);
    let appContractForLoad: Contract = appContractStandInFromIdentity({
      contractHash,
      targetId: config.target.id,
      targetFamily: config.target.familyId,
    });
    if (contractRawForAggregate !== null) {
      try {
        appContractForLoad = deserializeContract(contractRawForAggregate);
      } catch {
        // Deserialization failed — identity-only stand-in fallback
      }
    }

    const loaded = await loadContractSpaceAggregateForCli({
      targetId: config.target.id,
      migrationsDir: options.migrationsDir,
      appContract: appContractForLoad,
      extensions: config.extensions ?? [],
      deserializeContract,
    });
    if (!loaded.ok) {
      return loaded;
    }
    return ok({ aggregate: loaded.value, contractHash });
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(error);
    }
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to read migrations directory: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }
}
