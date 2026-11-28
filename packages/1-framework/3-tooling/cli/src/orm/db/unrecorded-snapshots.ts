import type { EngineEvent } from '@prisma/cli-engine';
import type { UnrecordedSnapshot } from '../../control-api/types';
import { displayPath } from '../migration/paths';

/** Warns, before `command` applies anything, about a migration it applies whose contract snapshot is present but cannot be read. */
export function unrecordedSnapshotWarning(
  report: (event: EngineEvent) => void,
  command: string,
  cwd: string,
): (unrecorded: UnrecordedSnapshot) => void {
  return (unrecorded) =>
    report({
      kind: 'message',
      severity: 'warn',
      text: `Could not read the contract snapshot ${displayPath(unrecorded.path, cwd)}, where the migration ${unrecorded.spaceId}/${unrecorded.dirName} ends: ${unrecorded.reason}. ${command} applies that migration, but the database records no contract for it. Restore the file from version control.`,
    });
}
