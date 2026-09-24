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
export function baseDirFor(config: PrismaNextConfig): string {
  if (config.baseDir === undefined) {
    throw new InternalError('the orm config section reached a command without baseDir');
  }
  return config.baseDir;
}

/** Where migrations live; the validated config carries it absolute and defaulted. */
export function migrationsDirFor(config: PrismaNextConfig): string {
  return config.migrations?.dir ?? resolve(baseDirFor(config), 'migrations');
}

/** The app subspace under {@link migrationsDirFor}. */
export function appMigrationsDirFor(config: PrismaNextConfig): string {
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
