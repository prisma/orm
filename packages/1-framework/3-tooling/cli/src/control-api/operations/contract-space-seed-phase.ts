import { materialiseExtensionMigrationPackageIfMissing } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import type { MigrationOps } from '@internal/migration-tools/package';
import {
  emitContractSpaceArtifacts,
  planAllSpaces,
  readContractSpaceHeadRef,
  type SpacePlanOutput,
  spaceMigrationDirectory,
} from '@internal/migration-tools/spaces';
import { join } from 'pathe';

/**
 * In-memory authored migration package shipped by an extension descriptor.
 * Mirrors `MigrationPackage` from `@internal/migration-tools/io` (the
 * on-disk shape minus `dirPath`); redeclared structurally here so the
 * CLI helper does not couple to any family's `ExtensionMigrationPackage`
 * type — any family that ships pre-built migration packages can pass
 * them through unchanged.
 */
export interface DescriptorMigrationPackage {
  readonly dirName: string;
  readonly metadata: MigrationMetadata;
  readonly ops: MigrationOps;
}

/**
 * Minimal descriptor view consumed by the seed phase. Mirrors the shape
 * the SQL family ships on each declared extension entry; only the fields
 * the seed phase needs are surfaced.
 */
export interface SeedPhaseExtensionInput {
  readonly id: string;
  readonly contractSpace?: {
    readonly contractJson: unknown;
    readonly headRef: { readonly hash: string; readonly invariants: readonly string[] };
    readonly migrations: readonly DescriptorMigrationPackage[];
  };
}

export interface ContractSpaceSeedPhaseInputs {
  readonly migrationsDir: string;
  readonly extensions: ReadonlyArray<SeedPhaseExtensionInput>;
  readonly signal?: AbortSignal;
}

/**
 * One per-space record describing what the seed phase did for an
 * extension contract space. Surfaced verbatim by the caller (typically
 * `migration plan`) so users see a single line per touched extension.
 *
 * - `action: 'updated'` — either the on-disk head pointer changed, or
 *   one or more new descriptor-shipped migration packages were
 *   materialised into `migrations/<spaceId>/<dirName>/`.
 * - `action: 'unchanged'` — the on-disk head already matched the
 *   descriptor and no new migration packages needed to be written.
 *
 * Either way, the artifacts (`contract.json`, `contract.d.ts`,
 * `refs/head.json`) are re-emitted: the framework owns those files and
 * makes the re-emit observably idempotent at the byte level.
 */
export interface ContractSpaceSeedPhaseRecord {
  readonly spaceId: string;
  readonly action: 'updated' | 'unchanged';
  readonly priorHash: string | null;
  readonly newHash: string;
  readonly newMigrationDirs: readonly string[];
  /** Absolute path of each file or directory this run wrote for the space: the head snapshot, `refs/head.json`, and each new migration directory. */
  readonly writtenPaths: readonly string[];
}

export interface ContractSpaceSeedPhaseResult {
  readonly seeded: readonly ContractSpaceSeedPhaseRecord[];
}

/**
 * Phase-1 of the two-phase `migration plan` pipeline (sub-spec § 4), and the
 * step of `contract emit` that writes each pack's pinned files.
 *
 * For every extension that exposes a `contractSpace`:
 *
 * 1. Read the on-disk head ref (returns `null` on first emit).
 * 2. Write the head contract into the migrations-root snapshot store
 *    (write-if-absent, keyed by hash) and unconditionally re-emit
 *    `refs/head.json`, via {@link emitContractSpaceArtifacts}. The
 *    framework owns `refs/head.json`; re-emit is the contract for that
 *    file. The snapshot itself is only written once per distinct hash.
 * 3. Materialise any descriptor-shipped migration packages not yet on
 *    disk via {@link materialiseExtensionMigrationPackageIfMissing}.
 *    Existing packages are left untouched (by-existence skip).
 *
 * The return value lets the caller render a per-space status line and
 * lets the phase-2 aggregate loader run on a now-consistent disk state
 * (every loaded extension is guaranteed to have its head ref pinned
 * to the descriptor's hash and to ship every package the descriptor
 * declares).
 *
 * Output ordering is deterministic and alphabetical by spaceId (via
 * {@link planAllSpaces}, which also detects duplicate spaceIds). This
 * matches the canonical sort order used by every other aggregate
 * surface (`migrate`, `migration status`, the runner).
 */
export async function runContractSpaceSeedPhase(
  inputs: ContractSpaceSeedPhaseInputs,
): Promise<ContractSpaceSeedPhaseResult> {
  const planInputs = inputs.extensions
    .filter(
      (
        pack,
      ): pack is SeedPhaseExtensionInput & {
        contractSpace: NonNullable<SeedPhaseExtensionInput['contractSpace']>;
      } => pack.contractSpace !== undefined,
    )
    .map((pack) => ({
      spaceId: pack.id,
      priorContract: null,
      newContract: pack.contractSpace.contractJson,
      __pack: pack.contractSpace,
    }));

  // `planAllSpaces` brings deterministic alphabetical ordering and
  // duplicate-spaceId detection. The "planner" callback is a no-op
  // pass-through that simply returns the descriptor's pre-built
  // migration packages.
  const planned: readonly SpacePlanOutput<DescriptorMigrationPackage>[] = planAllSpaces(
    planInputs,
    (input) =>
      (
        input as typeof input & {
          readonly __pack: NonNullable<SeedPhaseExtensionInput['contractSpace']>;
        }
      ).__pack.migrations,
  );

  // Reassemble a spaceId → descriptor lookup so the loop below can read
  // the contractJson / headRef without leaking the typed-cast back into
  // `planAllSpaces`'s output shape.
  const descriptorBySpace = new Map<
    string,
    NonNullable<SeedPhaseExtensionInput['contractSpace']>
  >();
  for (const pack of inputs.extensions) {
    if (pack.contractSpace !== undefined) descriptorBySpace.set(pack.id, pack.contractSpace);
  }

  const seeded: ContractSpaceSeedPhaseRecord[] = [];
  for (const space of planned) {
    const descriptor = descriptorBySpace.get(space.spaceId);
    if (descriptor === undefined) continue;

    inputs.signal?.throwIfAborted();
    const onDiskHeadRef = await readContractSpaceHeadRef(inputs.migrationsDir, space.spaceId);
    const priorHash = onDiskHeadRef?.hash ?? null;

    const artifacts = await emitContractSpaceArtifacts(inputs.migrationsDir, space.spaceId, {
      contract: descriptor.contractJson,
      contractDts: buildPlaceholderContractDts(space.spaceId),
      headRef: { hash: descriptor.headRef.hash, invariants: descriptor.headRef.invariants },
    });

    const spaceDir = spaceMigrationDirectory(inputs.migrationsDir, space.spaceId);
    const newMigrationDirs: string[] = [];
    for (const pkg of space.migrationPackages) {
      inputs.signal?.throwIfAborted();
      const { written } = await materialiseExtensionMigrationPackageIfMissing(spaceDir, pkg);
      if (written) newMigrationDirs.push(pkg.dirName);
    }

    const action: ContractSpaceSeedPhaseRecord['action'] =
      priorHash !== descriptor.headRef.hash || newMigrationDirs.length > 0
        ? 'updated'
        : 'unchanged';

    seeded.push({
      spaceId: space.spaceId,
      action,
      priorHash,
      newHash: descriptor.headRef.hash,
      newMigrationDirs,
      writtenPaths: [
        ...artifacts.writtenPaths,
        ...newMigrationDirs.map((dirName) => join(spaceDir, dirName)),
      ],
    });
  }

  return { seeded };
}

/**
 * Placeholder `.d.ts` content for an extension space's on-disk mirror.
 *
 * Rendering a fully-typed `.d.ts` for an extension contract requires
 * the SQL-family renderer with the codec / typemap registry threaded
 * through; until that integration ships, the on-disk `.d.ts` is a
 * stub `export {};` module that documents how consumers should
 * validate the sibling `contract.json`. The stub typechecks on its
 * own and does not need any TypeScript suppressions.
 */
function buildPlaceholderContractDts(spaceId: string): string {
  return [
    '/**',
    ` * Placeholder \`.d.ts\` for extension space "${spaceId}".`,
    ' *',
    ' * The framework re-emits this file on every `migration plan` run',
    ' * alongside `contract.json` and `refs/head.json`. A typed `.d.ts`',
    ' * rendering pass for extension contracts is tracked separately;',
    ' * until that ships, consumers should import `contract.json`',
    ' * and pass it through the target descriptor’s `contractSerializer`.',
    ' */',
    'export {};',
    '',
  ].join('\n');
}
