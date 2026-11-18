import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { PackageOperations } from '@prisma/cli-engine';
import type { CliStructuredError } from '@prisma/cli-engine/protocol';
import { type } from 'arktype';
import { join } from 'pathe';
import { buildCatalogWarnings } from '../commands/init/catalog-warnings';
import {
  formatAddArgs,
  formatRemoveCommand,
  type PackageManager,
} from '../commands/init/detect-package-manager';
import {
  errorInitContributionUnavailable,
  errorInitInvalidManifest,
  errorInitTargetPackageNotInstalled,
  type PackagesAdded,
} from '../commands/init/errors';
import type { InitContribution } from '../commands/init/init-contribution';
import type { KnownTarget } from '../commands/init/target-packages';
import { installProjectDependencies } from './init-packages';

/** What the project resolves `<package>/init` to. */
export type InitEntrypointImport =
  | { readonly kind: 'not-installed' }
  | { readonly kind: 'no-entrypoint' }
  | { readonly kind: 'loaded'; readonly module: Record<string, unknown> };

export type ImportInitEntrypoint = (
  cwd: string,
  packageName: string,
) => Promise<InitEntrypointImport>;

function errorCode(error: unknown): unknown {
  return error instanceof Error ? Reflect.get(error, 'code') : undefined;
}

function isInstalled(requireFromProject: NodeJS.Require, packageName: string): boolean {
  try {
    requireFromProject.resolve(`${packageName}/package.json`);
    return true;
  } catch (error) {
    return errorCode(error) === 'ERR_PACKAGE_PATH_NOT_EXPORTED';
  }
}

/**
 * Resolves `<package>/init` from the project folder, not from the CLI's own location: the package
 * is the one the project installed, which the config loads a moment later.
 */
export const importInitEntrypoint: ImportInitEntrypoint = async (cwd, packageName) => {
  const requireFromProject = createRequire(join(cwd, 'package.json'));
  let resolved: string;
  try {
    resolved = requireFromProject.resolve(`${packageName}/init`);
  } catch {
    return {
      kind: isInstalled(requireFromProject, packageName) ? 'no-entrypoint' : 'not-installed',
    };
  }
  const module: Record<string, unknown> = await import(pathToFileURL(resolved).href);
  return { kind: 'loaded', module };
};

const AuthoringModeSchema = type("'psl'|'typescript'");

const InitContributionSchema = type({
  label: 'string',
  configModule: 'string',
  peerPackages: 'string[]',
  authoringModes: AuthoringModeSchema.array().atLeastLength(1),
  starterContract: 'Function',
  contractSample: 'Function',
  databaseFile: 'Function',
  envExample: 'Function',
  quickReference: 'Function',
  readme: 'Function',
  'serverRequirement?': { minVersion: 'string', checkCommand: 'string' },
  'probe?': 'Function',
  'prisma7ConfigFile?': 'Function',
  'prisma7QuickReference?': 'Function',
});

/** What is wrong with a default export that should be an init contribution; `undefined` when nothing is. */
function contributionProblems(value: unknown): string | undefined {
  const checked = InitContributionSchema(value);
  if (checked instanceof type.errors) {
    return checked.summary;
  }
  if ((checked.prisma7ConfigFile === undefined) !== (checked.prisma7QuickReference === undefined)) {
    return 'prisma7ConfigFile and prisma7QuickReference must be given together';
  }
  return undefined;
}

/**
 * Checks the members' presence and the data members' shapes. The functions' signatures cannot be
 * checked at run time; the package's own `satisfies InitContribution` checks them when it builds.
 */
function isInitContribution(value: unknown): value is InitContribution {
  return contributionProblems(value) === undefined;
}

export function installCommand(packageManager: PackageManager, packageName: string): string {
  return [packageManager, ...formatAddArgs(packageManager, [packageName])].join(' ');
}

/** The target package and the contribution it exports, with what installing it changed. */
export interface PreparedTargetPackage {
  readonly contribution: InitContribution;
  /** Every package the step installed, so the install phase skips them. */
  readonly installed: readonly string[];
  /** The installed packages the project did not declare before; `undefined` when there are none. */
  readonly added: PackagesAdded | undefined;
  readonly warnings: readonly string[];
}

export type PrepareTargetPackage = (target: KnownTarget) => Promise<PreparedTargetPackage>;

/** The install of the target package failed; nothing else has happened yet. */
export class TargetPackageInstallFailed extends Error {
  constructor(readonly failure: CliStructuredError) {
    super(failure.message);
    this.name = 'TargetPackageInstallFailed';
  }
}

/**
 * Installs the target package with `dotenv`, the packages every init installs, then loads the
 * package's init contribution from the project. Under `--skip-install` the package must already be
 * installed. Each refusal happens before any file is written.
 */
export function createTargetPackagePreparation(ctx: {
  readonly cwd: string;
  readonly packages: PackageOperations;
  readonly packageManager: PackageManager;
  readonly install: boolean;
  readonly importInitEntrypoint: ImportInitEntrypoint;
}): PrepareTargetPackage {
  return async (target) => {
    const { packageName } = target;
    rejectUnparseableManifest(ctx.cwd);
    const warnings: string[] = [];
    let installed: readonly string[] = [];
    let added: PackagesAdded | undefined;

    if (ctx.install) {
      const deps = [packageName, 'dotenv'];
      const declaredBefore = declaredPackages(ctx.cwd);
      const installFailure = await installProjectDependencies({
        packages: ctx.packages,
        cwd: ctx.cwd,
        deps,
        devDeps: [],
      });
      if (installFailure !== undefined) {
        throw new TargetPackageInstallFailed(installFailure);
      }
      if (ctx.packageManager === 'pnpm') {
        warnings.push(...buildCatalogWarnings(ctx.cwd, deps));
      }
      installed = deps;
      const newlyDeclared = deps.filter((dep) => !declaredBefore.has(dep));
      added =
        newlyDeclared.length === 0
          ? undefined
          : {
              packages: newlyDeclared,
              removeCommand: formatRemoveCommand(ctx.packageManager, newlyDeclared),
            };
    }

    const entrypoint = await ctx.importInitEntrypoint(ctx.cwd, packageName);
    if (entrypoint.kind === 'not-installed') {
      throw errorInitTargetPackageNotInstalled({
        packageName,
        installCommand: installCommand(ctx.packageManager, packageName),
      });
    }
    if (entrypoint.kind === 'no-entrypoint') {
      throw errorInitContributionUnavailable({
        packageName,
        reason: 'no-entrypoint',
        problems: undefined,
      });
    }
    const contribution = entrypoint.module['default'];
    if (!isInitContribution(contribution)) {
      throw errorInitContributionUnavailable({
        packageName,
        reason: 'invalid-shape',
        problems: contributionProblems(contribution),
      });
    }
    return { contribution, installed, added, warnings };
  };
}

/**
 * The package manager and the module resolver both read `package.json`, so a malformed one is
 * reported as what it is before either runs.
 */
function rejectUnparseableManifest(cwd: string): void {
  const manifestPath = join(cwd, 'package.json');
  if (!existsSync(manifestPath)) {
    return;
  }
  try {
    JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw errorInitInvalidManifest({ path: 'package.json', cause: error.message });
    }
    throw error;
  }
}

function declaredPackages(cwd: string): ReadonlySet<string> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
  } catch {
    return new Set();
  }
  if (!isRecord(manifest)) {
    return new Set();
  }
  const names = ['dependencies', 'devDependencies', 'optionalDependencies'].flatMap((field) => {
    const section = manifest[field];
    return isRecord(section) ? Object.keys(section) : [];
  });
  return new Set(names);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
