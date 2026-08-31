import type { PrismaNextConfig } from '@internal/config/config-types';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { spaceMigrationDirectory } from '@internal/migration-tools/spaces';
import { relative, resolve } from 'pathe';

/**
 * Where migrations live for this project. The config section validator and
 * loader hand `migrations.dir` through as an absolute path resolved against
 * its declaring config file, so `cwd` only anchors a config handed in raw, as
 * tests do.
 */
export function migrationsDirFor(config: PrismaNextConfig, cwd: string): string {
  return resolve(cwd, config.migrations?.dir ?? 'migrations');
}

/** The app subspace under {@link migrationsDirFor}. */
export function appMigrationsDirFor(config: PrismaNextConfig, cwd: string): string {
  return spaceMigrationDirectory(migrationsDirFor(config, cwd), APP_SPACE_ID);
}

/**
 * The config file an operation should anchor its project paths on. The engine
 * loads the config and hands a handler the value but not the path, and
 * `--config` is an engine flag the handler never sees, so a handler names the
 * invocation directory's file. That equals the loaded file for every
 * invocation whose config sits in the invocation directory.
 */
export function projectConfigPathFor(cwd: string): string {
  return resolve(cwd, 'prisma.config.ts');
}

/**
 * Where refs live. The framework keeps them under the app subspace rather than
 * at the migrations root.
 */
export function appRefsDirFor(config: PrismaNextConfig, cwd: string): string {
  return resolve(appMigrationsDirFor(config, cwd), 'refs');
}

/**
 * The emitted contract. The config loader and the section validator have
 * already resolved `contract.output` against the config file's directory, so
 * this only has an effect for a config handed in raw, as tests do.
 */
export function contractPathFor(config: PrismaNextConfig, cwd: string): string | undefined {
  const output = config.contract?.output;
  return output === undefined ? undefined : resolve(cwd, output);
}

/**
 * The header's rendering of a path: relative to where the user invoked the
 * CLI, as the commander shell rendered it against the config file.
 */
export function displayPath(path: string, cwd: string): string {
  return relative(cwd, path);
}
