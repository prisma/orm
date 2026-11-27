import type { ContractSpaceAggregate } from '@internal/migration-tools/aggregate';
import type { Diagnostic } from '@prisma/cli-engine/protocol';
import { unreadableFiles } from '../../control-api/operations/contract-space-aggregate-loader';
import { integrityViolationToCheckFailure } from '../../utils/integrity-violation-to-check-failure';
import { runCommandAction } from '../../utils/next-actions';

function leftOutText(file: ReturnType<typeof unreadableFiles>[number]): string {
  return file.kind === 'packageUnloadable'
    ? `Migration "${file.dirName}" is left out, because it could not be read: ${file.detail}`
    : `Ref "${file.refName}" is left out, because it could not be read: ${file.detail}`;
}

/**
 * A warning for each ref and migration a listing leaves out because its file cannot be read, so the listing never hides it. It is a warning: the command still lists everything it could read. Load the aggregate with `onUnreadableFile: 'report'` to list past such a file.
 */
export function unreadableFileDiagnostics(
  aggregate: ContractSpaceAggregate,
  migrationsDir: string,
  cwd: string,
): readonly Diagnostic[] {
  return unreadableFiles(aggregate).map((file) => {
    const failure = integrityViolationToCheckFailure(file, migrationsDir, cwd);
    return {
      code:
        file.kind === 'packageUnloadable'
          ? 'MIGRATION.CHECK_PACKAGE_UNLOADABLE'
          : 'MIGRATION.CHECK_REF_UNREADABLE',
      severity: 'warn',
      summary: `${failure.where}: ${leftOutText(file)}`,
      nextActions: failure.nextActions,
      where: { path: failure.where },
      meta: { space: file.spaceId },
    };
  });
}

/** A warning when the family refused `contract.json`: a listing then marks the contract by its hash alone. */
export function contractRefusalDiagnostics(
  contractRefusal: string | undefined,
): readonly Diagnostic[] {
  if (contractRefusal === undefined) return [];
  return [
    {
      code: 'CONTRACT.UNREADABLE',
      severity: 'warn',
      summary: `Could not read contract: ${contractRefusal}`,
      why: 'The listing shows the migrations on disk and marks the contract by its hash alone.',
      nextActions: [runCommandAction('Regenerate the contract', '{bin} contract emit')],
    },
  ];
}
