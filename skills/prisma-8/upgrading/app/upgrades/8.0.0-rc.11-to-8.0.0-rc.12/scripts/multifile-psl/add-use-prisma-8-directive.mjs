#!/usr/bin/env node
/**
 * Adds `// use prisma-8` as the first line of every PSL schema file that
 * lacks it, matching the directive `isPrismaNextSchema` checks for
 * (`@internal/psl-parser`). A file that already carries the directive (or
 * its legacy `// use prisma-next` spelling) is left untouched.
 *
 * Usage:
 *   node scripts/multifile-psl/add-use-prisma-8-directive.mjs <file-or-glob> [...more]
 *
 * Globs never descend into `node_modules` or `dist`.
 *
 * Every matched file is printed as `<file>: added directive` (or `already
 * present`) for review. Running it twice is a no-op.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { argv, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const DIRECTIVE = /^(\s*\/\/ *use +)(prisma-8|prisma-next)( *)(?!\S)/;

async function expand(patterns) {
  const files = [];
  for (const pattern of patterns) {
    for await (const match of glob(pattern, { exclude: ['**/node_modules/**', '**/dist/**'] })) {
      files.push(match);
    }
  }
  return files;
}

function addDirective(path) {
  const original = readFileSync(path, 'utf8');
  if (DIRECTIVE.test(original)) {
    stdout.write(`${path}: already present\n`);
    return;
  }
  writeFileSync(path, `// use prisma-8\n\n${original}`, 'utf8');
  stdout.write(`${path}: added directive\n`);
}

async function main() {
  const patterns = argv.slice(2);
  if (patterns.length === 0) {
    stderr.write('usage: add-use-prisma-8-directive.mjs <file-or-glob> [...more]\n');
    exit(1);
  }
  const files = await expand(patterns);
  if (files.length === 0) {
    stderr.write('no files matched\n');
    exit(1);
  }
  for (const file of files) addDirective(file);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
