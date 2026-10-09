#!/usr/bin/env node
// Checks that every package under `packages/` states the one Node.js range
// Prisma 8 supports. Every publishable package must declare it in
// `engines.node`; an unpublished package that declares `engines.node` must
// use the same range, because tsdown derives each package's build target
// from that field and the published packages bundle the unpublished ones.
//
// Wired into CI via `pnpm lint:manifests`.
//
// Usage:
//   node scripts/validate-node-engines.mjs           — exit 1 on offenders
//   node scripts/validate-node-engines.mjs --json    — same, with JSON report

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Node.js range every Prisma 8 package supports: Node.js 22.18 or newer
 * on the 22 line, 24.11 or newer on the 24 line, or 26 or newer. See ADR 269.
 */
export const NODE_ENGINES_RANGE = '^22.18.0 || ^24.11.0 || >=26.0.0';

/**
 * @param {Record<string, unknown>} pkgJson
 * @param {{ publishable: boolean }} options
 * @returns {{ name: string; node: unknown; reason: 'missing' | 'wrong-range' } | null}
 */
export function classifyPackage(pkgJson, { publishable }) {
  const name = typeof pkgJson.name === 'string' ? pkgJson.name : '<unnamed>';
  const node = pkgJson.engines?.node;
  if (node === undefined) {
    return publishable ? { name, node, reason: 'missing' } : null;
  }
  return node === NODE_ENGINES_RANGE ? null : { name, node, reason: 'wrong-range' };
}

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-tsc',
  'dist-tsc-prod',
  'coverage',
  '.tmp-output',
  '.turbo',
]);

function listPackages(root = 'packages') {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (entry === 'package.json') {
        const pkg = JSON.parse(readFileSync(path, 'utf-8'));
        found.push({ dir, publishable: pkg.private !== true });
      }
    }
  };
  walk(root);
  return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

const DEFAULT_IO = {
  listPackages,
  readPackageJson: (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')),
  stdoutWrite: (s) => process.stdout.write(s),
  stderrWrite: (s) => process.stderr.write(s),
};

/**
 * @param {object} [options]
 * @param {string[]} [options.argv]
 * @param {Partial<typeof DEFAULT_IO>} [options.io]
 * @returns {number}
 */
export function runCheck({ argv = process.argv.slice(2), io = {} } = {}) {
  const {
    listPackages: list,
    readPackageJson,
    stdoutWrite,
    stderrWrite,
  } = {
    ...DEFAULT_IO,
    ...io,
  };
  const packages = list();
  const offenders = [];
  for (const { dir, publishable } of packages) {
    const offence = classifyPackage(readPackageJson(dir), { publishable });
    if (offence) offenders.push({ dir, ...offence });
  }

  if (argv.includes('--json')) {
    stdoutWrite(
      `${JSON.stringify({ ok: offenders.length === 0, nodeEnginesRange: NODE_ENGINES_RANGE, offenders }, null, 2)}\n`,
    );
    return offenders.length === 0 ? 0 : 1;
  }

  if (offenders.length === 0) {
    stderrWrite(
      `\nOK — ${packages.length} packages checked for "engines.node": "${NODE_ENGINES_RANGE}".\n`,
    );
    return 0;
  }

  stderrWrite(
    `\nFAIL — ${offenders.length} package(s) do not state the supported Node.js range:\n`,
  );
  for (const o of offenders) {
    const problem =
      o.reason === 'missing' ? 'no "engines.node"' : `"engines.node": ${JSON.stringify(o.node)}`;
    stderrWrite(`\n  ${o.name} (${o.dir})\n    ${problem}\n`);
  }
  stderrWrite(
    `\nSet "engines": { "node": "${NODE_ENGINES_RANGE}" }.\n` +
      'To change the supported range, update NODE_ENGINES_RANGE in scripts/validate-node-engines.mjs first.\n',
  );
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(runCheck());
}
