#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGETS_ROOT = join('packages', '3-targets');
/** The folder of code several targets share, which is no database; its packages depend on no target. */
const SHARED_FOLDER = '0-shared';
const NUMBERED_FOLDER = /^(\d+)-[a-z][a-z0-9-]*$/;
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

function* numberedPackages(dir, path) {
  for (const folder of directories(dir)) {
    if (!NUMBERED_FOLDER.test(folder)) continue;
    const folderDir = join(dir, folder);
    const folderPath = [...path, folder];
    const manifestPath = join(folderDir, 'package.json');
    if (!existsSync(manifestPath)) {
      yield* numberedPackages(folderDir, folderPath);
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    yield {
      name: manifest.name,
      path: folderPath,
      label: folderPath.join('/'),
      dir: folderDir,
      manifest,
    };
  }
}

export function targetPackages(baseDir = repoRoot) {
  const targetsDir = join(baseDir, TARGETS_ROOT);
  return directories(targetsDir)
    .filter((folder) => folder !== SHARED_FOLDER)
    .flatMap((database) => [...numberedPackages(join(targetsDir, database), [database])]);
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

function folderNumber(folder) {
  return Number(NUMBERED_FOLDER.exec(folder)[1]);
}

function violationReason({ from, to }) {
  const level = from.path.findIndex((folder, index) => folder !== to.path[index]);
  if (level === 0) return `${from.label} depends on ${to.label}, a package of another database`;
  if (folderNumber(to.path[level]) >= folderNumber(from.path[level]))
    return `${from.label} depends on ${to.label}, and ${to.path[level]} is not numbered lower than ${from.path[level]}`;
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
      `Every package under ${TARGETS_ROOT}/<database>/ depends only on packages of its own database in lower-numbered folders.`,
    );
    return 0;
  }
  console.error(`${violations.length} target layering violation(s):`);
  for (const { reason, specifier, where } of violations)
    console.error(`  ${reason}: ${specifier} (${where})`);
  console.error(
    `\nA package under ${TARGETS_ROOT}/<database>/ never depends on a package in a higher-numbered folder. Numbers compare only between folders in the same parent: at the first folder where the two paths differ, the dependency's folder must be numbered lower. No database depends on another.`,
  );
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv[2]));
}
