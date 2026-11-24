import { readFileSync, realpathSync } from 'node:fs';
import type { CliStructuredError } from '@prisma/cli-engine/protocol';
import { dirname } from 'pathe';
import { versionLines } from './init-version-lines';
import { installedManifest } from './project-modules';
import { type PublishedPackage, REGISTRY_LOOKUP_TIMEOUT_MILLIS } from './registry-keywords';

const PRISMA_ORM_PACKAGE_PREFIX = '@prisma/orm-';

/** What `init` did about one package in the list. */
export type RequiredPeerOutcome =
  /** `init` installed it at the version the list asks for. */
  | 'installed'
  /** The project already lists it, and its installed copy, or its line, is at that version. */
  | 'already-listed'
  /** The project lists it at another version; `init` left it and warned. */
  | 'left-at-another-version'
  /** Under `--skip-install`: the application has to install it. */
  | 'to-install';

export interface RequiredPeer {
  readonly name: string;
  /** The version or range the application lists it at, from the range the package that names it asks for. */
  readonly version: string;
  readonly outcome: RequiredPeerOutcome;
}

/**
 * The required peers of a target package: every `@prisma/orm-*` package it names as a peer
 * dependency, directly or through another such package (the list can hold another target package:
 * MariaDB's names MySQL's), and every other required peer dependency those packages name, such as
 * `temporal-polyfill`, whose own peers are not followed. A peer marked optional in
 * `peerDependenciesMeta` is not required. An application lists each of them beside the target
 * package, so it loads under a package manager that installs no peer dependencies.
 */
export interface RequiredPeers {
  /** The target package as the application lists it: `name@version` when it names `@prisma/orm-*` peers, otherwise its bare name. */
  readonly target: string;
  readonly packages: readonly RequiredPeer[];
  /** Packages whose own manifest could not be read, so their peers are missing from `packages`. */
  readonly unread: readonly string[];
  readonly warnings: readonly string[];
}

export function requiredPeerSpecifier(peer: RequiredPeer): string {
  return `${peer.name}@${peer.version}`;
}

interface ReadManifest {
  readonly version: string | undefined;
  /** Its required peer dependencies, with their ranges. */
  readonly peers: ReadonlyMap<string, string>;
}

/** Reads a package's manifest; `range` is the range a dependent names it at, `undefined` for the target package. */
type ReadPackage = (name: string, range: string | undefined) => Promise<ReadManifest | undefined>;

function manifestFrom(
  version: unknown,
  peerDependencies: unknown,
  peerDependenciesMeta: unknown,
): ReadManifest {
  const peers = new Map<string, string>();
  if (isRecord(peerDependencies)) {
    for (const [peer, range] of Object.entries(peerDependencies)) {
      if (typeof range === 'string' && !isOptional(peerDependenciesMeta, peer)) {
        peers.set(peer, range);
      }
    }
  }
  return { version: typeof version === 'string' ? version : undefined, peers };
}

function readInstalled(cwd: string, name: string): ReadManifest | undefined {
  return readManifestAt(installedManifest(cwd, name));
}

function readManifestAt(path: string | undefined): ReadManifest | undefined {
  if (path === undefined) return undefined;
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return undefined;
  }
  return isRecord(manifest)
    ? manifestFrom(
        manifest['version'],
        manifest['peerDependencies'],
        manifest['peerDependenciesMeta'],
      )
    : undefined;
}

/**
 * Reads the manifests installed for the project at `cwd`: found from the project, or from the
 * target package's own real folder, where its imports resolve. pnpm installs the peers it adds
 * itself beside the target package under `node_modules/.pnpm`, not at the project's root, and the
 * target package's `init` entrypoint finds them there.
 */
export function installedManifests(
  cwd: string,
  targetPackage: string,
): {
  readonly read: ReadPackage;
  readonly installedVersion: (name: string) => string | undefined;
} {
  const find = (name: string): ReadManifest | undefined =>
    readInstalled(cwd, name) ?? besideTarget(cwd, targetPackage, name);
  return {
    read: async (name) => find(name),
    installedVersion: (name) => find(name)?.version,
  };
}

function besideTarget(cwd: string, targetPackage: string, name: string): ReadManifest | undefined {
  const targetManifest = installedManifest(cwd, targetPackage);
  if (targetManifest === undefined) return undefined;
  let targetFolder: string;
  try {
    targetFolder = realpathSync(dirname(targetManifest));
  } catch {
    return undefined;
  }
  return readManifestAt(installedManifest(targetFolder, name));
}

/**
 * The required peers the printed Prisma 6 setup installs, read from the project's
 * installed manifests and, for a package the project has not installed, from the registry. Every
 * registry read shares one time limit. Nothing is installed.
 */
export function requiredPeersForSetup(ctx: {
  readonly cwd: string;
  /** Packages init or the printed setup installs another way, which the list leaves out. */
  readonly installedElsewhere: ReadonlySet<string>;
  readonly signal: AbortSignal;
  readonly readPublished: (
    name: string,
    spec: string,
    signal: AbortSignal,
  ) => Promise<PublishedPackage | undefined>;
}): (packageName: string) => Promise<RequiredPeers> {
  return async (packageName) => {
    const limit = new AbortController();
    const timer = setTimeout(
      () => limit.abort(new Error('the registry reads ran out of time')),
      REGISTRY_LOOKUP_TIMEOUT_MILLIS,
    );
    const signal = AbortSignal.any([ctx.signal, limit.signal]);
    const read: ReadPackage = async (name, range) => {
      const local = readInstalled(ctx.cwd, name);
      if (local !== undefined) return local;
      try {
        const published = await ctx.readPublished(name, range ?? 'latest', signal);
        return published === undefined
          ? undefined
          : manifestFrom(
              published.version,
              published.peerDependencies,
              published.peerDependenciesMeta,
            );
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        return undefined;
      }
    };
    let resolved: RequiredPeers | CliStructuredError;
    try {
      resolved = await resolveRequiredPeers({
        packageName,
        ownsTarget: false,
        installedElsewhere: ctx.installedElsewhere,
        declared: () => new Map(),
        installedVersion: () => undefined,
        install: undefined,
        read,
      });
    } finally {
      clearTimeout(timer);
    }
    return resolved instanceof Error
      ? { target: packageName, packages: [], unread: [packageName], warnings: [] }
      : resolved;
  };
}

/**
 * Collects the required peers of the target package: every `@prisma/orm-*` package its manifest
 * names as a peer, then the peers those name, until no new name appears, and every other required
 * peer those manifests name, whose own peers are not followed. With `install`,
 * it installs what the project does not list yet and reads again every package it installed, since
 * the version installed can name peers the copy on disk before did not. A copy installed at a
 * version other than the exact one asked for does not stand for it, so its peers are not followed;
 * when no install replaces it, a warning says its required peers could not be worked out. A package
 * the project lists at another version is left as it is and reported.
 */
export async function resolveRequiredPeers(ctx: {
  readonly packageName: string;
  /** Whether init wrote the target package's line, so it may pin it to the installed version. */
  readonly ownsTarget: boolean;
  /** Packages init installs another way, such as the CLI's engine, which the list leaves out. */
  readonly installedElsewhere: ReadonlySet<string>;
  readonly declared: () => ReadonlyMap<string, string>;
  readonly installedVersion: (name: string) => string | undefined;
  readonly install:
    | ((specifiers: readonly string[]) => Promise<CliStructuredError | undefined>)
    | undefined;
  readonly read: ReadPackage;
}): Promise<RequiredPeers | CliStructuredError> {
  const target = await ctx.read(ctx.packageName, undefined);
  if (
    target === undefined ||
    target.version === undefined ||
    ![...target.peers.keys()].some(isPrismaOrmPackage)
  ) {
    return {
      target: ctx.packageName,
      packages: [],
      unread: target === undefined ? [ctx.packageName] : [],
      warnings: [],
    };
  }
  const lines = versionLines(
    target.version,
    [...target.peers].filter(([name]) => isPrismaOrmPackage(name)).map(([, range]) => range),
  );
  const lineOf = (name: string, range: string) =>
    isPrismaOrmPackage(name) ? lines.ormPackage(range) : range;
  const targetSpecifier = `${ctx.packageName}@${lines.target}`;
  const wanted = new Map<string, { readonly range: string; readonly by: string }>();
  const outcomes = new Map<string, RequiredPeerOutcome>();
  const warnings: string[] = [];
  let unread: string[] = [];
  let level: { readonly name: string; readonly manifest: ReadManifest | undefined }[] = [
    { name: ctx.packageName, manifest: target },
  ];
  let pinTarget = ctx.ownsTarget;
  const atAnotherVersion = new Map<
    string,
    { readonly installed: string; readonly range: string; readonly by: string }
  >();
  const readWanted = async (name: string) => {
    const wantedAt = wanted.get(name);
    const manifest = await ctx.read(name, wantedAt?.range);
    const exact = wantedAt === undefined ? null : EXACT_VERSION_LINE.exec(wantedAt.range.trim());
    if (
      wantedAt !== undefined &&
      manifest?.version !== undefined &&
      exact !== null &&
      manifest.version !== exact[1]
    ) {
      atAnotherVersion.set(name, { installed: manifest.version, ...wantedAt });
      return { name, manifest: undefined };
    }
    atAnotherVersion.delete(name);
    return { name, manifest };
  };

  for (;;) {
    while (level.length > 0) {
      const next: string[] = [];
      for (const { name, manifest } of level) {
        if (manifest === undefined) {
          unread.push(name);
          continue;
        }
        for (const [peer, range] of manifest.peers) {
          if (peer === ctx.packageName || wanted.has(peer) || ctx.installedElsewhere.has(peer)) {
            continue;
          }
          wanted.set(peer, { range, by: name });
          if (isPrismaOrmPackage(peer)) next.push(peer);
        }
      }
      level = await Promise.all(next.map(readWanted));
    }

    const declared = ctx.declared();
    const toInstall: string[] = [];
    if (pinTarget && declared.get(ctx.packageName) !== lines.target) {
      toInstall.push(targetSpecifier);
    }
    pinTarget = false;
    for (const [name, { range, by }] of byName(wanted)) {
      if (outcomes.has(name)) continue;
      const listed = declared.get(name);
      if (listed === undefined) {
        if (ctx.install === undefined) {
          outcomes.set(name, 'to-install');
        } else {
          toInstall.push(`${name}@${lineOf(name, range)}`);
          outcomes.set(name, 'installed');
        }
        continue;
      }
      const installed = ctx.installedVersion(name);
      const line = lineOf(name, range);
      if (!isPrismaOrmPackage(name) || lines.standsFor(listed, line, installed)) {
        outcomes.set(name, 'already-listed');
        continue;
      }
      outcomes.set(name, 'left-at-another-version');
      warnings.push(
        `package.json lists ${name} at ${listed}${installed === undefined ? '' : `, installed at ${installed}`}, but ${by} needs ${line}; init left it as it is. Install ${name}@${line} so every Prisma ORM package is at one version.`,
      );
    }
    if (ctx.install === undefined || toInstall.length === 0) break;
    const failure = await ctx.install(toInstall);
    if (failure !== undefined) return failure;
    const reread = [...wanted]
      .filter(
        ([name, { range }]) =>
          isPrismaOrmPackage(name) && toInstall.includes(`${name}@${lineOf(name, range)}`),
      )
      .map(([name]) => name);
    unread = unread.filter((name) => !reread.includes(name));
    level = await Promise.all(reread.map(readWanted));
  }

  for (const [name, { installed: installedAt, range, by }] of atAnotherVersion) {
    unread = unread.filter((unreadName) => unreadName !== name);
    warnings.push(
      `${name} is installed at ${installedAt}, but ${by} needs ${range}, so init could not work out the packages ${name} needs as required peers. Once ${name}@${range} is installed, add each package its package.json lists under peerDependencies, at the range listed there.`,
    );
  }

  return {
    target: targetSpecifier,
    packages: byName(wanted).map(([name, { range }]) => ({
      name,
      version: lineOf(name, range),
      outcome: outcomes.get(name) ?? 'to-install',
    })),
    unread,
    warnings,
  };
}

const EXACT_VERSION_LINE = /^[v=]?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

function isPrismaOrmPackage(name: string): boolean {
  return name.startsWith(PRISMA_ORM_PACKAGE_PREFIX);
}

function isOptional(peerDependenciesMeta: unknown, peer: string): boolean {
  if (!isRecord(peerDependenciesMeta)) return false;
  const meta = peerDependenciesMeta[peer];
  return isRecord(meta) && meta['optional'] === true;
}

function byName<T>(entries: ReadonlyMap<string, T>): [string, T][] {
  return [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
