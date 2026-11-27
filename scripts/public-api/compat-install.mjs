// Installs each package at the version the last release published it at, beside the current
// build, in a folder with a workspace of its own so that the repository's lockfile never changes. The release's third-party
// dependencies get the versions the current build resolves, which come from the repository's
// lockfile: with different versions on the two sides, every type from such a dependency would
// differ, and each would show up as a break.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, sep } from 'node:path';
export class InstallError extends Error {}

export const STAMP = 'last-release';
export const TWIN_STAMP = 'twin';

// TypeScript treats two copies of a package with the same name and version as one and reads only
// the first, so the release's copy gets a version of its own, and so does its second copy. The
// manifest is replaced, not written in place, because pnpm hard-links it from its global store.
export function stampVersion(packageDir, stamp = STAMP) {
  const file = join(packageDir, 'package.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  const version = manifest.version.replace(new RegExp(`-(${STAMP}|${TWIN_STAMP})$`), '');
  if (manifest.version === `${version}-${stamp}`) return;
  manifest.version = `${version}-${stamp}`;
  writeFileSync(`${file}.new`, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(`${file}.new`, file);
}

const SUPPLY_CHAIN_KEYS = [
  'blockExoticSubdeps',
  'minimumReleaseAge',
  'minimumReleaseAgeExclude',
  'trustPolicy',
  'trustPolicyExclude',
];

const scalar = (text) => {
  const value = text
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2');
  if (value === 'true' || value === 'false') return value === 'true';
  return /^\d+$/.test(value) ? Number(value) : value;
};

// The repository's supply-chain settings, from its pnpm-workspace.yaml, for the install of the
// last release. They are top-level scalars and lists of scalars, in either form, which is all this
// reads. Our own packages are excluded from the release-age cooldown, since the last release may
// be minutes old.
export function supplyChainSettings(workspaceYaml) {
  const settings = {};
  let list;
  for (const line of workspaceYaml.split('\n')) {
    const key = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (key) {
      list = undefined;
      if (!SUPPLY_CHAIN_KEYS.includes(key[1])) continue;
      const value = key[2].replace(/\s+#.*$/, '').trim();
      if (value === '') settings[key[1]] = list = [];
      else if (/^\[.*\]$/.test(value)) {
        settings[key[1]] = value
          .slice(1, -1)
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item !== '')
          .map(scalar);
      } else settings[key[1]] = scalar(value);
      continue;
    }
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && list) list.push(scalar(item[1]));
    else if (line.trim() !== '' && !/^\s*#/.test(line)) list = undefined;
  }
  if (settings.minimumReleaseAge !== undefined) {
    settings.minimumReleaseAgeExclude = [...(settings.minimumReleaseAgeExclude ?? []), '@prisma/*'];
  }
  return settings;
}

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

const isDeclarationOrManifest = (path) => !/\.([cm]?js|map)$/.test(path);

// A second copy of an installed release, and of each of our packages it depends on, with a version
// of its own: a comparison that fails between the release and its twin is one TypeScript cannot
// make between two copies of a declaration, not a change. Only declarations are copied; the
// third-party dependencies are links to the release's.
export function makeTwin({ releaseDir, twinRoot, ownNames, copies = new Map() }) {
  const source = realpathSync(releaseDir);
  if (copies.has(source)) return copies.get(source);
  const manifest = readManifest(source);
  // Two installed copies of one package, with different peers, each get a twin of their own.
  const dir = join(
    twinRoot,
    manifest.name,
    createHash('sha256').update(source).digest('hex').slice(0, 12),
  );
  copies.set(source, dir);
  rmSync(dir, { recursive: true, force: true });
  cpSync(source, dir, {
    recursive: true,
    filter: (path) =>
      !path.slice(source.length).includes(`${sep}node_modules`) && isDeclarationOrManifest(path),
  });
  stampVersion(dir, TWIN_STAMP);
  const names = new Set(DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})));
  for (const name of names) {
    const installed = findInstalled(source, name);
    if (installed === undefined) continue;
    const target = ownNames.has(name)
      ? makeTwin({ releaseDir: installed, twinRoot, ownNames, copies })
      : installed;
    const link = join(dir, 'node_modules', name);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link);
  }
  return dir;
}

// The install folder's dependencies and overrides. Each package is installed under an alias at the
// version the release published it at. Every package of ours the release has is pinned at its
// version from the release too, so that a range one of them names another by resolves to the
// release, not to something published since; third-party packages are pinned as `thirdParty` says.
export function releaseInstall({ packages, released, peers, thirdParty }) {
  return {
    dependencies: {
      ...peers,
      ...Object.fromEntries(
        packages.map(({ name, version }) => [aliasOf('release', name), `npm:${name}@${version}`]),
      ),
    },
    overrides: sortedObject({ ...thirdParty, ...released }),
  };
}

// Writes the install folder's manifest and workspace, installs, stamps every copy of our packages
// with a version of its own, and links each current package beside its release.
export function installRelease({
  dir,
  packages,
  released,
  thirdParty,
  peers,
  ownNames,
  settings = {},
}) {
  mkdirSync(dir, { recursive: true });
  const { dependencies, overrides } = releaseInstall({ packages, released, peers, thirdParty });
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'api-compat', private: true, type: 'module', dependencies }, null, 2)}\n`,
  );
  writeFileSync(
    join(dir, 'pnpm-workspace.yaml'),
    `${JSON.stringify({ packages: [], fetchRetries: 5, ...settings, overrides }, null, 2)}\n`,
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

  const twinRoot = join(dir, 'twins');
  rmSync(twinRoot, { recursive: true, force: true });
  const copies = new Map();
  for (const { name, dir: currentDir } of packages) {
    const links = {
      current: currentDir,
      twin: makeTwin({
        releaseDir: join(dir, 'node_modules', aliasOf('release', name)),
        twinRoot,
        ownNames,
        copies,
      }),
    };
    for (const [side, target] of Object.entries(links)) {
      const link = join(dir, 'node_modules', aliasOf(side, name));
      rmSync(link, { recursive: true, force: true });
      symlinkSync(target, link);
    }
  }
}
