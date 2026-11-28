import {
  contractSnapshotDir,
  readContractSnapshotJson,
  type SnapshotContentVerifier,
} from '@internal/migration-tools/contract-snapshot-store';
import { MigrationToolsError } from '@internal/migration-tools/errors';
import { isInternalError } from '@internal/utils/internal-error';
import { join } from 'pathe';
import type { UnrecordedSnapshot } from '../types';
import { reasonOf } from './caught-errors';
import type { OrderedResolution } from './run-migration';

/**
 * Each migration on the path a run applies whose contract snapshot is present but cannot be read: not JSON, the JSON `null`, or content that does not match its hash. Loading a migration treats such a snapshot as absent, so the run applies the migration and the database records no contract for it.
 */
export async function unrecordedSnapshotsOnPath(
  resolutions: readonly OrderedResolution[],
  migrationsDir: string,
  verifySnapshotContent: SnapshotContentVerifier | undefined,
): Promise<readonly UnrecordedSnapshot[]> {
  const found: UnrecordedSnapshot[] = [];
  for (const { spaceId, entry } of resolutions) {
    for (const edge of entry.migrationEdges) {
      if (edge.destinationContractJson !== undefined) continue;
      const problem = await snapshotProblem(migrationsDir, edge.to, verifySnapshotContent);
      if (problem !== undefined) found.push({ spaceId, dirName: edge.dirName, ...problem });
    }
  }
  return found;
}

/** Hands `listener` each migration on the path whose snapshot the run cannot record; nothing is read without a listener. */
export async function reportUnrecordedSnapshots(
  resolutions: readonly OrderedResolution[],
  migrationsDir: string,
  verifySnapshotContent: SnapshotContentVerifier | undefined,
  listener: ((unrecorded: UnrecordedSnapshot) => void) | undefined,
): Promise<void> {
  if (listener === undefined) return;
  for (const unrecorded of await unrecordedSnapshotsOnPath(
    resolutions,
    migrationsDir,
    verifySnapshotContent,
  )) {
    listener(unrecorded);
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
