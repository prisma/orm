#!/usr/bin/env node
// Publish-time CI gate.
//
// For every publishable package, packs the tarball that `pnpm publish` would
// upload to the registry and runs two checks against the tarball's
// `package.json`:
//
//   1. `workspace:` / `catalog:` leak check. Both are pnpm-internal
//      protocols, meaningless on the registry and install-breaking for
//      downstream npm/pnpm/yarn consumers. `pnpm publish` rewrites them on
//      its own, but `npm publish` and some CI flows do not — this catches
//      the leak before the broken tarball reaches the registry. Covers
//      every dep field.
//
//   2. `@internal/*` exact-pin check. Every `@internal/*` entry in
//      `dependencies`, `peerDependencies`, and `optionalDependencies`
//      (the three fields that ship to consumers; `devDependencies` is
//      skipped) must be a single exact version `X.Y.Z` (with an optional
//      semver pre-release suffix). Carets, tildes, ranges, and wildcards
//      all fail. Combined with the `workspace:<X.Y.Z>` literal-version
//      form in the source manifests, this is the mechanism that gives
//      every published `@internal/*` package an exact pin on its
//      siblings, which is what `prisma-8-check-pins` exploits on the
//      consumer side.
//
//   3. Declaration-dependency check. Every module specifier named by a
//      `.d.ts`/`.d.mts`/`.d.cts` file inside the tarball must resolve for a
//      consumer: the package it belongs to has to appear in
//      `dependencies`, `peerDependencies`, or `optionalDependencies`, and
//      if that package ships no types of its own, its `@types/*` companion
//      has to be declared too. `devDependencies` do not count — consumers
//      never install them. Without this, a package compiles in the
//      workspace (where pnpm has every dev dependency linked) and fails for
//      anyone who builds with `skipLibCheck: false`.
//
//   4. Sibling-dependency check. No published package may hold another
//      package this repository publishes under `dependencies` or
//      `optionalDependencies`; it names it as a peer dependency, so the
//      application's own list is the only place a copy comes from.
//
// Usage:
//   node scripts/check-publish-deps.mjs           — exit 1 on any violation
//   node scripts/check-publish-deps.mjs --json    — same, with JSON report
//
// Wired into `.github/workflows/publish.yml` immediately before the publish
// step. Also runnable locally: `pnpm check:publish-deps`.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const DEP_FIELDS = /** @type {const} */ ([
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]);

// `@internal/*` exact-pin check looks only at the three fields that
// ship to consumers. devDependencies aren't installed by consumers so
// imprecise specs there don't affect the type-identity invariant the
// pin check enforces.
const SHIPPED_DEP_FIELDS = /** @type {const} */ ([
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
]);

const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Returns true if `spec` is a published-tarball-poisoning specifier
 * (`workspace:*`, `catalog:foo`, etc.). Both pnpm-internal protocols are
 * meaningless on the registry and break downstream installs.
 *
 * Exported so the unit test in
 * `test/scripts/check-publish-deps.test.mjs` can exercise the rule
 * without packing tarballs.
 */
export function isLeak(spec) {
  return typeof spec === 'string' && (spec.startsWith('workspace:') || spec.startsWith('catalog:'));
}

/**
 * Walks every dependency field on a package.json-shaped object and
 * returns the list of `(field, name, spec)` triples that
 * {@link isLeak} flags. Pure / side-effect-free; exported for tests.
 *
 * @param {Record<string, unknown>} pkgJson
 * @returns {Array<{ field: string; name: string; spec: string }>}
 */
export function findLeaks(pkgJson) {
  const leaks = [];
  for (const field of DEP_FIELDS) {
    const deps = pkgJson[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (isLeak(spec)) {
        leaks.push({ field, name, spec });
      }
    }
  }
  return leaks;
}

/**
 * Returns true if `spec` is a clean exact-version specifier
 * (`X.Y.Z` or `X.Y.Z-<prerelease>`). Carets, tildes, ranges, and
 * wildcards return false. Anything non-string returns false.
 *
 * Exported for unit tests.
 */
export function isExactPnVersion(spec) {
  return typeof spec === 'string' && EXACT_VERSION_RE.test(spec);
}

/**
 * Walks `dependencies`, `peerDependencies`, and `optionalDependencies`
 * on a package.json-shaped object and returns the list of
 * `(field, name, spec)` triples where the `@internal/*` entry is
 * not pinned to an exact version. Specs already flagged by
 * {@link isLeak} are skipped — those are reported by the leak rule
 * to avoid double-attribution noise. Pure / side-effect-free.
 *
 * @param {Record<string, unknown>} pkgJson
 * @returns {Array<{ field: string; name: string; spec: string }>}
 */
export function findPnPinViolations(pkgJson) {
  const violations = [];
  for (const field of SHIPPED_DEP_FIELDS) {
    const deps = pkgJson[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (!name.startsWith('@internal/')) continue;
      if (typeof spec !== 'string') continue;
      if (isLeak(spec)) continue; // reported by the leak rule
      if (!isExactPnVersion(spec)) {
        violations.push({ field, name, spec });
      }
    }
  }
  return violations;
}

/**
 * Every published package this repository names that `pkgJson` holds under
 * `dependencies` or `optionalDependencies`. Each must be a peer dependency
 * instead, so the application's own list is the only place a copy comes from
 * (ADR 329). Pure / side-effect-free.
 *
 * @param {Record<string, unknown>} pkgJson
 * @param {ReadonlySet<string>} siblings the names of the packages this repository publishes
 * @returns {Array<{ field: string; name: string; spec: string }>}
 */
export function findSiblingDependencies(pkgJson, siblings) {
  const violations = [];
  for (const field of ['dependencies', 'optionalDependencies']) {
    const deps = pkgJson[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (siblings.has(name)) violations.push({ field, name, spec: String(spec) });
    }
  }
  return violations;
}

const DECLARATION_FILE_RE = /\.d\.(?:m|c)?ts$/;

const NODE_BUILTINS = new Set(builtinModules);

// Stands for the tarball root in the entry-root set. A package whose entry
// point has no directory component (`"types": "./index.d.ts"`) publishes from
// the root itself; without an explicit marker its roots come out empty and
// every declaration in the tarball goes unchecked.
const PACKAGE_ROOT = '.';

/**
 * Every module specifier a declaration file names — imports, re-exports,
 * `import(...)` types, and `/// <reference types="..." />` directives.
 *
 * Uses TypeScript's own file preprocessor rather than a regex so prose
 * inside doc comments (`... e.g. pg-pool's 'release' event`) is never
 * mistaken for an import.
 *
 * @param {string} declarationText
 * @returns {string[]}
 */
export function moduleSpecifiersIn(declarationText) {
  const info = ts.preProcessFile(declarationText, true, false);
  return [
    ...info.importedFiles.map((f) => f.fileName),
    ...info.typeReferenceDirectives.map((f) => f.fileName),
  ];
}

/**
 * The npm package a module specifier belongs to, or `null` when the
 * specifier does not name one: relative and absolute paths, `#private`
 * subpath imports, and Node builtins (bare or `node:`-prefixed).
 *
 * Pure / side-effect-free; exported for tests.
 *
 * @param {string} spec
 * @returns {string | null}
 */
export function packageNameFromSpecifier(spec) {
  if (spec === '' || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#')) {
    return null;
  }
  if (spec.startsWith('node:')) return null;
  const segments = spec.split('/');
  const name = spec.startsWith('@') ? `${segments[0]}/${segments[1]}` : segments[0];
  if (!name || NODE_BUILTINS.has(name)) return null;
  return name;
}

/**
 * The DefinitelyTyped companion package name for `name`, using npm's
 * scope-mangling convention (`@scope/pkg` → `@types/scope__pkg`).
 *
 * @param {string} name
 * @returns {string}
 */
export function typesPackageFor(name) {
  return name.startsWith('@') ? `@types/${name.slice(1).replace('/', '__')}` : `@types/${name}`;
}

/**
 * The top-level directories a package's published entry points live in —
 * every `exports` target plus `types`/`typings`/`main`/`module`. An entry with
 * no directory component (`"types": "./index.d.ts"`) yields
 * {@link PACKAGE_ROOT}, so a package that publishes from the tarball root is
 * checked rather than silently skipped.
 *
 * A tarball also ships `src/` so declaration maps can resolve to sources,
 * but nothing in a consumer's module graph reaches those files: no entry
 * point names them and no emitted `dist` declaration imports them. Scoping
 * the declaration-dependency rule to the entry-point tree keeps it on the
 * files a consumer's compiler can actually load.
 *
 * Pure / side-effect-free; exported for tests.
 *
 * @param {Record<string, unknown>} pkgJson
 * @returns {Set<string>}
 */
export function publishedEntryRoots(pkgJson) {
  const targets = [];
  const collect = (value) => {
    if (typeof value === 'string') targets.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(pkgJson.exports);
  for (const field of ['types', 'typings', 'main', 'module']) {
    if (typeof pkgJson[field] === 'string') targets.push(pkgJson[field]);
  }

  const roots = new Set();
  for (const target of targets) {
    const normalized = target.replace(/^\.\//, '');
    if (normalized === '') continue;
    const slash = normalized.indexOf('/');
    if (slash !== -1) {
      roots.add(normalized.slice(0, slash));
      continue;
    }
    // No directory component, so the entry sits at the tarball root. The
    // manifest self-reference is not a code entry and does not put the root
    // in scope on its own.
    if (normalized === 'package.json') continue;
    roots.add(PACKAGE_ROOT);
  }
  return roots;
}

/**
 * The tarball-relative directory a declaration file lives in, using
 * {@link PACKAGE_ROOT} for a file with no directory component so it can be
 * compared against {@link publishedEntryRoots}.
 *
 * @param {string} file
 * @returns {string}
 */
function declarationRoot(file) {
  const slash = file.indexOf('/');
  return slash === -1 ? PACKAGE_ROOT : file.slice(0, slash);
}

/**
 * Classifies a packed package's declaration files against the rule that a
 * consumer must be able to resolve everything they name.
 *
 * Returns one violation per (file, specifier) pair:
 *   - `undeclared` — the package is in no consumer-installed dep field.
 *   - `untyped`    — the package is declared but ships no types of its own
 *                    and its `@types/*` companion is not declared.
 *
 * Pure / side-effect-free: `declarations` supplies the packed declaration
 * text and `shipsOwnTypes` answers whether a dependency carries its own
 * types (returning `null` when that cannot be determined, which skips the
 * `untyped` rule rather than guessing).
 *
 * @param {object} args
 * @param {Record<string, unknown>} args.pkgJson
 * @param {Map<string, string>} args.declarations tarball-relative path → file text
 * @param {(depName: string) => boolean | null} args.shipsOwnTypes
 * @returns {Array<{ file: string; spec: string; kind: 'undeclared' | 'untyped'; needs: string }>}
 */
export function findDeclarationDepViolations({ pkgJson, declarations, shipsOwnTypes }) {
  const shipped = new Set(
    SHIPPED_DEP_FIELDS.flatMap((field) => {
      const deps = pkgJson[field];
      return deps && typeof deps === 'object' ? Object.keys(deps) : [];
    }),
  );
  const entryRoots = publishedEntryRoots(pkgJson);
  const violations = [];
  const seen = new Set();

  for (const [file, text] of declarations) {
    if (!entryRoots.has(declarationRoot(file))) continue;
    for (const spec of moduleSpecifiersIn(text)) {
      const name = packageNameFromSpecifier(spec);
      // A package may reference itself through its own `exports` map.
      if (name === null || name === pkgJson.name) continue;

      const key = `${file} ${name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (!shipped.has(name)) {
        violations.push({ file, spec: name, kind: 'undeclared', needs: name });
        continue;
      }
      const typesPkg = typesPackageFor(name);
      if (shipsOwnTypes(name) === false && !shipped.has(typesPkg)) {
        violations.push({ file, spec: name, kind: 'untyped', needs: typesPkg });
      }
    }
  }
  return violations;
}

/**
 * Extracts a tarball's declaration files into `scratchDir` and returns
 * their tarball-relative paths mapped to their contents.
 *
 * @param {string} tgzPath
 * @param {string} scratchDir
 * @returns {Map<string, string>}
 */
function readPackedDeclarations(tgzPath, scratchDir) {
  const entries = execFileSync('tar', ['-tzf', tgzPath], { encoding: 'utf-8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => DECLARATION_FILE_RE.test(line));
  const out = new Map();
  if (entries.length === 0) return out;
  mkdirSync(scratchDir, { recursive: true });
  execFileSync('tar', ['-xzf', tgzPath, '-C', scratchDir, ...entries]);
  for (const entry of entries) {
    out.set(entry.replace(/^package\//, ''), readFileSync(join(scratchDir, entry), 'utf-8'));
  }
  return out;
}

/**
 * Whether `depName`, resolved the way a Node/TypeScript consumer would
 * resolve it from `fromDir`, ships declaration files of its own. Returns
 * `null` when the dependency cannot be found, so callers can skip rather
 * than guess.
 *
 * @param {string} fromDir
 * @param {string} depName
 * @returns {boolean | null}
 */
function dependencyShipsOwnTypes(fromDir, depName) {
  for (let dir = fromDir, previous = ''; dir !== previous; previous = dir, dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', depName);
    if (existsSync(candidate)) return containsDeclarationFile(candidate);
  }
  return null;
}

function containsDeclarationFile(dir, depth = 0) {
  if (depth > 4) return false;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    if (entry.isDirectory()) {
      if (containsDeclarationFile(join(dir, entry.name), depth + 1)) return true;
    } else if (DECLARATION_FILE_RE.test(entry.name)) {
      return true;
    }
  }
  return false;
}

function readPackedManifest(tgzPath) {
  const out = execFileSync('tar', ['-xzOf', tgzPath, 'package/package.json'], {
    encoding: 'utf-8',
  });
  return JSON.parse(out);
}

function listPublishablePackageDirs() {
  const out = execFileSync('node', ['scripts/list-publishable-packages.mjs'], {
    encoding: 'utf-8',
  });
  return out
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.replace(/^\.\//, ''));
}

/**
 * Packs every workspace package into `destDir`. Returns 0 on success and
 * a non-zero exit code on failure so the caller can release any temp
 * resources (notably the tmpdir used as `destDir`) before exiting.
 *
 * @param {string} destDir
 * @returns {number}
 */
export function packAll(destDir) {
  // Pack every workspace package in one shot. We over-pack (private
  // packages get tarballs too) but that's cheap and lets us avoid the
  // per-package invocation overhead. The gate filters down to publishables
  // when reading.
  const result = spawnSync(
    'pnpm',
    ['-r', '--workspace-concurrency=8', 'pack', '--pack-destination', destDir],
    {
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
  if (result.status !== 0) {
    process.stderr.write(`\npnpm -r pack failed with exit code ${result.status}\n`);
    return result.status ?? 1;
  }
  return 0;
}

function tarballNameFor(pkgName, version) {
  // Mirrors pnpm pack's default naming: `<name>-<version>.tgz` with the
  // package's `/` rewritten to `-` and the leading scope `@` dropped.
  // (e.g. `@internal/foo@1.2.3` → `internal-foo-1.2.3.tgz`).
  return `${pkgName.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`;
}

const DEFAULT_IO = {
  packAll,
  listPublishablePackageDirs,
  readPackedManifest,
  readPackedDeclarations,
  dependencyShipsOwnTypes,
  readPackageJson: (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')),
  readdirSync,
  mkdtemp: () => mkdtempSync(join(tmpdir(), 'pn-publish-check-')),
  rm: (path) => rmSync(path, { recursive: true, force: true }),
  stdoutWrite: (s) => process.stdout.write(s),
  stderrWrite: (s) => process.stderr.write(s),
};

/**
 * Runs the publish-deps gate. Pure with respect to its `io` seam — the
 * default uses `pnpm pack`, the workspace fs, and `process.{stdout,stderr}`,
 * but tests can stub each leg to exercise the failure-path cleanup
 * without packing real tarballs.
 *
 * Always returns a numeric exit code; the caller is responsible for the
 * single `process.exit(...)` so finally-blocks (here, tmpdir cleanup)
 * always run.
 *
 * @param {object} [options]
 * @param {string[]} [options.argv]
 * @param {Partial<typeof DEFAULT_IO>} [options.io]
 * @returns {number}
 */
export function runCheck({ argv = process.argv.slice(2), io = {} } = {}) {
  const {
    packAll: pack,
    listPublishablePackageDirs: listDirs,
    readPackedManifest: readPacked,
    readPackedDeclarations: readDeclarations,
    dependencyShipsOwnTypes: shipsOwnTypesFrom,
    readPackageJson,
    readdirSync: readDir,
    mkdtemp,
    rm,
    stdoutWrite,
    stderrWrite,
  } = { ...DEFAULT_IO, ...io };
  const args = new Set(argv);
  const json = args.has('--json');

  const dirs = listDirs();
  const dest = mkdtemp();

  try {
    stderrWrite(
      `Packing ${dirs.length} publishable packages (and any private workspace siblings) → ${dest}\n`,
    );
    const packExitCode = pack(dest);
    if (packExitCode !== 0) {
      return packExitCode;
    }

    const tarballs = new Set(readDir(dest).filter((f) => f.endsWith('.tgz')));
    const siblings = new Set(dirs.map((dir) => readPackageJson(dir).name));
    /**
     * @type {Array<{
     *   pkg: string;
     *   tarball: string;
     *   leaks: ReturnType<typeof findLeaks>;
     *   pnPinViolations: ReturnType<typeof findPnPinViolations>;
     *   declarationDepViolations: ReturnType<typeof findDeclarationDepViolations>;
     *   siblingDependencies: ReturnType<typeof findSiblingDependencies>;
     * }>}
     */
    const offenders = [];

    for (const dir of dirs) {
      const sourcePkg = readPackageJson(dir);
      const tarballName = tarballNameFor(sourcePkg.name, sourcePkg.version);
      if (!tarballs.has(tarballName)) {
        stderrWrite(`warn: tarball not found for ${sourcePkg.name} (${tarballName})\n`);
        continue;
      }
      const packed = readPacked(join(dest, tarballName));
      const leaks = findLeaks(packed);
      const pnPinViolations = findPnPinViolations(packed);
      const declarationDepViolations = findDeclarationDepViolations({
        pkgJson: packed,
        declarations: readDeclarations(
          join(dest, tarballName),
          join(dest, 'unpacked', tarballName),
        ),
        shipsOwnTypes: (depName) => shipsOwnTypesFrom(dir, depName),
      });
      const siblingDependencies = findSiblingDependencies(packed, siblings);
      if (
        leaks.length > 0 ||
        pnPinViolations.length > 0 ||
        declarationDepViolations.length > 0 ||
        siblingDependencies.length > 0
      ) {
        offenders.push({
          pkg: sourcePkg.name,
          tarball: tarballName,
          leaks,
          pnPinViolations,
          declarationDepViolations,
          siblingDependencies,
        });
      }
    }

    if (json) {
      stdoutWrite(`${JSON.stringify({ ok: offenders.length === 0, offenders }, null, 2)}\n`);
    } else if (offenders.length === 0) {
      stderrWrite(
        '\nOK — no workspace:/catalog: leaks, no @internal/* pin violations, no undeclared\n' +
          `     declaration dependencies and no sibling dependencies in ${dirs.length} publishable packages.\n`,
      );
    } else {
      stderrWrite(
        `\nFAIL — ${offenders.length} publishable package(s) have publish-time violations:\n`,
      );
      for (const o of offenders) {
        stderrWrite(`\n  ${o.pkg}\n`);
        for (const l of o.leaks) {
          stderrWrite(`    [leak]     ${l.field}.${l.name} = ${l.spec}\n`);
        }
        for (const v of o.pnPinViolations) {
          stderrWrite(`    [pin]      ${v.field}.${v.name} = ${v.spec}\n`);
        }
        for (const v of o.declarationDepViolations) {
          stderrWrite(`    [decl]     ${v.file} names "${v.spec}" — declare "${v.needs}"\n`);
        }
        for (const v of o.siblingDependencies) {
          stderrWrite(`    [sibling]  ${v.field}.${v.name} = ${v.spec}\n`);
        }
      }
      stderrWrite(
        '\n  [leak] specs are pnpm-internal (workspace:/catalog:) and break consumer installs.\n' +
          '         Publish via `pnpm publish` (which rewrites them) rather than `npm publish`,\n' +
          '         or convert the dependency to a real version range.\n' +
          '  [pin]  every @internal/* entry in dependencies/peer/optional must be a single\n' +
          '         exact version `X.Y.Z` (a pre-release suffix is permitted). Carets, tildes,\n' +
          '         ranges, and wildcards are rejected so consumer installs see the exact\n' +
          '         @internal/* graph this release validated against.\n' +
          '  [decl] a shipped declaration names a module the consumer cannot resolve. Move the\n' +
          '         dependency (and any `@types/*` companion) out of devDependencies into\n' +
          '         dependencies or peerDependencies. devDependencies are bundled into the\n' +
          '         emitted .d.mts rather than imported from, so a missing one usually shows\n' +
          '         up as inlined types plus a bare side-effect import.\n' +
          '  [sibling] another package this repository publishes must be a peer dependency, never\n' +
          '         an ordinary or optional one, so the application lists the one copy (ADR 329).\n',
      );
    }

    return offenders.length === 0 ? 0 : 1;
  } finally {
    rm(dest);
  }
}

export function main() {
  return runCheck();
}

// Only run `main` when invoked directly. Importing the module from a unit
// test (or any other tool) gets you the pure helpers (`findLeaks`,
// `isLeak`) without packing every workspace tarball.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
