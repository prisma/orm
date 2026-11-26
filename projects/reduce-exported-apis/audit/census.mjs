// Lists who imports each published import path. Run from the repository root after a build: node projects/reduce-exported-apis/audit/census.mjs. Reads the outside products from shallow clones under wip/repos/ and writes wip/ga3/census.json.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { publicShells } from '../../../packages/0-shared/publish-surface/dist/shells.mjs';

const root = process.cwd();
const publicDir = 'packages/9-public/@prisma';
const outsideRepos = ['composer', 'prisma-cli', 'pdp-control-plane', 'create-prisma'];

const paths = new Map();
for (const dir of readdirSync(join(root, publicDir))) {
  const manifestFile = join(root, publicDir, dir, 'package.json');
  if (!existsSync(manifestFile)) continue;
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  for (const subpath of Object.keys(manifest.exports ?? {})) {
    if (subpath === './package.json') continue;
    const specifier = subpath === '.' ? manifest.name : `${manifest.name}/${subpath.slice(2)}`;
    paths.set(specifier, { package: manifest.name, subpath, importers: {} });
  }
}

const owners = new Map();
const shellDirs = [];
for (const [shell, definition] of publicShells) {
  for (const pkg of definition.packages) {
    owners.set(pkg.name, { shell, entry: pkg.entry });
    shellDirs.push({ dir: `${pkg.dir}/`, shell, kind: definition.kind });
  }
  shellDirs.push({ dir: `${definition.dir}/`, shell, kind: definition.kind });
}
shellDirs.push({
  dir: `${publicDir}/orm-better-auth/`,
  shell: '@prisma/orm-better-auth',
  kind: 'integration',
});
shellDirs.sort((a, b) => b.dir.length - a.dir.length);

for (const [shell, definition] of publicShells) {
  for (const mapping of definition.reexports ?? []) {
    const owner = owners.get(mapping.package);
    for (const [specifier, row] of paths) {
      if (row.package !== shell) continue;
      const prefix = `${shell}/${mapping.entry}`;
      if (specifier !== prefix && !specifier.startsWith(`${prefix}/`)) continue;
      const tail = specifier.slice(prefix.length);
      const base = owner.entry === '' ? owner.shell : `${owner.shell}/${owner.entry}`;
      // The facade's own code owns the name when the forwarded target does not exist.
      if (paths.has(`${base}${tail}`) && !(mapping.root === false && tail === '')) {
        row.forwardsTo = `${base}${tail}`;
      }
    }
  }
}

function publishedNameOf(specifier) {
  if (specifier.startsWith('@prisma/')) return specifier;
  const [scope, pkg, ...rest] = specifier.split('/');
  const owner = owners.get(`${scope}/${pkg}`);
  if (owner === undefined) return undefined;
  const tail = [owner.entry, rest.join('/')].filter(Boolean).join('/');
  return tail === '' ? owner.shell : `${owner.shell}/${tail}`;
}

function shellOf(file) {
  return shellDirs.find((entry) => file.startsWith(entry.dir));
}

const isTestFile = (file) =>
  /(^|\/)(test|tests|__tests__|test-d|fixtures)\//.test(file) ||
  /\.(test|test-d|spec)\.[cm]?tsx?$/.test(file);
const isGenerated = (file) =>
  /(^|\/)contract\.d\.ts$/.test(file) ||
  /(^|\/)migrations\//.test(file) ||
  /(^|\/)(end-contract|start-contract)\.d\.ts$/.test(file);
const isDoc = (file) => /\.(md|mdx|mdc)$/.test(file);

function categoryOf(file, specifier) {
  const outside = /^wip\/repos\/([^/]+)\//.exec(file);
  if (outside) {
    if (isGenerated(file)) return `outside:${outside[1]}:generated`;
    return `outside:${outside[1]}`;
  }
  if (file.startsWith('examples/')) {
    if (isGenerated(file)) return 'generated';
    if (isDoc(file)) return 'docs';
    return 'app';
  }
  if (isDoc(file) || file.startsWith('docs/') || file.startsWith('skills')) return 'docs';
  if (file.startsWith('test/') || file.startsWith('apps/'))
    return isGenerated(file) ? 'generated' : 'tests';
  if (file.startsWith('packages/')) {
    const shell = shellOf(file);
    if (isTestFile(file)) return 'tests';
    if (specifier.startsWith('@internal/')) {
      if (shell === undefined) return 'tooling';
      const owner = owners.get(specifier.split('/').slice(0, 2).join('/'));
      if (owner === undefined || owner.shell === shell.shell) return undefined;
      return `ours:${shell.kind}:${shell.shell}`;
    }
    // A published name written in package source: a template, an emitted import, or better-auth's own imports.
    if (shell?.kind === 'integration') return `ours:integration:${shell.shell}`;
    return 'source-string';
  }
  return 'tooling';
}

const specifierPattern = /['"`](@(?:prisma\/orm|internal)[A-Za-z0-9_./-]*)['"`]/g;
const scanned = /\.(ts|tsx|mts|cts|js|mjs|cjs|md|mdx|mdc|hbs|tmpl|vue|svelte|astro)$/;

function record(file, text) {
  for (const match of text.matchAll(specifierPattern)) {
    const published = publishedNameOf(match[1]);
    if (published === undefined) continue;
    const row = paths.get(published);
    if (row === undefined) {
      if (published.startsWith('@prisma/orm-'))
        unknown.set(published, [...(unknown.get(published) ?? []), file]);
      continue;
    }
    const category = categoryOf(file, match[1]);
    if (category === undefined) continue;
    const files = row.importers[category] ?? [];
    row.importers[category] = files;
    if (!files.includes(file)) files.push(file);
  }
}

const unknown = new Map();
const tracked = execFileSync('git', ['ls-files'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 1 << 28,
})
  .split('\n')
  .filter(
    (file) =>
      scanned.test(file) &&
      !file.startsWith('projects/') &&
      !file.startsWith('upgrade-instructions/') &&
      file !== 'CHANGELOG.md',
  );
for (const file of tracked) {
  const abs = join(root, file);
  if (!existsSync(abs)) continue;
  record(file, readFileSync(abs, 'utf8'));
}

function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', '.next', 'build'].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else if (scanned.test(entry.name) && statSync(full).size < 2_000_000) visit(full);
  }
}
for (const repo of outsideRepos) {
  const dir = join(root, 'wip/repos', repo);
  if (!existsSync(dir)) continue;
  walk(dir, (full) => record(full.slice(root.length + 1), readFileSync(full, 'utf8')));
}

// A facade path inherits nothing; a platform path lists the facade paths that forward to it.
for (const [specifier, row] of paths) {
  if (row.forwardsTo === undefined) continue;
  const target = paths.get(row.forwardsTo);
  target.forwardedBy = [...(target.forwardedBy ?? []), specifier];
}

const rows = [...paths].map(([specifier, row]) => ({ specifier, ...row }));
writeFileSync(
  join(root, 'wip/ga3/census.json'),
  JSON.stringify({ rows, unknown: Object.fromEntries(unknown) }, null, 1),
);

const categories = [...new Set(rows.flatMap((row) => Object.keys(row.importers)))].sort();
const groups = (row) => {
  const count = (test) =>
    Object.entries(row.importers)
      .filter(([category]) => test(category))
      .reduce((sum, [, files]) => sum + files.length, 0);
  return {
    app: count((c) => c === 'app'),
    generated: count((c) => c === 'generated' || c.endsWith(':generated')),
    sourceString: count((c) => c === 'source-string'),
    docs: count((c) => c === 'docs'),
    tests: count((c) => c === 'tests' || c === 'tooling'),
    extensions: count((c) => c.startsWith('ours:extension') || c.startsWith('ours:integration')),
    facades: count((c) => c.startsWith('ours:facade')),
    platform: count((c) => c.startsWith('ours:platform')),
    composer: count((c) => c === 'outside:composer'),
    cli: count((c) => c === 'outside:prisma-cli'),
    controlPlane: count((c) => c === 'outside:pdp-control-plane'),
    createPrisma: count((c) => c === 'outside:create-prisma'),
  };
};
const header = ['specifier', 'forwardsTo', 'forwardedByCount', ...Object.keys(groups(rows[0]))];
const lines = [header.join('\t')];
for (const row of rows) {
  lines.push(
    [
      row.specifier,
      row.forwardsTo ?? '',
      row.forwardedBy?.length ?? 0,
      ...Object.values(groups(row)),
    ].join('\t'),
  );
}
writeFileSync(join(root, 'wip/ga3/census.tsv'), `${lines.join('\n')}\n`);
console.log(
  `${rows.length} paths; categories: ${categories.length}; unknown published specifiers: ${unknown.size}`,
);
