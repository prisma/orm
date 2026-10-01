#!/usr/bin/env node
/**
 * Every consumer package names one import root, never both.
 *
 * A published shell (`@prisma/orm-*`) bundles a copy of each internal package
 * it carries, so a module reached through a shell and the same module reached
 * through its `@internal/*` workspace name are two objects. A package that
 * names both roots therefore runs two copies of everything they share: two
 * registries, two sets of classes, two of every value compared by reference.
 * See `packages/9-public/@prisma/orm-framework/test/module-identity.test.ts`
 * for the demonstration.
 *
 * The failure is silent. Both copies type-check, both behave identically in
 * isolation, and the divergence shows up only as an `instanceof` that stops
 * holding or a lookup that stops finding — which is why this is a lint and
 * not something left to review.
 *
 * Scope is the consumer trees: `examples/`, `apps/` and `test/`. Packages
 * under `packages/` are the substrate the shells are built from and name
 * workspace packages by construction; the shells' own tests legitimately name
 * both, and are excluded with them. The packaging suites under
 * `test/integration/test/packaging/` are exempt for the same reason: their
 * published-root specifiers are strings handed to scratch projects that
 * install packed tarballs and run in a child process, so both roots never
 * load into one module graph.
 *
 * Exits 1 listing every mixed package; exits 0 otherwise.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONSUMER_ROOTS = ['examples', 'apps', 'test'];
const EXEMPT_SUBTREES = ['test/integration/test/packaging'];
const INTERNAL_SCOPE = '@internal/';
const PUBLISHED_SCOPE = '@prisma/orm-';
const INCLUDED_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'dist-tsc',
  'dist-tsc-prod',
  'coverage',
  '.tmp-output',
  '.next',
  '.turbo',
  'build',
]);

/** Every form generated and hand-written code uses to name a module. */
const MODULE_SPECIFIER = /\b(?:from|import)\s*\(?\s*(['"])([^'"\n]+)\1/g;

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

// The directory listing already reports each entry's kind, so nothing here
// stats a path separately. A separate stat would throw on a dangling symlink
// or on a file deleted between the listing and the stat, and abort the whole
// lint over one entry it was never going to read.
function* walkFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile() && INCLUDED_EXTENSIONS.has(extname(full))) yield full;
  }
}

/**
 * Consumer package directories: any directory under a consumer root that has
 * a `package.json`. Nested ones count separately — the CLI test-app fixtures
 * install their own dependencies and resolve independently of their parent.
 */
function* walkPackages(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.some((entry) => entry.name === 'package.json')) yield dir;
  for (const entry of entries) {
    if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    if (entry.isDirectory()) yield* walkPackages(join(dir, entry.name));
  }
}

/** Files belonging to `pkg` itself: those under no nearer package directory. */
function ownFiles(pkg, allPackages) {
  // `sep`, not `/`: every path here comes from `join`, so on Windows a
  // hardcoded `/` would match nothing and every nested package's files would
  // be attributed to its parent as well.
  const nested = allPackages.filter((other) => other !== pkg && other.startsWith(pkg + sep));
  return [...walkFiles(pkg)].filter((file) => !nested.some((dir) => file.startsWith(dir + sep)));
}

/**
 * Consumer packages naming both roots, each with one example specifier per
 * root and how many more there are. Takes the roots as an argument so the
 * check is reachable from a test with a fixture tree of its own.
 */
export function findMixedPackages(baseDir, roots = CONSUMER_ROOTS, exempt = EXEMPT_SUBTREES) {
  const packages = roots.flatMap((root) => [...walkPackages(join(baseDir, root))]);
  const exemptPrefixes = exempt.map((subtree) => join(baseDir, subtree) + sep);
  const mixed = [];
  for (const pkg of packages) {
    const internal = new Map();
    const published = new Map();
    const files = ownFiles(pkg, packages).filter(
      (file) => !exemptPrefixes.some((prefix) => file.startsWith(prefix)),
    );
    for (const file of files) {
      for (const [, , specifier] of readFileSync(file, 'utf8').matchAll(MODULE_SPECIFIER)) {
        const seen = specifier.startsWith(INTERNAL_SCOPE)
          ? internal
          : specifier.startsWith(PUBLISHED_SCOPE)
            ? published
            : undefined;
        if (seen !== undefined && !seen.has(specifier))
          seen.set(specifier, relative(baseDir, file));
      }
    }
    if (internal.size > 0 && published.size > 0) {
      mixed.push({ pkg: relative(baseDir, pkg), internal, published });
    }
  }
  return mixed;
}

/**
 * Checks the tree at `baseDir`, defaulting to this repository. The argument
 * exists for the same reason `findMixedPackages` takes its roots: so a test
 * can run the check the way CI runs it — through this entry point, exit code
 * and message included — against a tree it built itself.
 */
export function main(baseDir = repoRoot) {
  const mixed = findMixedPackages(baseDir);
  if (mixed.length === 0) {
    console.log(`No consumer package under ${CONSUMER_ROOTS.join(', ')} names both import roots.`);
    return 0;
  }

  console.error(`${mixed.length} consumer package(s) name both import roots:`);
  for (const entry of mixed) {
    console.error(`\n  ${entry.pkg}`);
    for (const [scope, seen] of [
      ['internal', entry.internal],
      ['published', entry.published],
    ]) {
      const [specifier, file] = [...seen][0];
      console.error(
        `    ${scope}: ${specifier} (${file})` +
          (seen.size > 1 ? ` and ${seen.size - 1} more` : ''),
      );
    }
  }
  console.error(
    '\nA published shell bundles its own copy of each internal package, so naming\n' +
      'both roots loads two copies of every module they share. Move the package to\n' +
      'one root; if the published surface has no name for something it needs, that\n' +
      'is a gap in the surface (ADR 242), not a reason to keep the workspace name.',
  );
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv[2]));
}
