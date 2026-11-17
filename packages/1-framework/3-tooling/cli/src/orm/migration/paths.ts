import type { PrismaNextConfig } from '@internal/config/config-types';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { spaceMigrationDirectory } from '@internal/migration-tools/spaces';
import { InternalError } from '@internal/utils/internal-error';
import { relative, resolve } from 'pathe';

/**
 * The directory of the config file that wrote the section, recorded when the
 * engine validated it. Every command runs behind that validation, so its
 * absence here is a bug.
 */
export function baseDirFor(config: Pick<PrismaNextConfig, 'baseDir'>): string {
  if (config.baseDir === undefined) {
    throw new InternalError('the orm config section reached a command without baseDir');
  }
  return config.baseDir;
}

type MigrationsLocation = Pick<PrismaNextConfig, 'baseDir' | 'migrations'>;

/**
 * Where a config keeps its migrations: `migrations.dir`, default `migrations`, resolved against the config's `baseDir`. `base` stands in for `baseDir` when a config built in memory carries none.
 */
export function migrationsDirFor(config: MigrationsLocation, base?: string): string {
  return resolve(
    config.baseDir ?? base ?? baseDirFor(config),
    config.migrations?.dir ?? 'migrations',
  );
}

/** The app subspace under {@link migrationsDirFor}. */
export function appMigrationsDirFor(config: MigrationsLocation): string {
  return spaceMigrationDirectory(migrationsDirFor(config), APP_SPACE_ID);
}

/**
 * Where refs live. The framework keeps them under the app subspace rather than
 * at the migrations root.
 */
export function appRefsDirFor(config: PrismaNextConfig): string {
  return resolve(appMigrationsDirFor(config), 'refs');
}

/** The emitted contract; the validated config carries `contract.output` absolute. */
export function contractPathFor(config: PrismaNextConfig): string | undefined {
  return config.contract?.output;
}

/**
 * The header's rendering of a path: relative to where the user invoked the
 * CLI, as the commander shell rendered it against the config file.
 */
export function displayPath(path: string, cwd: string): string {
  return relative(cwd, path);
}
