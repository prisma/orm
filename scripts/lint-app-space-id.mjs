#!/usr/bin/env node
/**
 * Regression guardrail for the `APP_SPACE_ID` canonical-source rule
 * (project: extension contract spaces, code-review F3).
 *
 * Two policed invariants:
 *
 *   1. **Single source of truth.** `export const APP_SPACE_ID = ...`
 *      may appear at exactly one path under `packages/` — the canonical
 *      home in `@internal/framework-components/control`. Re-exports
 *      (`export { APP_SPACE_ID } from '...'`) are allowed and
 *      encouraged: they preserve the existing module surface for
 *      consumers of `migration-tools`, `sql-runtime`, the postgres /
 *      sqlite target packages, etc., without re-declaring the literal.
 *
 *   2. **No raw `'app'` / `"app"` string literals** as space identifiers
 *      inside `packages/2-sql-family/**` / `packages/3-targets/**` source
 *      files. Use `APP_SPACE_ID` (or template-string interpolation
 *      `${APP_SPACE_ID}` inside SQL templates) instead. Test files are
 *      out of scope — the literal `'app'` is often the test data.
 *      JSDoc comment lines are also out of scope: they're prose, not
 *      runtime values, and frequently document the literal.
 *
 * Exits with code 1 and prints offending locations if any violations
 * are found; exits with code 0 otherwise.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const CANONICAL_FILE = join(
  'packages',
  '1-framework',
  '1-core',
  'framework-components',
  'src',
  'control',
  'control-spaces.ts',
);

const SCAN_ROOTS_FOR_DECLARATIONS = [join(repoRoot, 'packages')];
const SCAN_ROOTS_FOR_LITERALS = [
  join(repoRoot, 'packages', '2-sql-family'),
  join(repoRoot, 'packages', '3-targets'),
];

const INCLUDED_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'dist-tsc',
  'dist-tsc-prod',
  'coverage',
  '.tmp-output',
  'test',
  'tests',
  '__tests__',
  'fixtures',
  'recordings',
  'templates',
]);

const DECLARATION_RE = /export\s+const\s+APP_SPACE_ID\b/;
const LITERAL_RE = /(['"])app\1/g;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIRECTORIES.has(entry)) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      yield* walk(full);
    } else if (stats.isFile() && INCLUDED_EXTENSIONS.has(extname(full))) {
      yield full;
    }
  }
}

const declarationMatches = [];
for (const root of SCAN_ROOTS_FOR_DECLARATIONS) {
  for (const file of walk(root)) {
    const contents = readFileSync(file, 'utf8');
    if (!DECLARATION_RE.test(contents)) continue;
    declarationMatches.push(relative(repoRoot, file));
  }
}

const expectedDeclaration = relative('.', CANONICAL_FILE);
const unexpectedDeclarations = declarationMatches.filter((m) => m !== expectedDeclaration);
const missingCanonical = !declarationMatches.includes(expectedDeclaration);

const literalViolations = [];
for (const root of SCAN_ROOTS_FOR_LITERALS) {
  for (const file of walk(root)) {
    const contents = readFileSync(file, 'utf8');
    if (!LITERAL_RE.test(contents)) continue;
    const lines = contents.split('\n');
    LITERAL_RE.lastIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      LITERAL_RE.lastIndex = 0;
      if (!LITERAL_RE.test(line)) continue;
      const trimmed = line.trimStart();
      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('/**') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*/') ||
        trimmed.startsWith('*')
      ) {
        continue;
      }
      literalViolations.push({
        file: relative(repoRoot, file),
        line: i + 1,
        text: line.trim(),
      });
    }
  }
}

let failed = false;

if (missingCanonical) {
  console.error(`Canonical APP_SPACE_ID declaration missing — expected at ${expectedDeclaration}.`);
  failed = true;
}

if (unexpectedDeclarations.length > 0) {
  console.error(
    `Found ${unexpectedDeclarations.length} unexpected APP_SPACE_ID declaration(s); only ${expectedDeclaration} is allowed:`,
  );
  for (const file of unexpectedDeclarations) {
    console.error(`  ${file}`);
  }
  failed = true;
}

if (literalViolations.length > 0) {
  console.error(
    `Found ${literalViolations.length} raw 'app'/"app" literal(s) under SQL / target source — use APP_SPACE_ID instead:`,
  );
  for (const v of literalViolations) {
    console.error(`  ${v.file}:${v.line}: ${v.text}`);
  }
  failed = true;
}

if (failed) {
  console.error(
    '\nSee `packages/1-framework/1-core/framework-components/src/control/control-spaces.ts` ' +
      'and project review F3 for context.',
  );
  process.exit(1);
}

console.log(
  `APP_SPACE_ID canonical-source check passed (declaration at ${expectedDeclaration}; no raw 'app' literals in scoped source trees).`,
);
