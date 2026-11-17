import { readFileSync, realpathSync } from 'node:fs';
import { ifDefined } from '@internal/utils/defined';
import type { PackageManagerId, PackageOperations } from '@prisma/cli-engine';
import type { CliStructuredError } from '@prisma/cli-engine/protocol';
import { dirname, join } from 'pathe';
import {
  isPnpmIgnoredBuildsError,
  isRecognisedPnpmResolutionError,
} from '../commands/init/pnpm-fallback';
import { redactSecrets } from '../commands/init/redact-secrets';

const ENGINE_PACKAGE = '@prisma/cli-engine';
const TOOLCHAIN_PACKAGE = '@prisma/orm-toolchain';

/** What one install pair produced. */
export interface InstallOutcome {
  /** Absent on success; the capability's own failure otherwise. */
  readonly failure: CliStructuredError | undefined;
  /** The development dependencies the pair installed, the engine spec included. */
  readonly devDeps: readonly string[];
  /**
   * The manager override that succeeded, when the pnpm fallback fired. A caller
   * that offers to undo the install spells its command with this one: naming
   * pnpm after the fallback did the work would undo nothing.
   */
  readonly manager: PackageManagerId | undefined;
  readonly warnings: readonly string[];
}

type InstallRequest = Parameters<PackageOperations['install']>[0];

interface StepResult {
  readonly failure: CliStructuredError | undefined;
  readonly skippedBuilds: boolean;
}

interface PairResult extends StepResult {
  readonly devDeps: readonly string[];
}

function metaString(failure: CliStructuredError, key: string): string {
  const value = failure.meta?.[key];
  return typeof value === 'string' ? value : '';
}

/**
 * pnpm installed the packages and then failed only because it skipped build scripts nobody
 * approved. Only pnpm 12 is recognised: pnpm 11 prints the code on stdout, and the capability
 * returns stderr alone.
 */
function pnpmOnlySkippedBuilds(failure: CliStructuredError): boolean {
  return (
    metaString(failure, 'manager') === 'pnpm' &&
    isPnpmIgnoredBuildsError(metaString(failure, 'stderrTail'))
  );
}

const SKIPPED_BUILDS_WARNING = [
  'pnpm did not run the build scripts of some dependencies, because they are not approved (ERR_PNPM_IGNORED_BUILDS).',
  'pnpm reports that as a failure, but it had already installed the packages, so init continued.',
  'Run `pnpm approve-builds` to choose which dependencies may run their build scripts.',
].join('\n');

/**
 * pnpm reported a specifier the published artifact leaked, which npm installs
 * happily. The engine redacts credentials out of the stderr it returns but
 * leaves error codes alone, which is what this reads. pnpm 10 prints its
 * `ERR_PNPM_*` codes on stdout, though, and the engine returns only stderr, so
 * this does not fire until the engine returns stdout as well.
 */
function pnpmLeakedASpecifier(failure: CliStructuredError): boolean {
  return (
    metaString(failure, 'manager') === 'pnpm' &&
    isRecognisedPnpmResolutionError(metaString(failure, 'stderrTail'))
  );
}

/**
 * The engine redacts the stderr it hands back, and this redacts it again
 * before quoting it: what the engine strips is its own business, and registry
 * auth material is not all URL-shaped.
 */
function fallbackWarning(failure: CliStructuredError): string {
  const firstLine = redactSecrets(metaString(failure, 'stderrTail')).trim().split('\n')[0] ?? '';
  return [
    'pnpm could not install: a published Prisma ORM dependency leaked a `workspace:*` or `catalog:` specifier.',
    'Falling back to npm so init can complete.',
    firstLine === '' ? '' : `  pnpm error: ${firstLine}`,
    'Both installs ran under npm, which writes a package-lock.json beside the pnpm lockfile — delete whichever of the two you do not want to keep.',
    'Once the offending package republishes a clean version, re-run `pnpm install` to switch back.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** The pnpm failure the npm retry was meant to recover from, kept alongside the npm one. */
function retriedWarning(failure: CliStructuredError): string {
  const firstLine = redactSecrets(metaString(failure, 'stderrTail')).trim().split('\n')[0] ?? '';
  return [
    'pnpm failed first with a leaked `workspace:*` or `catalog:` specifier, so init retried with npm.',
    firstLine === '' ? '' : `  pnpm error: ${firstLine}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function enginePeerOf(manifestPath: string): string | undefined {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return undefined;
  }
  const peers =
    typeof manifest === 'object' && manifest !== null
      ? Reflect.get(manifest, 'peerDependencies')
      : undefined;
  const engine =
    typeof peers === 'object' && peers !== null ? Reflect.get(peers, ENGINE_PACKAGE) : undefined;
  return typeof engine === 'string' && engine.length > 0 ? engine : undefined;
}

/**
 * The engine dependency spec a fresh scaffold installs. The scaffolded
 * `prisma.config.ts` imports `definePrismaConfig` from `@prisma/cli-engine`,
 * and the runtime's `@prisma/orm-toolchain` peer-depends on the exact engine
 * version it runs against — so the spec is read from the manifest the runtime
 * install just placed, never guessed from a dist-tag (whose `latest` has
 * lagged that version before and broken the very next command). It has to be
 * known before `prisma` installs, because the engine goes into the same `add`
 * as `prisma`: pnpm 12 links an engine added on its own to a store entry it
 * never materializes. The toolchain sits either under the runtime or beside
 * it — in pnpm's virtual store, beside the link's target. A runtime without a
 * readable toolchain manifest falls back to the `latest` tag.
 */
function engineDevDependencySpec(cwd: string, runtimePackage: string): string {
  let runtimeDir: string;
  try {
    runtimeDir = realpathSync(join(cwd, 'node_modules', runtimePackage));
  } catch {
    return `${ENGINE_PACKAGE}@latest`;
  }
  const modulesDir = runtimePackage.split('/').reduce((dir) => dirname(dir), runtimeDir);
  const engine =
    enginePeerOf(join(runtimeDir, 'node_modules', TOOLCHAIN_PACKAGE, 'package.json')) ??
    enginePeerOf(join(modulesDir, TOOLCHAIN_PACKAGE, 'package.json'));
  return `${ENGINE_PACKAGE}@${engine ?? 'latest'}`;
}

/**
 * Adds the runtime and development dependencies through the engine's package
 * manager. The retry is `init`'s alone: the engine spells and runs the
 * command, and this decides — from the stderr it returned — that another
 * manager is worth a try, or that a pnpm add which skipped only unapproved
 * build scripts did install.
 */
export async function installProjectDependencies(ctx: {
  readonly packages: PackageOperations;
  readonly cwd: string;
  readonly deps: readonly string[];
  /**
   * The installed runtime whose toolchain names the engine pin — `undefined`
   * for an install that declares no development dependencies, and so carries
   * no engine.
   */
  readonly runtimePackage: string | undefined;
  readonly devDeps: readonly string[];
  readonly catalogWarnings: readonly string[];
}): Promise<InstallOutcome> {
  const install = async (request: InstallRequest): Promise<StepResult> => {
    if (request.packages.length === 0) {
      return { failure: undefined, skippedBuilds: false };
    }
    const result = await ctx.packages.install(request);
    if (result.ok) {
      return { failure: undefined, skippedBuilds: false };
    }
    return pnpmOnlySkippedBuilds(result.failure)
      ? { failure: undefined, skippedBuilds: true }
      : { failure: result.failure, skippedBuilds: false };
  };

  const pair = async (manager?: PackageManagerId): Promise<PairResult> => {
    const runtimeDeps = await install({
      packages: ctx.deps,
      cwd: ctx.cwd,
      ...ifDefined('manager', manager),
    });
    if (runtimeDeps.failure !== undefined) {
      return { ...runtimeDeps, devDeps: [] };
    }
    const runtime = ctx.runtimePackage;
    const devDeps =
      runtime === undefined
        ? [...ctx.devDeps]
        : [...ctx.devDeps, engineDevDependencySpec(ctx.cwd, runtime)];
    const developmentDeps = await install({
      packages: devDeps,
      dev: true,
      cwd: ctx.cwd,
      ...ifDefined('manager', manager),
    });
    return {
      failure: developmentDeps.failure,
      skippedBuilds: developmentDeps.skippedBuilds || runtimeDeps.skippedBuilds,
      devDeps,
    };
  };

  const first = await pair();
  if (first.failure === undefined) {
    return {
      failure: undefined,
      devDeps: first.devDeps,
      manager: undefined,
      warnings: first.skippedBuilds
        ? [...ctx.catalogWarnings, SKIPPED_BUILDS_WARNING]
        : ctx.catalogWarnings,
    };
  }
  if (!pnpmLeakedASpecifier(first.failure)) {
    return { failure: first.failure, devDeps: [], manager: undefined, warnings: [] };
  }

  const retry = await pair('npm');
  if (retry.failure !== undefined) {
    // The npm failure is the one raised, but the pnpm failure that triggered
    // the retry is why npm ran at all — without it the user sees an npm error
    // with no trace of the first attempt.
    return {
      failure: retry.failure,
      devDeps: [],
      manager: undefined,
      warnings: [retriedWarning(first.failure)],
    };
  }
  // npm bypassed pnpm's resolver, so the workspace catalog is not what ended
  // up installed — saying otherwise alongside the fallback would contradict it.
  return {
    failure: undefined,
    devDeps: retry.devDeps,
    manager: 'npm',
    warnings: [fallbackWarning(first.failure)],
  };
}
