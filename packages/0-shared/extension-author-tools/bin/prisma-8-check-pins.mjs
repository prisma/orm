#!/usr/bin/env node
// Enforce the exact-pin rule for Prisma 8 extensions: every
// `@internal/*` entry in `dependencies`, `peerDependencies`, and
// `optionalDependencies` must be a single exact-version string, and
// every entry must resolve to the same version. Exits 0 on success
// (no output); on failure, prints one structured line per offending
// entry and exits non-zero.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd, exit, stderr } from 'node:process';

const DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];
const INTERNAL_SCOPE = '@internal/';
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function readPackageJson() {
  const path = join(cwd(), 'package.json');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    stderr.write(`prisma-8-check-pins: cannot read package.json at ${path}: ${err.message}\n`);
    exit(2);
  }
}

function collectEntries(pkg) {
  const entries = [];
  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (!name.startsWith(INTERNAL_SCOPE)) continue;
      entries.push({ field, name, spec });
    }
  }
  return entries;
}

function findViolations(entries) {
  const violations = [];
  const exactEntries = [];
  for (const entry of entries) {
    if (typeof entry.spec === 'string' && EXACT_VERSION_RE.test(entry.spec)) {
      exactEntries.push(entry);
    } else {
      violations.push({
        ...entry,
        rule: 'exact-version',
        message:
          'not an exact-version pin (operators, ranges, workspace specifiers, and wildcards are forbidden; expected e.g. "0.7.0")',
      });
    }
  }
  if (exactEntries.length > 1) {
    const versions = new Set(exactEntries.map((entry) => entry.spec));
    if (versions.size > 1) {
      const observed = Array.from(versions).sort().join(', ');
      for (const entry of exactEntries) {
        violations.push({
          ...entry,
          rule: 'single-version',
          message: `all @internal/* entries must share the same exact version (observed: ${observed})`,
        });
      }
    }
  }
  return violations;
}

function main() {
  const pkg = readPackageJson();
  const entries = collectEntries(pkg);
  const violations = findViolations(entries);
  if (violations.length === 0) {
    exit(0);
  }
  const pkgName = typeof pkg.name === 'string' ? pkg.name : '<unnamed>';
  stderr.write(`prisma-8-check-pins: ${violations.length} violation(s) in ${pkgName}\n`);
  for (const v of violations) {
    stderr.write(`  ${v.field}.${v.name} = ${JSON.stringify(v.spec)} — ${v.message}\n`);
  }
  exit(1);
}

main();
