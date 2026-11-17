#!/usr/bin/env node
/**
 * Regression guardrail for TML-2536.
 *
 * The family `ContractSerializer` (`familyInstance.validateContract`) is
 * the single seam every on-disk contract read must cross. A cast
 * `JSON.parse(...) as Contract` (or `as Contract<…>`) bypasses that
 * seam silently — structural arktype validation, IR-class hydration, and
 * polymorphic-slot discriminator dispatch are all skipped. This script
 * fails the build when that cast pattern appears in package `src/`
 * trees outside the allowlist (test files + the serializer
 * implementation files themselves).
 *
 * See `.cursor/rules/as-contract-cast-smell.mdc` and
 * `.cursor/rules/contract-normalization-responsibilities.mdc` for the
 * rule prose and the replacement idiom
 * (`validateContract<Contract>(JSON.parse(raw) as unknown)`).
 *
 * Exits with code 1 and prints offending locations on any hit; exits
 * with code 0 otherwise.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const SCAN_ROOT = join(repoRoot, 'packages');

const INCLUDED_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo']);

// Files that are *allowed* to mention `as Contract`. These are either
// tests (where casting to a fixture type is fine), serializer
// implementation files (which *are* the seam — they validate before
// the cast), or files whose `as Contract` cast we have explicitly
// reviewed and accepted.
const ALLOWLISTED_PATH_FRAGMENTS = [
  // tests
  '.test.ts',
  '.test-d.ts',
  '/test/',
  '/tests/',
  // serializer implementation files (the seam itself)
  'packages/2-sql-family/9-family/src/core/ir/sql-contract-serializer-base.ts',
  'packages/2-sql-family/9-family/src/core/ir/sql-contract-serializer.ts',
  'packages/2-sql-family/9-family/src/core/control-instance.ts',
  'packages/3-targets/postgres/1-target/src/core/postgres-contract-serializer.ts',
  'packages/2-mongo-family/9-family/src/core/ir/mongo-contract-serializer.ts',
];

// Matches `as Contract` (and the generic form `as Contract<SqlStorage>`,
// since `<` is a non-word char), but NOT `as unknown as Contract` —
// the latter is the documented blind-cast escape hatch in
// `.cursor/rules/type-predicates.mdc`. The negative lookbehind on
// `unknown\s+as\s+` is what filters the documented form.
const SMELL_REGEX = /(?<!\bunknown\s+)\bas\s+Contract\b/g;

/**
 * Replaces comments (line + block) and string literals with whitespace
 * of equal length so that comment / docstring mentions of `as Contract`
 * (e.g. in a JSDoc rationale block) do not register as production-code
 * hits, while still preserving line + column offsets so reported
 * coordinates point at the real source location.
 */
function blankCommentsAndStrings(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = i + 1 < n ? source[i + 1] : '';
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(source[i] === '*' && i + 1 < n && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ' ';
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < n) {
          out += source[i] === '\n' ? '\n' : ' ';
          out += source[i + 1] === '\n' ? '\n' : ' ';
          i += 2;
          continue;
        }
        if (quote === '`' && source[i] === '$' && i + 1 < n && source[i + 1] === '{') {
          let depth = 1;
          out += '  ';
          i += 2;
          while (i < n && depth > 0) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') depth--;
            if (depth > 0) {
              out += source[i] === '\n' ? '\n' : ' ';
              i++;
            }
          }
          if (i < n) {
            out += ' ';
            i++;
          }
          continue;
        }
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        out += ' ';
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function isAllowlisted(relPath) {
  const normalised = relPath.split('\\').join('/');
  return ALLOWLISTED_PATH_FRAGMENTS.some((fragment) => normalised.includes(fragment));
}

function shouldDescend(name) {
  if (name.startsWith('.')) return false;
  if (EXCLUDED_DIRS.has(name)) return false;
  return true;
}

function walk(dir, hits) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!shouldDescend(entry)) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      walk(full, hits);
      continue;
    }
    if (!INCLUDED_EXTENSIONS.has(extname(full))) continue;
    const rel = relative(repoRoot, full);
    // Only scan files under `src/` of any package — the rule is
    // explicit about production code, not test-utils or test
    // fixtures even when those live outside `/test/` directories.
    if (!rel.split('\\').join('/').includes('/src/')) continue;
    if (isAllowlisted(rel)) continue;
    const text = readFileSync(full, 'utf-8');
    const stripped = blankCommentsAndStrings(text);
    SMELL_REGEX.lastIndex = 0;
    let match;
    // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic exec loop
    while ((match = SMELL_REGEX.exec(stripped)) !== null) {
      const upto = text.slice(0, match.index);
      const line = upto.split('\n').length;
      const col = match.index - upto.lastIndexOf('\n');
      hits.push({ file: rel, line, col, snippet: match[0] });
    }
  }
}

const hits = [];
walk(SCAN_ROOT, hits);

if (hits.length === 0) {
  console.log('lint:no-contract-cast — clean (no `as Contract` casts outside allowlist)');
  process.exit(0);
}

console.error(`lint:no-contract-cast — ${hits.length} bypass-the-seam cast(s) found:`);
for (const hit of hits) {
  console.error(`  ${hit.file}:${hit.line}:${hit.col}  ${hit.snippet}`);
}
console.error('');
console.error(
  'Replace `as Contract` with `familyInstance.deserializeContract(JSON.parse(raw) as unknown)`.',
);
console.error('See .cursor/rules/as-contract-cast-smell.mdc for the rule + allowlist policy.');
process.exit(1);
