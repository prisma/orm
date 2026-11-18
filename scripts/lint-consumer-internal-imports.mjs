#!/usr/bin/env node
/**
 * A consumer project names no internal workspace package.
 *
 * ADR 242 makes an application depend on exactly one `@prisma/orm-*` database
 * package plus whatever extension packs it installs. The `@internal/*`
 * names are this repository's own vocabulary and are not published at all, so
 * a consumer that names one is describing an install no user could reproduce.
 * The repository's own consumers are the standing proof of that, and they can
 * fall short of it in two ways, so each scope is measured twice:
 *
 *   - **imports** — a line naming an `@internal/*` specifier.
 *   - **manifests** — an internal package a consumer's `package.json` names,
 *     as its own `name` or in `dependencies` / `devDependencies`. A consumer
 *     could import nothing internal and still list a dozen internal packages,
 *     and its install would look nothing like a real application's.
 *
 * Either one is a failure. There is no threshold and no allowance: the rule is
 * that the count is zero, and a check that admits a number invites the number
 * to grow.
 *
 * The shipped `prisma-8` skill is a consumer too: an agent copies its imports
 * into an application. Its prose scopes ({@link proseScopeFiles}) are measured
 * a third way:
 *
 *   - **prose** — a Markdown line naming an `@internal/*` package anywhere, or
 *     naming an `@prisma/orm-*` entry that the package's `exports` lacks.
 *
 * The prose scopes are the skill's router and references, pending upgrade
 * fragments, and the upgrade guides of every release after
 * {@link UPGRADE_GUIDES_CHECKED_AFTER}; the guides up to it stay as they
 * shipped. Two things in an upgrade guide must match what extension code
 * contains, workspace names included, so they are not prose and are not read:
 * the patterns of a change's `detection` block, and the codemod scripts beside
 * the guide (only `.md` files are read).
 *
 * This is not `lint-single-import-root.mjs`. That one forbids a consumer
 * naming *both* roots at once, which loads two copies of every module they
 * share. This one forbids naming the internal root at all.
 *
 * Exit codes:
 *   0 — no scope names an internal package
 *   1 — at least one does
 *   2 — the command line names files; the check always scans every scope
 *
 * The script uses process.cwd() as the git root so tests can supply a
 * temporary fixture repo by setting cwd on the child process.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import {
  comparePrecedence,
  PENDING,
  PUBLISHED_ROOT,
  parseTransitionLabel,
  parseVersion,
  publishedTransitionOf,
} from './check-upgrade-coverage.mjs';

const GIT_ROOT = process.cwd();

const INTERNAL_SCOPE = '@internal/';

/**
 * The trees this check governs: the ones shaped like something a user would
 * write.
 *
 * Most of `test/` is deliberately absent, and that is a statement about what
 * those suites are for rather than an allowance made to them. `test/integration`'s
 * port suites, its fixtures, and the `sql-orm-client` and `sql-builder` suites
 * exist to exercise internal packages directly — those packages are the code
 * under test. Rewriting them onto a database package would replace what they
 * cover with coverage of that package's re-exports, which is a different and
 * much smaller thing. They are not consumers, and this check has nothing to
 * say about them.
 *
 * `test/e2e/framework` stands in for an application and `cli-journeys` drives
 * the CLI the way a user does, so both are in. `cli-journeys` owns no
 * `package.json`; its dependencies come from `test/integration`, which is out
 * of scope for the reason above.
 */
export const CONSUMER_SCOPES = [
  'examples',
  'apps',
  'test/e2e/framework',
  'test/integration/test/cli-journeys',
];

/**
 * Every form hand-written and generated code uses to name a module: `import …
 * from '<s>'`, a bare side-effect `import '<s>'`, `import('<s>')` in a type
 * position, and `export … from '<s>'`. Both quote styles, so a change of
 * quoting cannot silently empty the scan.
 */
const MODULE_SPECIFIER = /\b(?:from|import)\s*\(?\s*(['"])([^'"\n]+)\1/g;

const SCANNABLE_EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/**
 * Everything a consumer ships or runs counts, including its tests, its vitest
 * and vite configs, and its generated `contract.d.ts` and `migration.ts` —
 * those generated files are exactly what the emitter's import root decides,
 * so excluding them would hide the largest part of the work.
 */
export function isScannableFile(relPath) {
  if (!SCANNABLE_EXTENSIONS.test(relPath)) return false;
  if (/(^|\/)(dist|dist-tsc|dist-tsc-prod|node_modules|coverage|build)\//.test(relPath)) {
    return false;
  }
  return true;
}

/** The internal specifiers one line names, in source order, without duplicates. */
export function internalSpecifiersOnLine(line) {
  const found = [];
  for (const [, , specifier] of line.matchAll(MODULE_SPECIFIER)) {
    if (specifier.startsWith(INTERNAL_SCOPE) && !found.includes(specifier)) found.push(specifier);
  }
  return found;
}

/** One record per line naming at least one internal specifier. */
export function findMatchingLines(content) {
  const out = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const specifiers = internalSpecifiersOnLine(lines[i]);
    if (specifiers.length > 0) out.push({ line: i + 1, specifiers, text: lines[i].trim() });
  }
  return out;
}

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function trackedFiles(scanDir, scopePath) {
  return git(scanDir, 'ls-files', '--', scopePath).split('\n').filter(Boolean);
}

/** One record per line in `scopePath` that names an internal specifier. */
export function scanScope(scanDir, scopePath) {
  const files = trackedFiles(scanDir, scopePath).filter(isScannableFile);

  const records = [];
  for (const relPath of files) {
    let content;
    try {
      content = readFileSync(join(scanDir, relPath), 'utf-8');
    } catch (cause) {
      // A tracked file this cannot read is a file it cannot clear, and
      // silently not scanning one is indistinguishable from scanning it and
      // finding nothing.
      throw new Error(`${relPath} is tracked but could not be read`, { cause });
    }
    for (const match of findMatchingLines(content)) {
      records.push({ file: relPath, ...match });
    }
  }
  return records;
}

export const UPGRADE_GUIDES_CHECKED_AFTER = '8.0.0-rc.24';
const ALWAYS_PROSE = ['skills/prisma-8/SKILL.md', 'skills/prisma-8/references'];

/** Whether the guide for the transition `<from>-to-<to>` is held to the prose rule. */
export function isTransitionChecked(transition) {
  return (
    comparePrecedence(
      parseTransitionLabel(transition).to,
      parseVersion(UPGRADE_GUIDES_CHECKED_AFTER),
    ) > 0
  );
}

/** The tracked Markdown files whose prose must name only published entries. */
export function proseScopeFiles(scanDir) {
  const always = trackedFiles(scanDir, ALWAYS_PROSE[0])
    .concat(trackedFiles(scanDir, ALWAYS_PROSE[1]))
    .concat(trackedFiles(scanDir, PENDING));
  const guides = trackedFiles(scanDir, PUBLISHED_ROOT).filter((relPath) => {
    const transition = publishedTransitionOf(relPath);
    return transition !== undefined && isTransitionChecked(transition);
  });
  return [...always, ...guides].filter((relPath) => relPath.endsWith('.md'));
}

const INTERNAL_NAME = /@internal\/[A-Za-z0-9._/-]*[A-Za-z0-9_]/g;
// A placeholder such as `@prisma/orm-<target>/runtime` or `@prisma/orm-family-*` names no entry.
const PUBLISHED_NAME =
  /@prisma\/orm-[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9][a-z0-9_-]*)*(?![-<*/\w])/g;

/** Every string a guide's `detection` blocks hold; a line repeating one of them is a pattern, not prose. */
function detectionPatterns(content) {
  let data;
  try {
    ({ data } = matter(content));
  } catch {
    return [];
  }
  const changes = Array.isArray(data?.changes) ? data.changes : [];
  return changes.flatMap((change) =>
    change !== null && typeof change === 'object' && change.detection
      ? Object.values(change.detection)
          .flat()
          .filter((value) => typeof value === 'string')
      : [],
  );
}

function asYamlScalar(line) {
  const text = line.trim().replace(/^-\s+/, '');
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replaceAll("''", "'");
  if (text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1);
  return text.replace(/^[A-Za-z]+:\s*/, '');
}

/**
 * The published entries a package declares, as `@prisma/orm-x/<subpath>`, or
 * `undefined` when the package is not in the repository. A bare package name
 * is allowed whenever the package exists: prose names it to install it.
 */
export function publishedEntries(scanDir, packageName) {
  const manifest = join(scanDir, 'packages/9-public', packageName, 'package.json');
  if (!existsSync(manifest)) return undefined;
  const exports = JSON.parse(readFileSync(manifest, 'utf-8')).exports ?? {};
  return new Set(
    Object.keys(exports).map((key) =>
      key === '.' ? packageName : `${packageName}/${key.slice(2)}`,
    ),
  );
}

/** One record per prose line naming an internal package or a published entry that does not exist. */
export function findProseNames(content, entriesOf) {
  const patterns = detectionPatterns(content);
  const lines = content.split('\n');
  const frontmatterEnd = lines[0]?.trim() === '---' ? lines.indexOf('---', 1) : -1;
  const records = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i < frontmatterEnd && patterns.includes(asYamlScalar(line))) continue;
    const internal = [...new Set(line.match(INTERNAL_NAME) ?? [])];
    const unpublished = [...new Set(line.match(PUBLISHED_NAME) ?? [])].filter((specifier) => {
      const packageName = specifier.split('/').slice(0, 2).join('/');
      const entries = entriesOf(packageName);
      if (entries === undefined) return true;
      return specifier !== packageName && !entries.has(specifier);
    });
    if (internal.length > 0 || unpublished.length > 0) {
      records.push({ line: i + 1, internal, unpublished });
    }
  }
  return records;
}

export function scanProse(scanDir) {
  const cache = new Map();
  const entriesOf = (packageName) => {
    if (!cache.has(packageName)) cache.set(packageName, publishedEntries(scanDir, packageName));
    return cache.get(packageName);
  };
  return proseScopeFiles(scanDir).flatMap((relPath) =>
    findProseNames(readFileSync(join(scanDir, relPath), 'utf-8'), entriesOf).map((record) => ({
      file: relPath,
      ...record,
    })),
  );
}

const MANIFEST_FIELDS = ['dependencies', 'devDependencies'];

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One record per internal package a consumer manifest in `scopePath` names.
 *
 * A project's own `name` counts alongside its dependencies: a project carrying
 * our internal scope is describing itself as part of the framework, which no
 * user's application is.
 */
export function scanManifests(scanDir, scopePath) {
  const manifests = trackedFiles(scanDir, scopePath)
    .filter((relPath) => /(^|\/)package\.json$/.test(relPath))
    .filter((relPath) => !/(^|\/)node_modules\//.test(relPath));

  const records = [];
  for (const relPath of manifests) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(scanDir, relPath), 'utf-8'));
    } catch (cause) {
      // Skipping would report a manifest nobody could read as one declaring
      // nothing, so a file broken by an edit would pass the check that exists
      // to read it.
      throw new Error(`${relPath} could not be read as JSON`, { cause });
    }
    if (!isRecord(parsed)) {
      throw new Error(`${relPath} is valid JSON but not a JSON object`);
    }
    if (typeof parsed.name === 'string' && parsed.name.startsWith(INTERNAL_SCOPE)) {
      records.push({ file: relPath, field: 'name', package: parsed.name });
    }
    for (const field of MANIFEST_FIELDS) {
      const declared = parsed[field];
      if (!isRecord(declared)) continue;
      for (const name of Object.keys(declared)) {
        if (name.startsWith(INTERNAL_SCOPE)) records.push({ file: relPath, field, package: name });
      }
    }
  }
  return records;
}

const CONSUMER_RULE =
  'A consumer depends on one @prisma/orm-* database package and its extension packs,\n' +
  'and imports only published names. The @internal/* packages are not\n' +
  'published, so naming one describes an install no user could reproduce (ADR 242).\n' +
  'If the published surface has no name for something a consumer needs, that is a\n' +
  'gap in the surface, not a reason to keep the workspace name.';

function report(scopePath, label, records, render) {
  console.error(`\n  ${scopePath}: ${records.length} ${label}`);
  for (const record of records.slice(0, 20)) console.error(`    ${render(record)}`);
  if (records.length > 20) console.error(`    … and ${records.length - 20} more`);
}

export function main(scopes = CONSUMER_SCOPES) {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith('--'));
  if (positional.length > 0) {
    console.error(
      `lint-consumer-internal-imports takes no file arguments (got ${positional.join(', ')}); it always scans every scope.`,
    );
    return 2;
  }
  const list = args.includes('--list');
  let failed = false;

  for (const scopePath of scopes) {
    const imports = scanScope(GIT_ROOT, scopePath);
    const manifests = scanManifests(GIT_ROOT, scopePath);

    if (imports.length > 0) {
      report(
        scopePath,
        'import line(s) naming an internal package',
        imports,
        (r) => `${r.file}:${r.line}: ${r.specifiers.join(', ')}`,
      );
      failed = true;
    }
    if (manifests.length > 0) {
      report(
        scopePath,
        'internal package(s) named by a manifest',
        manifests,
        (r) => `${r.file} ${r.field}: ${r.package}`,
      );
      failed = true;
    }
    if (list) {
      for (const record of imports) {
        console.log(`  ${record.file}:${record.line}: ${record.specifiers.join(', ')}`);
      }
      for (const record of manifests) {
        console.log(`  ${record.file} ${record.field}: ${record.package}`);
      }
    }
  }

  const prose = scanProse(GIT_ROOT);
  if (prose.length > 0) {
    report(
      'the shipped skill and upgrade instructions',
      'prose line(s) naming a package an application cannot import',
      prose,
      (r) =>
        `${r.file}:${r.line}: ${[
          ...r.internal.map((name) => `${name} (not published)`),
          ...r.unpublished.map((name) => `${name} (no such export)`),
        ].join(', ')}`,
    );
    failed = true;
  }
  if (list) {
    for (const r of prose) {
      console.log(`  ${r.file}:${r.line}: ${[...r.internal, ...r.unpublished].join(', ')}`);
    }
  }

  if (failed) {
    console.error(`\n${CONSUMER_RULE}\n`);
    return 1;
  }
  console.log(
    `No consumer project under ${scopes.join(', ')}, and no prose in the shipped skill or upgrade instructions, names an @internal/* package or an unpublished entry.`,
  );
  return 0;
}

if (process.argv[1] === import.meta.filename) process.exit(main());
