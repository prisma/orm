import { readFileSync } from 'node:fs';
import type { CliStructuredError } from '@prisma/cli-engine/protocol';
import { installedManifest } from './project-modules';

const PRISMA_ORM_PACKAGE_PREFIX = '@prisma/orm-';

/** The packages the application lists for its target package, each as a `name@range` specifier. */
export interface PlatformPackages {
  /** The target package, pinned to its installed version when it names Prisma ORM peers, then those peers. */
  readonly dependencies: readonly string[];
  readonly warnings: readonly string[];
}

interface InstalledPackage {
  readonly version: string | undefined;
  /** The `@prisma/orm-*` names in its `peerDependencies`, with their ranges. */
  readonly peers: ReadonlyMap<string, string>;
}

function readInstalled(cwd: string, name: string): InstalledPackage | undefined {
  const path = installedManifest(cwd, name);
  if (path === undefined) return undefined;
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return undefined;
  }
  if (!isRecord(manifest)) return undefined;
  const version = typeof manifest['version'] === 'string' ? manifest['version'] : undefined;
  const peerDependencies = manifest['peerDependencies'];
  const peers = new Map<string, string>();
  if (isRecord(peerDependencies)) {
    for (const [peer, range] of Object.entries(peerDependencies)) {
      if (peer.startsWith(PRISMA_ORM_PACKAGE_PREFIX) && typeof range === 'string') {
        peers.set(peer, range);
      }
    }
  }
  return { version, peers };
}

/**
 * Collects every `@prisma/orm-*` package the installed target package names as a peer, then the
 * peers those name, until no new name appears, from the manifests on disk. With `install`, it
 * installs what the project does not list yet and reads the manifests that only that install put
 * on disk. A package the project lists at another range is left as it is and reported.
 */
export async function resolvePlatformPackages(ctx: {
  readonly cwd: string;
  readonly packageName: string;
  /** Whether init wrote the target package's line, so it may pin it to the installed version. */
  readonly ownsTarget: boolean;
  readonly declared: () => ReadonlyMap<string, string>;
  readonly install:
    | ((specifiers: readonly string[]) => Promise<CliStructuredError | undefined>)
    | undefined;
}): Promise<PlatformPackages | CliStructuredError> {
  const target = readInstalled(ctx.cwd, ctx.packageName);
  if (target === undefined || target.version === undefined || target.peers.size === 0) {
    return { dependencies: [ctx.packageName], warnings: [] };
  }
  const targetSpecifier = `${ctx.packageName}@${target.version}`;
  const wanted = new Map<string, { readonly range: string; readonly by: string }>();
  const warnings: string[] = [];
  const handled = new Set<string>();
  let unread: string[] = [ctx.packageName];
  let pinTarget = ctx.ownsTarget;

  while (unread.length > 0) {
    const pending = unread;
    unread = [];
    for (let name = pending.shift(); name !== undefined; name = pending.shift()) {
      const manifest = name === ctx.packageName ? target : readInstalled(ctx.cwd, name);
      if (manifest === undefined) {
        unread.push(name);
        continue;
      }
      for (const [peer, range] of manifest.peers) {
        if (peer === ctx.packageName || wanted.has(peer)) continue;
        wanted.set(peer, { range, by: name });
        pending.push(peer);
      }
    }

    const declared = ctx.declared();
    const toInstall: string[] = [];
    if (pinTarget && declared.get(ctx.packageName) !== target.version) {
      toInstall.push(targetSpecifier);
    }
    pinTarget = false;
    for (const [name, { range, by }] of byName(wanted)) {
      if (handled.has(name)) continue;
      handled.add(name);
      const listed = declared.get(name);
      if (listed === undefined) {
        toInstall.push(`${name}@${range}`);
      } else if (listed !== range) {
        warnings.push(
          `package.json lists ${name} at ${listed}, but ${by} needs ${range}; init left it as it is. Install ${name}@${range} so every Prisma ORM package is at one version.`,
        );
      }
    }
    if (ctx.install === undefined || toInstall.length === 0) break;
    const failure = await ctx.install(toInstall);
    if (failure !== undefined) return failure;
    unread = unread.filter((name) => toInstall.some((spec) => spec.startsWith(`${name}@`)));
  }

  return {
    dependencies: [
      targetSpecifier,
      ...byName(wanted).map(([name, { range }]) => `${name}@${range}`),
    ],
    warnings,
  };
}

function byName<T>(entries: ReadonlyMap<string, T>): [string, T][] {
  return [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
