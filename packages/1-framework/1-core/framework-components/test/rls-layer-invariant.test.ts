/**
 * Structural invariant: no RLS-specific symbols in packages/1-framework or packages/2-sql-family.
 *
 * Generic differ utilities (diffSchemas, SchemaDiffIssue) are target-agnostic and live in
 * packages/1-framework. Postgres RLS types and identifiers live exclusively in packages/3-targets.
 * This test fails if an RLS symbol leaks into a shared layer.
 *
 * Comments are excluded from the scan — only code tokens are checked.
 *
 * Note: dependency-cruiser enforces import-level containment (no RLS module imports into
 * framework/sql). This grep-based test covers the complementary case: locally-defined RLS
 * symbols (no import needed) that dependency-cruiser cannot detect.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

// RLS-specific symbols that must not appear in shared-layer source code.
const RLS_PATTERNS = [
  /RlsPolicy/,
  /RlsMode/,
  /rowsecurity/,
  /pg_policies/,
  /policy_select/,
  /\bRLS\b/,
  /_rls_/,
  /rls_policy/,
];

function stripComments(source: string): string {
  // Strip block comments (/* ... */) including JSDoc
  let stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');
  // Strip line comments (// ...)
  stripped = stripped.replace(/\/\/[^\n]*/g, '');
  return stripped;
}

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules') continue;
      // Exclude test directories — they may reference RLS as fixtures or examples
      if (entry.name === 'test') continue;
      files.push(...collectSourceFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

function findRlsHitsInCode(filePath: string): Array<{ line: number; text: string }> {
  const source = fs.readFileSync(filePath, 'utf-8');
  const code = stripComments(source);
  const lines = code.split('\n');
  const hits: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    for (const pattern of RLS_PATTERNS) {
      if (pattern.test(line)) {
        hits.push({ line: i + 1, text: line.trim() });
        break;
      }
    }
  }
  return hits;
}

describe('RLS layer invariant', () => {
  it('packages/1-framework production source contains no RLS-specific symbols', () => {
    const repoRoot = path.resolve(__dirname, '../../../../..');
    const frameworkDir = path.join(repoRoot, 'packages/1-framework');
    const files = collectSourceFiles(frameworkDir);

    const violations: string[] = [];
    for (const file of files) {
      const hits = findRlsHitsInCode(file);
      for (const hit of hits) {
        violations.push(`${path.relative(repoRoot, file)}:${hit.line}: ${hit.text}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('packages/2-sql-family production source contains no RLS-specific symbols', () => {
    const repoRoot = path.resolve(__dirname, '../../../../..');
    const sqlDir = path.join(repoRoot, 'packages/2-sql-family');
    const files = collectSourceFiles(sqlDir);

    const violations: string[] = [];
    for (const file of files) {
      const hits = findRlsHitsInCode(file);
      for (const hit of hits) {
        violations.push(`${path.relative(repoRoot, file)}:${hit.text}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
