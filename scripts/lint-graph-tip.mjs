#!/usr/bin/env node
/**
 * The migration graph has no privileged node, and the code that once looked
 * for one does not come back.
 *
 * Every command resolves its origin and destination from a ref, the emitted
 * head, the live marker, or an explicit flag. `findLeaf` walked the graph from
 * the empty hash to a single tip and threw `MIGRATION.AMBIGUOUS_TARGET`,
 * `MIGRATION.NO_TARGET` or `MIGRATION.NO_INITIAL_MIGRATION` when it could not
 * find one; `findLatestMigration` wrapped it. Both were removed, together with
 * the three codes, because a forked graph is a normal state and these helpers
 * turned it into an error at every site that called them for a hint.
 *
 * This check keeps the names out of `packages/`, `docs/` and `skills/`. ADRs
 * and release notes are dated records and may still mention them.
 *
 * Exit codes:
 *   0 — no disallowed occurrence
 *   1 — at least one, named by file and line
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GIT_ROOT = process.cwd();

export const RETIRED_NAMES = [
  'MIGRATION.AMBIGUOUS_TARGET',
  'MIGRATION.NO_TARGET',
  'MIGRATION.NO_INITIAL_MIGRATION',
  'findLeaf',
  'findLatestMigration',
];

const SCANNED_ROOTS = /^(packages|docs|skills)\//;
const DATED_RECORDS = /^(docs\/architecture docs\/adrs\/|docs\/releases\/)/;
const SKIP_PATH = /(^|\/)(node_modules|dist|dist-tsc|dist-tsc-prod|coverage|\.turbo)\//;
const BINARY = /\.(png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|pdf|zip|tgz|wasm)$/i;

export function trackedFiles(scanDir) {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: scanDir,
    encoding: 'utf-8',
    stdio: 'pipe',
    maxBuffer: 256 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
    .filter(
      (relPath) =>
        SCANNED_ROOTS.test(relPath) &&
        !DATED_RECORDS.test(relPath) &&
        !SKIP_PATH.test(relPath) &&
        !BINARY.test(relPath),
    );
}

export function findViolations(scanDir, files = trackedFiles(scanDir)) {
  const violations = [];
  for (const relPath of files) {
    let content;
    try {
      content = readFileSync(join(scanDir, relPath), 'utf-8');
    } catch {
      continue;
    }
    if (!RETIRED_NAMES.some((name) => content.includes(name))) continue;
    content.split('\n').forEach((line, index) => {
      const name = RETIRED_NAMES.find((candidate) => line.includes(candidate));
      if (name === undefined) return;
      violations.push({ file: relPath, line: index + 1, name, text: line.trim() });
    });
  }
  return violations;
}

export function main(scanDir = GIT_ROOT) {
  const violations = findViolations(scanDir);
  if (violations.length === 0) {
    console.log('No reference to the removed graph-tip helpers or their error codes.');
    return 0;
  }

  console.error(`${violations.length} reference(s) to the removed graph-tip concept:\n`);
  for (const violation of violations.slice(0, 40)) {
    console.error(
      `  ${violation.file}:${violation.line}: ${violation.name} — ${violation.text.slice(0, 120)}`,
    );
  }
  if (violations.length > 40) console.error(`  … and ${violations.length - 40} more`);
  console.error(
    '\nThe migration graph has no privileged tip. Resolve origins and destinations\n' +
      'from a ref, the emitted head, the live marker, or an explicit flag; do not\n' +
      'reintroduce a walk to a single leaf or the error codes it raised.\n',
  );
  return 1;
}

if (process.argv[1] === import.meta.filename) process.exit(main());
