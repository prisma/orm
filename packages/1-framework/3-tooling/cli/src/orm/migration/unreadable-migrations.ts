import type { ContractSpaceAggregate } from '@internal/migration-tools/aggregate';
import type { Diagnostic } from '@prisma/cli-engine/protocol';
import { join, relative } from 'pathe';
import { migrationPackageRepairActions } from '../../utils/next-actions';

/** The migrations whose `migration.json` the aggregate could not read, each with its space and why. */
export function unreadableMigrations(
  aggregate: ContractSpaceAggregate,
): readonly { readonly spaceId: string; readonly dirName: string; readonly detail: string }[] {
  return aggregate
    .checkIntegrity()
    .flatMap((violation) =>
      violation.kind === 'packageUnloadable'
        ? [{ spaceId: violation.spaceId, dirName: violation.dirName, detail: violation.detail }]
        : [],
    );
}

/**
 * A warning for each migration a listing leaves out because its `migration.json` cannot be read, so the listing never hides it. It is a warning: the command still lists every migration it could read.
 */
export function unreadableMigrationDiagnostics(
  aggregate: ContractSpaceAggregate,
  migrationsDir: string,
  cwd: string,
): readonly Diagnostic[] {
  return unreadableMigrations(aggregate).map(({ spaceId, dirName, detail }) => {
    const packageDir = join(migrationsDir, spaceId, dirName);
    const where = relative(cwd, packageDir);
    return {
      code: 'MIGRATION.CHECK_PACKAGE_UNLOADABLE',
      severity: 'warn',
      summary: `${where}: Migration "${dirName}" is left out, because it could not be read: ${detail}`,
      nextActions: migrationPackageRepairActions(packageDir),
      where: { path: where },
      meta: { space: spaceId },
    };
  });
}
