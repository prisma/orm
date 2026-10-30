#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGETS_ROOT = join('packages', '3-targets');
/** The folder of code several targets share, which is no database; its packages depend on no target. */
const SHARED_FOLDER = '0-shared';
const NUMBERED_PACKAGE = /^(\d+)-[a-z][a-z0-9-]*$/;
const PRODUCTION_DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];
const MODULE_SPECIFIER = /\b(?:from|import)\s*\(?\s*(['"])([^'"\n]+)\1/g;
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts)$/;
const DECLARATION_FILE = /\.d\.[mc]?ts$/;

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function directories(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (SOURCE_FILE.test(entry.name) && !DECLARATION_FILE.test(entry.name)) yield full;
  }
}

export function targetPackages(baseDir = repoRoot) {
  const targetsDir = join(baseDir, TARGETS_ROOT);
  const databases = directories(targetsDir).filter((folder) => folder !== SHARED_FOLDER);
  return databases.flatMap((database) =>
    directories(join(targetsDir, database)).flatMap((folder) => {
      const numbered = NUMBERED_PACKAGE.exec(folder);
      const dir = join(targetsDir, database, folder);
      const manifestPath = join(dir, 'package.json');
      if (!numbered || !existsSync(manifestPath)) return [];
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      return [
        { name: manifest.name, database, folder, number: Number(numbered[1]), dir, manifest },
      ];
    }),
  );
}

function packageNamed(specifier, packagesByName) {
  for (const [name, pkg] of packagesByName)
    if (specifier === name || specifier.startsWith(`${name}/`)) return pkg;
  return undefined;
}

function manifestDependencies(pkg) {
  return PRODUCTION_DEPENDENCY_FIELDS.flatMap((field) =>
    Object.keys(pkg.manifest[field] ?? {}).map((specifier) => ({
      specifier,
      where: `package.json ${field}`,
    })),
  );
}

function sourceImports(pkg, baseDir) {
  const srcDir = join(pkg.dir, 'src');
  if (!existsSync(srcDir)) return [];
  return [...sourceFiles(srcDir)].flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(MODULE_SPECIFIER)].map(([, , specifier]) => ({
      specifier,
      where: relative(baseDir, file),
    })),
  );
}

export function siblingDependencies(baseDir = repoRoot) {
  const packages = targetPackages(baseDir);
  const packagesByName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  return packages.flatMap((pkg) =>
    [...manifestDependencies(pkg), ...sourceImports(pkg, baseDir)].flatMap(
      ({ specifier, where }) => {
        const dependency = packageNamed(specifier, packagesByName);
        return dependency === undefined || dependency === pkg
          ? []
          : [{ from: pkg, to: dependency, specifier, where }];
      },
    ),
  );
}

function violationReason({ from, to }) {
  if (from.database !== to.database)
    return `${from.database}/${from.folder} depends on ${to.database}/${to.folder}, a package of another database`;
  if (to.number >= from.number)
    return `${from.database}/${from.folder} depends on ${to.database}/${to.folder}, which is not numbered lower`;
  return undefined;
}

export function findLayeringViolations(baseDir = repoRoot) {
  return siblingDependencies(baseDir).flatMap((edge) => {
    const reason = violationReason(edge);
    return reason === undefined ? [] : [{ ...edge, reason }];
  });
}

export function main(baseDir = repoRoot) {
  const violations = findLayeringViolations(baseDir);
  if (violations.length === 0) {
    console.log(
      `Every package under ${TARGETS_ROOT}/<database>/ depends only on lower-numbered packages of its own database.`,
    );
    return 0;
  }
  console.error(`${violations.length} target layering violation(s):`);
  for (const { reason, specifier, where } of violations)
    console.error(`  ${reason}: ${specifier} (${where})`);
  console.error(
    `\nA package under ${TARGETS_ROOT}/<database>/ may depend only on packages of the same database with a lower number, so the target never reaches its adapter or driver, and no database reaches another.`,
  );
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv[2]));
}
