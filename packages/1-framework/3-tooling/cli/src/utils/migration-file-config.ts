import { existsSync, realpathSync } from 'node:fs';
import type { PrismaNextConfig } from '@internal/config/config-types';
import {
  CONFIG_FILENAME,
  type ConfigSection,
  findNearestConfigPathForFile,
  loadConfig,
  loadConfigForSections,
  requireConfigSections,
} from '@internal/config-loader';
import {
  type CheckedMigrationConfig,
  type CliStructuredError,
  errorMigrationCliConfigNotFound,
} from '@internal/errors/control';
import { notOk, ok, type Result } from '@internal/utils/result';
import { dirname, isAbsolute, join, relative } from 'pathe';
import { migrationsDirFor } from '../orm/migration/paths';

/**
 * The config a `migration.ts` runs with. `--config` names it outright. Without it, the config is the one that owns the migration, whose migrations directory holds the file: the nearest `prisma.config.ts` above the migration, else the one in the working directory.
 */
export async function loadMigrationFileConfig(options: {
  readonly configPath: string | undefined;
  readonly migrationFile: string;
  readonly cwd: string;
  readonly sections: readonly ConfigSection[];
}): Promise<Result<PrismaNextConfig, CliStructuredError>> {
  const { configPath, migrationFile, cwd, sections } = options;
  if (configPath !== undefined) {
    return loadConfigForSections(configPath, sections);
  }
  const workingDirectoryConfig = join(cwd, CONFIG_FILENAME);
  const candidates = [
    ...new Set([
      await findNearestConfigPathForFile(migrationFile),
      existsSync(workingDirectoryConfig) ? workingDirectoryConfig : undefined,
    ]),
  ].filter((candidate) => candidate !== undefined);
  const checked: CheckedMigrationConfig[] = [];
  for (const candidate of candidates) {
    const loaded = await loadConfig(candidate);
    const config = loaded.ok
      ? requireConfigSections(loaded.value, [...sections, 'migrations'])
      : loaded;
    if (!config.ok) {
      checked.push({ configPath: candidate, loadFailure: config.failure.message });
      continue;
    }
    if (ownsMigration(config.value, candidate, migrationFile)) {
      return ok(config.value);
    }
    checked.push({
      configPath: candidate,
      migrationsDir: migrationsDirFor(config.value, dirname(candidate)),
    });
  }
  return notOk(errorMigrationCliConfigNotFound({ migrationDir: dirname(migrationFile), checked }));
}

/** Whether `migrationFile` is inside the migrations directory of the config at `configPath`. */
export function ownsMigration(
  config: Pick<PrismaNextConfig, 'baseDir' | 'migrations'>,
  configPath: string,
  migrationFile: string,
): boolean {
  const migrationsDir = migrationsDirFor(config, dirname(configPath));
  const path = relative(realPath(migrationsDir), realPath(migrationFile));
  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
}

function realPath(path: string): string {
  return existsSync(path) ? realpathSync(path) : path;
}
