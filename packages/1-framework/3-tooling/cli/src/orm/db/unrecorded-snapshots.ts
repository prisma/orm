import type { SnapshotContentVerifier } from '@internal/migration-tools/contract-snapshot-store';
import type { EngineEvent } from '@prisma/cli-engine';
import { unrecordedSnapshots } from '../../control-api/operations/unrecorded-snapshots';
import { displayPath } from '../migration/paths';

/** Warns about each migration whose contract snapshot is present but cannot be read, before a database command that applies migrations runs. */
export async function warnUnrecordedSnapshots(args: {
  readonly report: (event: EngineEvent) => void;
  readonly migrationsDir: string;
  readonly verifySnapshotContent: SnapshotContentVerifier | undefined;
  readonly command: string;
  readonly cwd: string;
}): Promise<void> {
  for (const unrecorded of await unrecordedSnapshots(
    args.migrationsDir,
    args.verifySnapshotContent,
  )) {
    args.report({
      kind: 'message',
      severity: 'warn',
      text: `Could not read the contract snapshot ${displayPath(unrecorded.path, args.cwd)}, where the migration ${unrecorded.spaceId}/${unrecorded.dirName} ends: ${unrecorded.reason}. When ${args.command} applies that migration, the database records no contract for it. Restore the file from version control.`,
    });
  }
}
