// Installs the last release of each package beside the current build, in a folder with a
// workspace of its own so that the repository's lockfile never changes. The release's third-party
// dependencies get the versions the current build resolves, which come from the repository's
// lockfile: with different versions on the two sides, every type from such a dependency would
// differ, and each would show up as a break.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { stampVersion } from './compat.mjs';

export class InstallError extends Error {}

const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

const readManifest = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

function findInstalled(fromDir, name) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(dir) === dir) return undefined;
  }
}

// pnpm overrides for every third-party package the given packages depend on, directly or not,
// giving each the version installed here. A name installed at more than one version is pinned
// under each parent that has it (`parent>name`, or `parent@version>name` when the parent is also
// installed twice); what that cannot pin is left out and listed in `conflicts`.
export function thirdPartyVersions(packageDirs, ownNames) {
  const found = new Map();
  const edges = [];
  const seen = new Set();
  const stack = packageDirs.map((dir) => realpathSync(dir));
  while (stack.length > 0) {
    const dir = stack.pop();
    if (seen.has(dir)) continue;
    seen.add(dir);
    const manifest = readManifest(dir);
    if (!ownNames.has(manifest.name)) addTo(found, manifest.name, manifest.version);
    for (const field of DEPENDENCY_FIELDS) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        const installed = findInstalled(dir, name);
        if (installed === undefined) continue;
        stack.push(installed);
        edges.push({ parent: manifest.name, parentVersion: manifest.version, name, installed });
      }
    }
  }
  const versionOf = (dir) => readManifest(dir).version;
  const versions = {};
  const conflicts = {};
  for (const name of [...found.keys()].sort()) {
    const all = found.get(name);
    if (all.size === 1) {
      versions[name] = [...all][0];
      continue;
    }
    const byParent = new Map();
    const byParentVersion = new Map();
    for (const edge of edges.filter((candidate) => candidate.name === name)) {
      addTo(byParent, `${edge.parent}>${name}`, versionOf(edge.installed));
      addTo(
        byParentVersion,
        `${edge.parent}@${edge.parentVersion}>${name}`,
        versionOf(edge.installed),
      );
    }
    for (const [key, parentVersions] of byParent) {
      if (parentVersions.size === 1) {
        versions[key] = [...parentVersions][0];
        continue;
      }
      const parent = key.slice(0, -`>${name}`.length);
      for (const [versionKey, childVersions] of byParentVersion) {
        if (!versionKey.startsWith(`${parent}@`)) continue;
        if (childVersions.size === 1) versions[versionKey] = [...childVersions][0];
        else conflicts[versionKey] = [...childVersions].sort();
      }
    }
  }
  return { versions: sortedObject(versions), conflicts: sortedObject(conflicts) };
}

function addTo(map, key, value) {
  const values = map.get(key) ?? new Set();
  values.add(value);
  map.set(key, values);
}

const sortedObject = (object) =>
  Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

// pnpm does not install optional peers, and a release whose declarations import a missing one
// would compare as \`any\`. Every peer of our packages is therefore installed beside the release,
// at the version the current build has.
export function peerDependencies(packageDirs, ownNames, versions) {
  const peers = {};
  for (const dir of packageDirs) {
    for (const name of Object.keys(readManifest(dir).peerDependencies ?? {})) {
      if (!ownNames.has(name) && versions[name] !== undefined) peers[name] = versions[name];
    }
  }
  return sortedObject(peers);
}

export const aliasOf = (side, name) => `${side}-${name.replace(/^@prisma\//, '')}`;

// Writes the install folder's manifest and workspace, installs, stamps every copy of our packages
// with a version of its own, and links each current package beside its release.
export function installRelease({ dir, packages, version, overrides, peers, ownNames }) {
  mkdirSync(dir, { recursive: true });
  const dependencies = {
    ...peers,
    ...Object.fromEntries(
      packages.map(({ name }) => [aliasOf('release', name), `npm:${name}@${version}`]),
    ),
  };
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'api-compat', private: true, type: 'module', dependencies }, null, 2)}\n`,
  );
  writeFileSync(
    join(dir, 'pnpm-workspace.yaml'),
    `${JSON.stringify({ packages: [], fetchRetries: 5, overrides }, null, 2)}\n`,
  );
  execFileSync(
    'pnpm',
    ['install', '--no-frozen-lockfile', '--ignore-scripts', '--prefer-offline'],
    {
      cwd: dir,
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );

  const store = join(dir, 'node_modules', '.pnpm');
  for (const entry of readdirSync(store)) {
    const scope = join(store, entry, 'node_modules', '@prisma');
    if (!entry.startsWith('@prisma+') || !existsSync(scope)) continue;
    for (const name of readdirSync(scope)) {
      const packageDir = join(scope, name);
      if (!ownNames.has(`@prisma/${name}`) || lstatSync(packageDir).isSymbolicLink()) continue;
      if (!realpathSync(packageDir).startsWith(`${realpathSync(dir)}${sep}`)) {
        throw new InstallError(
          `${packageDir} is outside ${dir}, so its version is not stamped: pnpm may be using a global virtual store`,
        );
      }
      stampVersion(packageDir);
    }
  }

  for (const { name, dir: currentDir } of packages) {
    const link = join(dir, 'node_modules', aliasOf('current', name));
    rmSync(link, { recursive: true, force: true });
    symlinkSync(currentDir, link);
  }
}
