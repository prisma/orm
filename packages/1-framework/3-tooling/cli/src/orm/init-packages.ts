import { readFileSync, realpathSync } from 'node:fs';
import { ifDefined } from '@internal/utils/defined';
import type { PackageManagerId, PackageOperations } from '@prisma/cli-engine';
import type { CliStructuredError } from '@prisma/cli-engine/protocol';
import { dirname, join } from 'pathe';
import { isRecognisedPnpmResolutionError } from '../commands/init/pnpm-fallback';
import { redactSecrets } from '../commands/init/redact-secrets';

const ENGINE_PACKAGE = '@prisma/cli-engine';
const TOOLCHAIN_PACKAGE = '@prisma/orm-toolchain';
const MODULES_MANIFEST = 'node_modules/.modules.yaml';

/** What one install pair produced. */
export interface InstallOutcome {
  /** Absent on success; the capability's own failure otherwise. */
  readonly failure: CliStructuredError | undefined;
  /** The development dependencies the pair installed, the engine spec included. */
  readonly devDeps: readonly string[];
  readonly warnings: readonly string[];
}

type InstallRequest = Parameters<PackageOperations['install']>[0];

interface StepResult {
  readonly failure: CliStructuredError | undefined;
  /** The pnpm failure let through because only unapproved build scripts were skipped. */
  readonly skippedBuilds: CliStructuredError | undefined;
}

interface PairResult extends StepResult {
  readonly devDeps: readonly string[];
}

function metaString(failure: CliStructuredError, key: string): string {
  const value = failure.meta?.[key];
  return typeof value === 'string' ? value : '';
}

function readManifest(cwd: string): string | undefined {
  try {
    return readFileSync(join(cwd, 'package.json'), 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Whether pnpm named packages whose scripts it skipped in the modules manifest
 * it writes beside the tree it linked — `undefined` when this directory holds
 * no manifest to read. pnpm 11 and 12 write it as JSON, which is the YAML its
 * name promises; pnpm 10, which has no such gate, wrote real YAML.
 */
function ignoredBuildsRecordedIn(dir: string): boolean | undefined {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(join(dir, MODULES_MANIFEST), 'utf-8'));
  } catch {
    return undefined;
  }
  const ignored =
    typeof manifest === 'object' && manifest !== null
      ? Reflect.get(manifest, 'ignoredBuilds')
      : undefined;
  return Array.isArray(ignored) && ignored.length > 0;
}

/** The modules manifest belongs to the tree pnpm linked, which in a workspace is the root's. */
function pnpmRecordedIgnoredBuilds(cwd: string): boolean {
  let dir = cwd;
  for (;;) {
    const recorded = ignoredBuildsRecordedIn(dir);
    if (recorded !== undefined) {
      return recorded;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return false;
    }
    dir = parent;
  }
}

/**
 * pnpm 11 and later fail an `add` whose dependencies carry build scripts
 * nobody approved (`ERR_PNPM_IGNORED_BUILDS`) — after the packages are added
 * and linked, so the scripts are all that did not run. pnpm 12 names the code
 * on stderr, which settles it.
 *
 * pnpm 11 prints it on stdout, which the capability does not hand back, so
 * that version is read from two records pnpm leaves on disk, and it takes both:
 *
 * - pnpm named packages it skipped in the modules manifest — its own statement
 *   that scripts went unrun, which an earlier install in the same tree can
 *   equally have left behind;
 * - `package.json` changed across the call — `pnpm add` writes it only once
 *   resolution, linking and every approved script have landed, and the
 *   ignored-builds gate is the one thing it raises afterwards.
 *
 * Either alone admits a real failure: a manifest rewrite names no gate, and a
 * failed approved script exits non-zero in a tree whose record already stands.
 */
function pnpmOnlySkippedBuilds(
  failure: CliStructuredError,
  manifestBefore: string | undefined,
  cwd: string,
): boolean {
  if (metaString(failure, 'manager') !== 'pnpm') {
    return false;
  }
  if (metaString(failure, 'stderrTail').includes('ERR_PNPM_IGNORED_BUILDS')) {
    return true;
  }
  return readManifest(cwd) !== manifestBefore && pnpmRecordedIgnoredBuilds(cwd);
}

function skippedBuildsWarning(failure: CliStructuredError): string {
  const exitCode = failure.meta?.['exitCode'];
  const exited = typeof exitCode === 'number' ? `exited with code ${exitCode}` : 'exited non-zero';
  return [
    `pnpm ${exited} after adding the packages, which is how pnpm 11 and later report dependency build scripts it has not been told to trust (ERR_PNPM_IGNORED_BUILDS).`,
    'The packages are installed but those scripts did not run; init continued without them.',
    'Run `pnpm approve-builds` to review which dependencies may run their scripts.',
  ].join('\n');
}

/**
 * pnpm reported a specifier the published artifact leaked, which npm installs
 * happily. The engine redacts credentials out of the stderr it returns but
 * leaves error codes alone, which is what this reads.
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
  readonly runtimePackage: string;
  readonly devDeps: readonly string[];
  readonly catalogWarnings: readonly string[];
}): Promise<InstallOutcome> {
  const install = async (request: InstallRequest): Promise<StepResult> => {
    const manifestBefore = readManifest(ctx.cwd);
    const result = await ctx.packages.install(request);
    if (result.ok) {
      return { failure: undefined, skippedBuilds: undefined };
    }
    return pnpmOnlySkippedBuilds(result.failure, manifestBefore, ctx.cwd)
      ? { failure: undefined, skippedBuilds: result.failure }
      : { failure: result.failure, skippedBuilds: undefined };
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
    const devDeps = [...ctx.devDeps, engineDevDependencySpec(ctx.cwd, ctx.runtimePackage)];
    const developmentDeps = await install({
      packages: devDeps,
      dev: true,
      cwd: ctx.cwd,
      ...ifDefined('manager', manager),
    });
    return {
      failure: developmentDeps.failure,
      skippedBuilds: developmentDeps.skippedBuilds ?? runtimeDeps.skippedBuilds,
      devDeps,
    };
  };

  const first = await pair();
  if (first.failure === undefined) {
    return {
      failure: undefined,
      devDeps: first.devDeps,
      warnings:
        first.skippedBuilds === undefined
          ? ctx.catalogWarnings
          : [...ctx.catalogWarnings, skippedBuildsWarning(first.skippedBuilds)],
    };
  }
  if (!pnpmLeakedASpecifier(first.failure)) {
    return { failure: first.failure, devDeps: [], warnings: [] };
  }

  const retry = await pair('npm');
  if (retry.failure !== undefined) {
    // The npm failure is the one raised, but the pnpm failure that triggered
    // the retry is why npm ran at all — without it the user sees an npm error
    // with no trace of the first attempt.
    return { failure: retry.failure, devDeps: [], warnings: [retriedWarning(first.failure)] };
  }
  // npm bypassed pnpm's resolver, so the workspace catalog is not what ended
  // up installed — saying otherwise alongside the fallback would contradict it.
  return { failure: undefined, devDeps: retry.devDeps, warnings: [fallbackWarning(first.failure)] };
}
