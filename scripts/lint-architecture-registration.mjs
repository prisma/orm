#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEPENDENCY_CRUISER_EXCLUDES, normalizeGlob } from './architecture-globs.mjs';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', '.turbo']);
const SOURCE_FOLDER = /(^|\/)src\//;

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function* walkFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) yield full;
  }
}

export function checkedSourceFiles(baseDir = repoRoot) {
  const excludes = DEPENDENCY_CRUISER_EXCLUDES.map((pattern) => new RegExp(pattern));
  return [...walkFiles(join(baseDir, 'packages'))]
    .map((file) => relative(baseDir, file).split(sep).join('/'))
    .filter((path) => SOURCE_FOLDER.test(path))
    .filter((path) => !excludes.some((exclude) => exclude.test(path)))
    .sort();
}

export function findRegistrationProblems(packageConfigs, files) {
  const globs = packageConfigs.map(({ glob }) => ({
    glob,
    pattern: new RegExp(normalizeGlob(glob)),
  }));
  const unregistered = [];
  const overlapping = [];
  for (const file of files) {
    const matching = globs.filter(({ pattern }) => pattern.test(file)).map(({ glob }) => glob);
    if (matching.length === 0) unregistered.push(file);
    else if (matching.length > 1) overlapping.push({ file, globs: matching });
  }
  return { unregistered, overlapping };
}

function readPackageConfigs(baseDir) {
  return JSON.parse(readFileSync(join(baseDir, 'architecture.config.json'), 'utf8')).packages;
}

export function main(baseDir = repoRoot) {
  const files = checkedSourceFiles(baseDir);
  const { unregistered, overlapping } = findRegistrationProblems(
    readPackageConfigs(baseDir),
    files,
  );
  if (unregistered.length === 0 && overlapping.length === 0) {
    console.log(
      `Each of the ${files.length} package source files matches exactly one glob in architecture.config.json.`,
    );
    return 0;
  }
  if (unregistered.length > 0) {
    console.error(
      `${unregistered.length} source file(s) match no glob in architecture.config.json:`,
    );
    for (const file of unregistered) console.error(`  ${file}`);
  }
  if (overlapping.length > 0) {
    console.error(
      `${overlapping.length} source file(s) match more than one glob in architecture.config.json:`,
    );
    for (const { file, globs } of overlapping) console.error(`  ${file}: ${globs.join(', ')}`);
  }
  console.error(
    '\npnpm lint:deps checks a file only against the group its glob gives it. A file that matches no glob is never checked, and a file that matches several is checked as all of them. Register each file with exactly one glob that names its domain, layer and plane.',
  );
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv[2]));
}
