import { readdir } from 'node:fs/promises';
import { CONTRACT_SNAPSHOTS_DIRNAME } from '@internal/framework-components/control';
import {
  contractSnapshotDir,
  readContractSnapshotJson,
  type SnapshotContentVerifier,
} from '@internal/migration-tools/contract-snapshot-store';
import { MigrationToolsError } from '@internal/migration-tools/errors';
import { readMigrationsDir } from '@internal/migration-tools/io';
import { isInternalError } from '@internal/utils/internal-error';
import { join } from 'pathe';
import { reasonOf } from './caught-errors';

/** A migration whose contract snapshot is present but cannot be read, so a database that applies the migration records no contract for it. */
export interface UnrecordedSnapshot {
  readonly spaceId: string;
  readonly dirName: string;
  readonly path: string;
  readonly reason: string;
}

/**
 * Every migration in `migrationsDir` whose contract snapshot is present but cannot be read: not JSON, the JSON `null`, or content that does not match its hash. Loading a migration treats such a snapshot as absent, so the database commands apply the migration without it. A migrations directory a command cannot load yields nothing here; that command refuses it itself.
 */
export async function unrecordedSnapshots(
  migrationsDir: string,
  verifySnapshotContent: SnapshotContentVerifier | undefined,
): Promise<readonly UnrecordedSnapshot[]> {
  try {
    const entries = await readdir(migrationsDir, { withFileTypes: true });
    const spaceIds = entries
      .filter((entry) => entry.isDirectory() && entry.name !== CONTRACT_SNAPSHOTS_DIRNAME)
      .map((entry) => entry.name)
      .sort();
    const found: UnrecordedSnapshot[] = [];
    for (const spaceId of spaceIds) {
      const { packages } = await readMigrationsDir(join(migrationsDir, spaceId), {
        migrationsDir,
        ...(verifySnapshotContent === undefined ? {} : { verifySnapshotContent }),
      });
      for (const pkg of packages) {
        if (pkg.endContractJson !== undefined) continue;
        const reason = await snapshotProblem(migrationsDir, pkg.metadata.to, verifySnapshotContent);
        if (reason !== undefined) found.push({ spaceId, dirName: pkg.dirName, ...reason });
      }
    }
    return found;
  } catch {
    return [];
  }
}

async function snapshotProblem(
  migrationsDir: string,
  hash: string,
  verifySnapshotContent: SnapshotContentVerifier | undefined,
): Promise<{ readonly path: string; readonly reason: string } | undefined> {
  try {
    await readContractSnapshotJson(migrationsDir, hash, verifySnapshotContent);
    return undefined;
  } catch (error) {
    if (isInternalError(error)) return undefined;
    if (MigrationToolsError.is(error) && error.code === 'MIGRATION.CONTRACT_SNAPSHOT_MISSING') {
      return undefined;
    }
    return {
      path: join(contractSnapshotDir(migrationsDir, hash), 'contract.json'),
      reason: reasonOf(error),
    };
  }
}
