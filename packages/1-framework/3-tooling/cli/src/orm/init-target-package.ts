import { existsSync, readFileSync } from 'node:fs';
import { ifDefined } from '@internal/utils/defined';
import type { PackageOperations } from '@prisma/cli-engine';
import { CliStructuredError } from '@prisma/cli-engine/protocol';
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
  type InstallReason,
  type PackagesAdded,
  packagesAddedAction,
} from '../commands/init/errors';
import type { InitContribution } from '../commands/init/init-contribution';
import { chooseAction } from '../utils/next-actions';
import { installProjectDependencies } from './init-packages';
import { normalizeError } from './normalize-error';
import { type ImportFromProject, isInstalledInProject } from './project-modules';

const InitContributionSchema = type({
  label: 'string',
  configModule: /\S/,
  peerPackages: 'string[]',
  authoringModes: type("'psl'|'typescript'").array().atLeastLength(1),
  starterContract: 'Function',
  contractSample: 'Function',
  databaseFile: 'Function',
  envExample: 'Function',
  quickReference: 'Function',
  'readme?': 'Function',
  'serverRequirement?': { minVersion: 'string', checkCommand: 'string' },
  'probe?': 'Function',
  'prisma7QuickReference?': 'Function',
});

/**
 * Checks the members' presence and the data members' shapes. The functions' signatures cannot be
 * checked at run time; the package's own `satisfies InitContribution` checks them when it builds.
 */
function isInitContribution(value: unknown): value is InitContribution {
  return !(InitContributionSchema(value) instanceof type.errors);
}

function contributionProblems(value: unknown): string {
  const checked = InitContributionSchema(value);
  return checked instanceof type.errors ? checked.summary : 'its shape is wrong';
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Adds the instruction to undo what init installed to an error raised after the install, such as
 * the engine's own consent or cancellation errors, which init cannot word itself. An error with
 * no structured code becomes `CLI.UNEXPECTED`, as it would at the handler boundary.
 */
export function withPackagesAddedAction(
  error: unknown,
  added: PackagesAdded,
  reason: InstallReason,
): CliStructuredError {
  const engineError = normalizeError(error);
  return new CliStructuredError(engineError.code, engineError.message, {
    severity: engineError.severity,
    nextActions: [...engineError.nextActions, chooseAction(packagesAddedAction(added, reason))],
    diagnostics: engineError.diagnostics,
    meta: { ...engineError.meta, packagesAdded: added.packages },
    ...ifDefined('why', engineError.why),
    ...ifDefined('where', engineError.where),
    ...ifDefined('docsUrl', engineError.docsUrl),
    cause: error,
  });
}

export function installCommand(
  packageManager: PackageManager,
  packages: readonly string[],
): string {
  return [packageManager, ...formatAddArgs(packageManager, [...packages])].join(' ');
}

/** The target package and the contribution it exports, with what installing it changed. */
export interface PreparedTargetPackage {
  readonly contribution: InitContribution;
  /** Every package the step installed or found in place, so the install phase skips them. */
  readonly installed: readonly string[];
  /** The installed packages the project did not declare before; `undefined` when there are none. */
  readonly added: PackagesAdded | undefined;
  readonly warnings: readonly string[];
}

/** Installs `packageName` with `dotenv` and `peerPackages`, then loads its init contribution. */
export type PrepareTargetPackage = (
  packageName: string,
  peerPackages: readonly string[],
) => Promise<PreparedTargetPackage>;

/**
 * The target package was installed, then could not be used. The caller adds the instruction to
 * undo the install, because only it knows why it installed the package.
 */
export class TargetPackageRefusedAfterInstall extends Error {
  constructor(
    override readonly cause: unknown,
    readonly added: PackagesAdded,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'TargetPackageRefusedAfterInstall';
  }
}

/** The install of the target package failed; nothing else has happened yet. */
export class TargetPackageInstallFailed extends Error {
  constructor(readonly failure: CliStructuredError) {
    super(failure.message);
    this.name = 'TargetPackageInstallFailed';
  }
}

/**
 * Installs the target package with `dotenv`, the package every init installs, and the driver
 * packages the caller names, leaving out those the project already declares, then loads the
 * package's init contribution from the project. Under `--skip-install` the package must already be
 * installed. Each refusal happens before any file is written.
 */
export function createTargetPackagePreparation(ctx: {
  readonly cwd: string;
  readonly packages: PackageOperations;
  readonly packageManager: PackageManager;
  readonly install: boolean;
  readonly importFromProject: ImportFromProject;
}): PrepareTargetPackage {
  return async (packageName, peerPackages) => {
    rejectUnparseableManifest(ctx.cwd);
    const warnings: string[] = [];
    let installed: readonly string[] = [];
    let added: PackagesAdded | undefined;
    let ranCommand: string | undefined;

    if (ctx.install) {
      const declaredBefore = declaredPackages(ctx.cwd);
      // Asking again for a package the project declares rewrites its declared range, which a
      // refusal later would leave behind; the later install puts those in place instead. The
      // target package is left out only when it is also on disk, since init loads it now.
      const targetInPlace =
        declaredBefore.has(packageName) && isInstalledInProject(ctx.cwd, packageName);
      const deps = [
        ...(targetInPlace ? [] : [packageName]),
        ...['dotenv', ...peerPackages].filter((dep) => !declaredBefore.has(dep)),
      ];
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
      // A target package already in place counts as installed, so the later install leaves it
      // alone too and the project keeps the version it has.
      installed = targetInPlace ? [packageName, ...deps] : deps;
      ranCommand = deps.length === 0 ? undefined : installCommand(ctx.packageManager, deps);
      added = manifestChanges(ctx.packageManager, declaredBefore, declaredPackages(ctx.cwd));
    }

    try {
      const contribution = await loadContribution(ctx, packageName, peerPackages, ranCommand);
      return { contribution, installed, added, warnings };
    } catch (error) {
      throw added === undefined ? error : new TargetPackageRefusedAfterInstall(error, added);
    }
  };
}

async function loadContribution(
  ctx: {
    readonly cwd: string;
    readonly packageManager: PackageManager;
    readonly install: boolean;
    readonly importFromProject: ImportFromProject;
  },
  packageName: string,
  peerPackages: readonly string[],
  /** The install command init ran and that exited successfully; `undefined` under `--skip-install`. */
  ranCommand: string | undefined,
): Promise<InitContribution> {
  const entrypoint = await ctx.importFromProject(ctx.cwd, `${packageName}/init`);
  switch (entrypoint.kind) {
    case 'not-installed':
      throw errorInitTargetPackageNotInstalled({
        packageName,
        installCommand: installCommand(ctx.packageManager, [packageName, ...peerPackages]),
        ranCommand,
      });
    case 'not-exported':
      throw errorInitContributionUnavailable({
        packageName,
        reason: 'no-entrypoint',
        detail: undefined,
      });
    case 'unloadable':
      throw errorInitContributionUnavailable({
        packageName,
        reason: 'unloadable',
        detail: causeMessage(entrypoint.cause),
      });
    case 'loaded':
      break;
  }
  const contribution = entrypoint.module['default'];
  if (!isInitContribution(contribution)) {
    throw errorInitContributionUnavailable({
      packageName,
      reason: 'invalid-shape',
      detail: contributionProblems(contribution),
    });
  }
  return contribution;
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

/**
 * What the install changed in `package.json`, read from the file, since a package manager can
 * exit successfully and declare nothing; `undefined` when it changed nothing.
 */
function manifestChanges(
  packageManager: PackageManager,
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): PackagesAdded | undefined {
  const packages = [...after.keys()].filter((name) => !before.has(name));
  const rewritten = [...before].flatMap(([name, range]) => {
    const now = after.get(name);
    return now !== undefined && now !== range ? [{ name, before: range }] : [];
  });
  if (packages.length === 0 && rewritten.length === 0) {
    return undefined;
  }
  return {
    packages,
    removeCommand: formatRemoveCommand(packageManager, packages),
    rewritten,
  };
}

/** Every package the project's `package.json` declares, in any dependency field, with its range. */
function declaredPackages(cwd: string): ReadonlyMap<string, string> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
  } catch {
    return new Map();
  }
  if (!isRecord(manifest)) {
    return new Map();
  }
  const entries = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ].flatMap((field) => {
    const section = manifest[field];
    return isRecord(section)
      ? Object.entries(section).map(([name, range]) => [name, String(range)] as const)
      : [];
  });
  return new Map(entries);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
