import type { InitContribution } from '../../src/commands/init/init-contribution';
import { importInitEntrypoint } from '../../src/orm/init-target-package';
import { fixtureAppDir } from './test-project-dir';

/** The init contribution of a target package the fixture app installs, as `init` loads it. */
export async function fixtureContribution(packageName: string): Promise<InitContribution> {
  const entrypoint = await importInitEntrypoint(fixtureAppDir, packageName);
  if (entrypoint.kind !== 'loaded') {
    throw new Error(
      `${packageName}/init does not resolve from the fixture app: ${entrypoint.kind}`,
    );
  }
  return entrypoint.module['default'] as InitContribution;
}
