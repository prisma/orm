#!/usr/bin/env node
/**
 * A vitest config never budgets its tests or hooks with `timeouts.default`.
 *
 * `timeouts.default` is 100ms, and CI's TEST_TIMEOUT_MULTIPLIER makes it
 * 200ms: a hook that deletes a temp directory or a test that opens a stream
 * then fails on a slow runner with nothing wrong. `timeouts.vitestPackageDefault`
 * exists for exactly this slot, and `timeouts.databaseOperation` for packages
 * whose tests talk to a database. `timeouts.default` stays available for the
 * short waits inside tests that want it.
 *
 * Exit codes:
 *   0 — no vitest config budgets testTimeout or hookTimeout with timeouts.default
 *   1 — at least one does, named by file and line
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GIT_ROOT = process.cwd();

const BUDGET = /(?<=^|[\s{,])['"]?(testTimeout|hookTimeout)['"]?\s*:\s*\(?\s*timeouts\.default\b/g;

/** Every extension vitest loads a config from. */
const CONFIG_GLOBS = ['js', 'mjs', 'cjs', 'ts', 'cts', 'mts'].map((ext) => `*vitest.config.${ext}`);

/**
 * Comments and string contents, replaced by spaces of the same length so a
 * mention of the pattern in prose cannot match and every offset still maps to
 * the original line. A quoted property key survives as its quotes.
 */
const NON_CODE = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g;

function maskNonCode(source) {
  return source.replace(NON_CODE, (text, quote) => {
    if (quote === undefined) {
      return text.replace(/[^\n]/g, ' ');
    }
    const inner = text.slice(1, -1);
    return /^(testTimeout|hookTimeout)$/.test(inner)
      ? text
      : `${quote}${' '.repeat(inner.length)}${quote}`;
  });
}

/** The lines of a vitest config that budget tests or hooks with `timeouts.default`. */
export function findDefaultTimeoutBudgets(source) {
  const findings = [];
  for (const match of maskNonCode(source).matchAll(BUDGET)) {
    const line = source.slice(0, match.index).split('\n').length;
    findings.push({ line, setting: match[1] });
  }
  return findings;
}

function trackedVitestConfigs() {
  const out = execFileSync('git', ['ls-files', '--', ...CONFIG_GLOBS], {
    cwd: GIT_ROOT,
    encoding: 'utf-8',
  });
  return out.split('\n').filter((line) => line.length > 0);
}

function main() {
  const violations = [];
  for (const file of trackedVitestConfigs()) {
    const source = readFileSync(join(GIT_ROOT, file), 'utf-8');
    for (const finding of findDefaultTimeoutBudgets(source)) {
      violations.push(`${file}:${finding.line} ${finding.setting}: timeouts.default`);
    }
  }
  if (violations.length === 0) {
    console.log(
      'lint-vitest-timeouts: no vitest config budgets tests or hooks with timeouts.default',
    );
    return 0;
  }
  console.error(
    'lint-vitest-timeouts: timeouts.default is 100ms (200ms on CI) and fails healthy tests; use timeouts.vitestPackageDefault, or timeouts.databaseOperation for a package that talks to a database:',
  );
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  return 1;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  process.exit(main());
}
