import { readFileSync } from 'node:fs';
import { ifDefined } from '@internal/utils/defined';
import type { PackageManagerId, PackageOperations } from '@prisma/cli-engine';
import type { CliStructuredError } from '@prisma/cli-engine/protocol';
import { join } from 'pathe';
import { isRecognisedPnpmResolutionError } from '../commands/init/pnpm-fallback';
import { redactSecrets } from '../commands/init/redact-secrets';

/** What one install pair produced, and which manager finished it. */
export interface InstallOutcome {
  /** Absent on success; the capability's own failure otherwise. */
  readonly failure: CliStructuredError | undefined;
  /**
   * The manager override that succeeded, when the pnpm fallback fired. The
   * follow-up engine install reuses it: driving pnpm right after `pnpm add`
   * failed to resolve a workspace specifier would fail the same way.
   */
  readonly manager: PackageManagerId | undefined;
  readonly warnings: readonly string[];
}

function metaString(failure: CliStructuredError, key: string): string {
  const value = failure.meta?.[key];
  return typeof value === 'string' ? value : '';
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
    'pnpm could not install: a published Prisma Next dependency leaked a `workspace:*` or `catalog:` specifier.',
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

/**
 * Adds the runtime and development dependencies through the engine's package
 * manager. The retry is `init`'s alone: the engine spells and runs the
 * command, and this decides — from the stderr it returned — that another
 * manager is worth a try.
 */
/**
 * The engine dependency spec a fresh scaffold installs. The scaffolded
 * `prisma.config.ts` imports `defineConfig` from `@prisma/cli-engine`, and the
 * installed `prisma` names the exact engine version it runs against — so
 * the spec is read from the manifest the install just placed, never guessed
 * from a dist-tag (whose `latest` has lagged that version before and broken
 * the very next command). A CLI without a readable engine entry falls back to
 * the `next` tag, the release train the CLI itself publishes under.
 */
export function engineDevDependencySpec(cwd: string): string {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(join(cwd, 'node_modules', 'prisma', 'package.json'), 'utf-8'),
    );
    if (typeof manifest === 'object' && manifest !== null) {
      for (const field of ['dependencies', 'peerDependencies'] as const) {
        const block = Reflect.get(manifest, field);
        if (typeof block === 'object' && block !== null) {
          const engine = Reflect.get(block, '@prisma/cli-engine');
          if (typeof engine === 'string' && engine.length > 0) {
            return `@prisma/cli-engine@${engine}`;
          }
        }
      }
    }
  } catch {
    // The fallback below covers an unreadable or unparseable manifest.
  }
  return '@prisma/cli-engine@next';
}

export async function installProjectDependencies(ctx: {
  readonly packages: PackageOperations;
  readonly cwd: string;
  readonly deps: readonly string[];
  readonly devDeps: readonly string[];
  readonly catalogWarnings: readonly string[];
}): Promise<InstallOutcome> {
  const pair = async (manager?: PackageManagerId): Promise<CliStructuredError | undefined> => {
    const runtimeDeps = await ctx.packages.install({
      packages: ctx.deps,
      cwd: ctx.cwd,
      ...ifDefined('manager', manager),
    });
    if (!runtimeDeps.ok) {
      return runtimeDeps.failure;
    }
    const developmentDeps = await ctx.packages.install({
      packages: ctx.devDeps,
      dev: true,
      cwd: ctx.cwd,
      ...ifDefined('manager', manager),
    });
    return developmentDeps.ok ? undefined : developmentDeps.failure;
  };

  const failure = await pair();
  if (failure === undefined) {
    return { failure: undefined, manager: undefined, warnings: ctx.catalogWarnings };
  }
  if (!pnpmLeakedASpecifier(failure)) {
    return { failure, manager: undefined, warnings: [] };
  }

  const retryFailure = await pair('npm');
  if (retryFailure !== undefined) {
    // The npm failure is the one raised, but the pnpm failure that triggered
    // the retry is why npm ran at all — without it the user sees an npm error
    // with no trace of the first attempt.
    return { failure: retryFailure, manager: undefined, warnings: [retriedWarning(failure)] };
  }
  // npm bypassed pnpm's resolver, so the workspace catalog is not what ended
  // up installed — saying otherwise alongside the fallback would contradict it.
  return { failure: undefined, manager: 'npm', warnings: [fallbackWarning(failure)] };
}
