import { readFileSync } from 'node:fs';
import type { CliStructuredError } from '@prisma/cli-engine/protocol';
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
  /** The version the package that names it asks for. */
  readonly version: string;
  readonly outcome: RequiredPeerOutcome;
}

/**
 * The Prisma ORM peer packages of a target package: every `@prisma/orm-*` package it names as a
 * peer dependency, directly or through another such package. An application lists each of them
 * beside the target package. The list can hold another target package: MariaDB's names MySQL's.
 */
export interface RequiredPeers {
  /** The target package as the application lists it: `name@version` when it has Prisma ORM peer packages, otherwise its bare name. */
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
  /** The `@prisma/orm-*` names in its `peerDependencies`, with their ranges. */
  readonly peers: ReadonlyMap<string, string>;
}

/** Reads a package's manifest; `range` is the range a dependent names it at, `undefined` for the target package. */
type ReadPackage = (name: string, range: string | undefined) => Promise<ReadManifest | undefined>;

function manifestFrom(version: unknown, peerDependencies: unknown): ReadManifest {
  const peers = new Map<string, string>();
  if (isRecord(peerDependencies)) {
    for (const [peer, range] of Object.entries(peerDependencies)) {
      if (peer.startsWith(PRISMA_ORM_PACKAGE_PREFIX) && typeof range === 'string') {
        peers.set(peer, range);
      }
    }
  }
  return { version: typeof version === 'string' ? version : undefined, peers };
}

function readInstalled(cwd: string, name: string): ReadManifest | undefined {
  const path = installedManifest(cwd, name);
  if (path === undefined) return undefined;
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return undefined;
  }
  return isRecord(manifest)
    ? manifestFrom(manifest['version'], manifest['peerDependencies'])
    : undefined;
}

/** Reads the manifests installed in the project at `cwd`. */
export function installedManifests(cwd: string): {
  readonly read: ReadPackage;
  readonly installedVersion: (name: string) => string | undefined;
} {
  return {
    read: async (name) => readInstalled(cwd, name),
    installedVersion: (name) => readInstalled(cwd, name)?.version,
  };
}

/**
 * The Prisma ORM peer packages the printed Prisma 6 setup installs, read from the project's
 * installed manifests and, for a package the project has not installed, from the registry. Every
 * registry read shares one time limit. Nothing is installed.
 */
export function requiredPeersForSetup(ctx: {
  readonly cwd: string;
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
          : manifestFrom(published.version, published.peerDependencies);
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
 * Collects the Prisma ORM peer packages of the target package: every `@prisma/orm-*` package its
 * manifest names as a peer, then the peers those name, until no new name appears. With `install`,
 * it installs what the project does not list yet and reads the manifests that only that install
 * put on disk. A package the project lists at another version is left as it is and reported.
 */
export async function resolveRequiredPeers(ctx: {
  readonly packageName: string;
  /** Whether init wrote the target package's line, so it may pin it to the installed version. */
  readonly ownsTarget: boolean;
  readonly declared: () => ReadonlyMap<string, string>;
  readonly installedVersion: (name: string) => string | undefined;
  readonly install:
    | ((specifiers: readonly string[]) => Promise<CliStructuredError | undefined>)
    | undefined;
  readonly read: ReadPackage;
}): Promise<RequiredPeers | CliStructuredError> {
  const target = await ctx.read(ctx.packageName, undefined);
  if (target === undefined || target.version === undefined || target.peers.size === 0) {
    return {
      target: ctx.packageName,
      packages: [],
      unread: target === undefined ? [ctx.packageName] : [],
      warnings: [],
    };
  }
  const targetSpecifier = `${ctx.packageName}@${target.version}`;
  const wanted = new Map<string, { readonly range: string; readonly by: string }>();
  const outcomes = new Map<string, RequiredPeerOutcome>();
  const warnings: string[] = [];
  let unread: string[] = [];
  let level: { readonly name: string; readonly manifest: ReadManifest | undefined }[] = [
    { name: ctx.packageName, manifest: target },
  ];
  let pinTarget = ctx.ownsTarget;

  for (;;) {
    while (level.length > 0) {
      const next: string[] = [];
      for (const { name, manifest } of level) {
        if (manifest === undefined) {
          unread.push(name);
          continue;
        }
        for (const [peer, range] of manifest.peers) {
          if (peer === ctx.packageName || wanted.has(peer)) continue;
          wanted.set(peer, { range, by: name });
          next.push(peer);
        }
      }
      level = await Promise.all(
        next.map(async (name) => ({
          name,
          manifest: await ctx.read(name, wanted.get(name)?.range),
        })),
      );
    }

    const declared = ctx.declared();
    const toInstall: string[] = [];
    if (pinTarget && declared.get(ctx.packageName) !== target.version) {
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
          toInstall.push(`${name}@${range}`);
          outcomes.set(name, 'installed');
        }
        continue;
      }
      const installed = ctx.installedVersion(name);
      if (lineStandsFor(listed, range, installed)) {
        outcomes.set(name, 'already-listed');
        continue;
      }
      outcomes.set(name, 'left-at-another-version');
      warnings.push(
        `package.json lists ${name} at ${listed}${installed === undefined ? '' : `, installed at ${installed}`}, but ${by} needs ${range}; init left it as it is. Install ${name}@${range} so every Prisma ORM package is at one version.`,
      );
    }
    if (ctx.install === undefined || toInstall.length === 0) break;
    const failure = await ctx.install(toInstall);
    if (failure !== undefined) return failure;
    const retry = unread.filter((name) => toInstall.some((spec) => spec.startsWith(`${name}@`)));
    unread = unread.filter((name) => !retry.includes(name));
    if (retry.length === 0) break;
    level = await Promise.all(
      retry.map(async (name) => ({
        name,
        manifest: await ctx.read(name, wanted.get(name)?.range),
      })),
    );
  }

  return {
    target: targetSpecifier,
    packages: byName(wanted).map(([name, { range }]) => ({
      name,
      version: range,
      outcome: outcomes.get(name) ?? 'to-install',
    })),
    unread,
    warnings,
  };
}

const EXACT_VERSION_LINE = /^[v=]?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

/**
 * Whether a `package.json` line stands for `version`. An exact version is judged by its text, since
 * the next clean install follows it whatever is installed now. Any other line (a range, a dist-tag,
 * or a `workspace:`, `catalog:`, `link:`, `file:` or alias line) cannot be judged from its text
 * without resolving it, so the installed copy decides, and with nothing installed it counts as
 * standing for the version. A caret line `init` wrote for one release candidate still admits the
 * next one after an update, so it must not be judged by its text.
 */
function lineStandsFor(line: string, version: string, installed: string | undefined): boolean {
  const exact = EXACT_VERSION_LINE.exec(line.trim());
  if (exact !== null) return exact[1] === version;
  return installed === undefined || installed === version;
}

function byName<T>(entries: ReadonlyMap<string, T>): [string, T][] {
  return [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
