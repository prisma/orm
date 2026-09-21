#!/usr/bin/env node
/**
 * Enumerate every published error code (ADR 239 dotted `NAMESPACE.SUBCODE`)
 * defined in production source, for the docs error-reference page at
 * https://docs.prisma.io/docs/orm/next/reference/error-reference.
 *
 * Modes:
 *   node scripts/list-error-codes.mjs                       # JSON to stdout
 *   node scripts/list-error-codes.mjs --format markdown     # reference skeleton
 *   node scripts/list-error-codes.mjs --verify <page.md>    # exit 1 + list any
 *                                                           # known code missing
 *                                                           # from the given file
 *   --root <dir>   repo root to scan (default: this script's parent repo);
 *                  lets the docs-site repo run it against a checkout of this repository.
 *
 * Codes are string literals whose namespace is on the ADR 239 closed list.
 * Scanned: git-tracked .ts files under each package's src tree (production
 * source only — tests assert codes, they don't define them).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { argv, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const NAMESPACES = [
  'CONFIG',
  'CLI',
  'CONTRACT',
  'PSL',
  'PLAN',
  'RUNTIME',
  'ORM',
  'DRIVER',
  'BUDGET',
  'LINT',
  'MIGRATION',
  'SUPABASE',
  'POSTGIS',
  'PGVECTOR',
  'PARADEDB',
  'TESTKIT',
];

const CODE_RE = new RegExp(`'((?:${NAMESPACES.join('|')})\\.[A-Z][A-Z0-9_]*)'`, 'g');

export function extractCodes(root) {
  const files = execFileSync('git', ['ls-files', 'packages/**/*.ts'], {
    cwd: root,
    encoding: 'utf-8',
  })
    .split('\n')
    .filter((f) => f.includes('/src/') && !/\.(test|test-d)\.ts$/.test(f) && !f.includes('/test/'));

  const codes = new Map();
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf-8');
    for (const match of text.matchAll(CODE_RE)) {
      const code = match[1];
      if (!codes.has(code)) codes.set(code, new Set());
      codes.get(code).add(file);
    }
  }
  return [...codes.entries()]
    .map(([code, fileSet]) => ({
      code,
      namespace: code.split('.')[0],
      files: [...fileSet].sort(),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function toMarkdown(entries) {
  const lines = ['# Error reference', ''];
  let current = '';
  for (const entry of entries) {
    if (entry.namespace !== current) {
      current = entry.namespace;
      lines.push(`## ${current}`, '');
    }
    lines.push(`### ${entry.code}`, '');
  }
  return lines.join('\n');
}

export function verify(entries, pageText) {
  return entries.filter((e) => !pageText.includes(e.code)).map((e) => e.code);
}

function main() {
  const args = argv.slice(2);
  const readFlag = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };

  const root = readFlag('--root') ?? join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const entries = extractCodes(root);

  const verifyPath = readFlag('--verify');
  if (verifyPath !== undefined) {
    const missing = verify(entries, readFileSync(verifyPath, 'utf-8'));
    if (missing.length > 0) {
      stderr.write(
        `error-reference is missing ${missing.length} of ${entries.length} known codes:\n`,
      );
      for (const code of missing) stderr.write(`  ${code}\n`);
      exit(1);
    }
    stdout.write(`error-reference lists all ${entries.length} known codes.\n`);
    return;
  }

  const format = readFlag('--format') ?? 'json';
  stdout.write(
    format === 'markdown' ? `${toMarkdown(entries)}\n` : `${JSON.stringify(entries, null, 2)}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
