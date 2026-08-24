/**
 * Policy core of `migration new`: scaffolds a migration package with a `migration.ts` stub for manual authoring.
 */

import { readFile } from 'node:fs/promises';
import type { PrismaNextConfig } from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import { getEmittedArtifactPaths } from '@internal/emitter';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { loadContractSpaceAggregate } from '@internal/migration-tools/aggregate';
import {
  contractSnapshotDir,
  snapshotsImportPathFrom,
  writeContractSnapshot,
} from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { formatMigrationDirName, writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { findLatestMigration } from '@internal/migration-tools/migration-graph';
import { writeMigrationTs } from '@internal/migration-tools/migration-ts';
import { notOk, ok, type Result } from '@internal/utils/result';
import { join, relative } from 'pathe';
import {
  CliStructuredError,
  errorRuntime,
  errorTargetMigrationNotSupported,
  errorUnexpected,
} from '../../utils/cli-errors';
import {
  getTargetMigrations,
  resolveContractPath,
  resolveMigrationPaths,
} from '../../utils/command-helpers';
import { assertFrameworkComponentsCompatible } from '../../utils/framework-components';
import { createProjectSpecifierResolver } from '../../utils/project-import-root';
import { refusePackageCorruptionOnAggregate } from './contract-space-aggregate-loader';

export interface MigrationNewOptions {
  readonly config: PrismaNextConfig;
  /** Directory the command was invoked from. */
  readonly cwd: string;
  /** `--config` as the user wrote it, used only to locate project paths and for display. */
  readonly configPath?: string;
  readonly name?: string;
  readonly from?: string;
}

export interface MigrationNewResult {
  readonly ok: true;
  readonly dir: string;
  readonly from: string | null;
  readonly to: string;
  readonly summary: string;
}

export async function executeMigrationNewCommand(
  options: MigrationNewOptions,
): Promise<Result<MigrationNewResult, CliStructuredError>> {
  const config = options.config;
  const cwd = options.cwd;
  const { migrationsDir, appMigrationsDir, appMigrationsRelative } = resolveMigrationPaths(
    options.configPath,
    config,
    cwd,
  );

  // Construct the family instance up-front so the on-disk contract read
  // below crosses the serializer seam (`familyInstance.deserializeContract`)
  // at the read site, not somewhere downstream. See TML-2536.
  const stack = createControlStack(config);
  const familyInstance = config.family.create(stack);
  const controlAdapter = config.adapter.create(stack);

  const contractPathAbsolute = resolveContractPath(config);

  let contractJsonContent: string;
  try {
    contractJsonContent = await readFile(contractPathAbsolute, 'utf-8');
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
      return notOk(
        errorRuntime('CLI.FILE_NOT_FOUND', `Contract file not found at ${contractPathAbsolute}`, {
          why: `Contract file not found at ${contractPathAbsolute}`,
          fix: 'Run `{bin} contract emit` first to generate the contract',
        }),
      );
    }
    throw error;
  }

  let toContract: Contract;
  try {
    const parsedContract: unknown = JSON.parse(contractJsonContent);
    toContract = familyInstance.deserializeContract(parsedContract);
  } catch (error) {
    return notOk(
      errorRuntime('MIGRATION.CONTRACT_DESERIALIZATION_FAILED', 'Contract JSON is invalid', {
        why: `Failed to deserialize ${contractPathAbsolute}: ${error instanceof Error ? error.message : String(error)}`,
        fix: 'Run `{bin} contract emit` to regenerate the contract',
        cause: error,
      }),
    );
  }

  const toStorageHash = toContract.storage?.storageHash;
  if (typeof toStorageHash !== 'string') {
    return notOk(
      errorRuntime('CONTRACT.VALIDATION_FAILED', 'Contract is missing storageHash', {
        why: `Contract at ${contractPathAbsolute} has no storageHash`,
        fix: 'Run `{bin} contract emit` to regenerate the contract',
      }),
    );
  }

  const aggregate = await loadContractSpaceAggregate({
    migrationsDir,
    deserializeContract: (json) => familyInstance.deserializeContract(json),
    appContract: toContract,
  });
  const packageCorruptionFailure = refusePackageCorruptionOnAggregate(aggregate, migrationsDir);
  if (packageCorruptionFailure) {
    return notOk(packageCorruptionFailure);
  }

  const packages = aggregate.app.packages;
  const graph = aggregate.app.graph();

  let fromHash: string | null = null;

  if (packages.length > 0) {
    if (options.from) {
      const match = packages.find((p) => p.metadata.to.startsWith(options.from!));
      if (!match) {
        return notOk(
          errorRuntime('MIGRATION.HASH_NOT_IN_GRAPH', 'Starting contract not found', {
            why: `No migration with to hash matching "${options.from}" exists in ${appMigrationsRelative}`,
            fix: 'Check that the --from hash matches a known migration target hash.',
          }),
        );
      }
      fromHash = match.metadata.to;
    } else {
      const latestMigration = findLatestMigration(graph);
      if (latestMigration) {
        fromHash = latestMigration.to;
      }
    }
  }

  if (fromHash === toStorageHash && !options.from) {
    return notOk(
      errorRuntime('MIGRATION.NO_CHANGES', 'No changes detected', {
        why: 'The from and to contract hashes are identical — there is nothing to migrate.',
        fix: 'Change the contract and run `{bin} contract emit` before creating a new migration. To author a data-only migration on the current contract hash, pass `--from <hash>` explicitly.',
      }),
    );
  }

  const timestamp = new Date();
  const slug = options.name ?? 'migration';
  const dirName = formatMigrationDirName(timestamp, slug);
  const packageDir = join(appMigrationsDir, dirName);

  // `migration new` scaffolds an empty `migration.ts` for the user to
  // fill, so we attest over `ops: []`. Re-running self-emit after the
  // user adds operations will produce a different `migrationHash` (over
  // the real ops). This is intentional — there is no on-disk draft.
  const baseMetadata: Omit<MigrationMetadata, 'migrationHash'> = {
    from: fromHash,
    to: toStorageHash,
    providedInvariants: [],
    createdAt: timestamp.toISOString(),
  };
  const metadata: MigrationMetadata = {
    ...baseMetadata,
    migrationHash: computeMigrationHash(baseMetadata, []),
  };

  const migrations = getTargetMigrations(config.target);
  if (!migrations) {
    return notOk(
      errorTargetMigrationNotSupported({
        why: `Target "${config.target.targetId}" does not support migrations`,
      }),
    );
  }

  try {
    assertFrameworkComponentsCompatible(config.family.familyId, config.target.targetId, [
      config.target,
      config.adapter,
      ...(config.extensions ?? []),
    ]);

    // Before any write: an unreadable or contradictory project manifest fails
    // the command outright rather than after a half-scaffolded migration
    // directory is already on disk.
    const resolveSpecifier = createProjectSpecifierResolver(options.configPath);

    await writeMigrationPackage(packageDir, metadata, []);
    const destinationArtifacts = getEmittedArtifactPaths(contractPathAbsolute);
    const [contractJsonRaw, contractDts] = await Promise.all([
      readFile(destinationArtifacts.jsonPath, 'utf-8'),
      readFile(destinationArtifacts.dtsPath, 'utf-8'),
    ]);
    await writeContractSnapshot(migrationsDir, toStorageHash, {
      contractJson: JSON.parse(contractJsonRaw) as unknown,
      contractDts,
    });

    const planner = migrations.createPlanner(controlAdapter);
    const emptyPlan = planner.emptyMigration(
      {
        packageDir,
        contractJsonPath: join(contractSnapshotDir(migrationsDir, toStorageHash), 'contract.json'),
        fromHash,
        toHash: toStorageHash,
        snapshotsImportPath: snapshotsImportPathFrom(packageDir, migrationsDir),
      },
      APP_SPACE_ID,
    );
    await writeMigrationTs(packageDir, emptyPlan.renderTypeScript(resolveSpecifier));

    return ok({
      ok: true as const,
      dir: relative(cwd, packageDir),
      from: fromHash,
      to: toStorageHash,
      summary: `Scaffolded migration at ${relative(cwd, packageDir)}`,
    });
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to scaffold migration: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }
}
