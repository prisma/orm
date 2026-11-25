import { readFileSync } from 'node:fs';
import type { PackageOperations } from '@prisma/cli-engine';
import type { CliStructuredError } from '@prisma/cli-engine/protocol';
import { join } from 'pathe';

/** The engine `prisma.config.ts` imports `definePrismaConfig` from; init installs it as a development dependency. */
export const ENGINE_PACKAGE = '@prisma/cli-engine';

/**
 * The engine dependency spec a fresh scaffold installs. The scaffolded
 * `prisma.config.ts` imports `definePrismaConfig` from `@prisma/cli-engine`, and the
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
          const engine = Reflect.get(block, ENGINE_PACKAGE);
          if (typeof engine === 'string' && engine.length > 0) {
            return `${ENGINE_PACKAGE}@${engine}`;
          }
        }
      }
    }
  } catch {
    // The fallback below covers an unreadable or unparseable manifest.
  }
  return `${ENGINE_PACKAGE}@latest`;
}

/**
 * Adds the runtime and development dependencies through the engine's package manager. Returns the
 * first failure it reports, or `undefined` when both installs succeed.
 */
export async function installProjectDependencies(ctx: {
  readonly packages: PackageOperations;
  readonly cwd: string;
  readonly deps: readonly string[];
  readonly devDeps: readonly string[];
}): Promise<CliStructuredError | undefined> {
  for (const [packages, dev] of [
    [ctx.deps, false],
    [ctx.devDeps, true],
  ] as const) {
    if (packages.length === 0) {
      continue;
    }
    const installed = await ctx.packages.install({
      packages,
      cwd: ctx.cwd,
      ...(dev ? { dev } : {}),
    });
    if (!installed.ok) {
      return installed.failure;
    }
  }
  return undefined;
}
