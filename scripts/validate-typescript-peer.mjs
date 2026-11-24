#!/usr/bin/env node
// Workspace-level lint gate that enforces the minimum TypeScript peer
// dependency on every publishable package.
//
// A declared floor must never claim more than our own test infra exercises.
// Until `8.0.0` the floor may still be raised. From `8.0.0` it rises only in a
// new major, or when TypeScript's maker ends support for a version (ADR 329).
//
// Every publishable package must declare:
//   "peerDependencies": { "typescript": ">=<MIN_TYPESCRIPT_PEER>" }
//   "peerDependenciesMeta": { "typescript": { "optional": true } }
//
// The peer is optional because TypeScript is a dev-time tool — consumers
// that ship without TypeScript (plain JS consumers) must not be forced to
// install it. Optional-peer declaration preserves type-checking support for
// consumers that do use TypeScript.
//
// Wired into CI via `pnpm lint:manifests`, which runs this after the
// package-manifest license check. Also runnable directly:
//
// Usage:
//   node scripts/validate-typescript-peer.mjs           — exit 1 on offenders
//   node scripts/validate-typescript-peer.mjs --json    — same, with JSON report

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The minimum TypeScript version every publishable package must declare
 * as an optional peer dependency. This is the source of truth for the
 * workspace: bumping this constant is the required first step when
 * raising the TypeScript floor.
 *
 * The corresponding change in each publishable package's `package.json`
 * is enforced by the drift check below, so a stale package.json will be
 * caught by CI on the next lint run.
 */
export const MIN_TYPESCRIPT_PEER = '>=5.9';

/**
 * Returns true when the typescript peer declaration is correct.
 * Both the peer range and the optional flag must match.
 *
 * @param {Record<string, unknown>} pkgJson
 * @returns {boolean}
 */
export function hasCorrectTypescriptPeer(pkgJson) {
  const peer = pkgJson.peerDependencies?.['typescript'];
  const meta = pkgJson.peerDependenciesMeta?.['typescript'];
  return peer === MIN_TYPESCRIPT_PEER && meta?.optional === true;
}

/**
 * Classifies a publishable `package.json` against the typescript-peer rule.
 * Returns `null` when the package conforms; otherwise returns a structured
 * offender record.
 *
 * Pure / side-effect-free; exported for tests.
 *
 * @param {Record<string, unknown>} pkgJson
 * @returns {{ name: string; peer: unknown; meta: unknown; reason: 'missing' | 'wrong-range' | 'not-optional' } | null}
 */
export function classifyPackage(pkgJson) {
  const name = typeof pkgJson.name === 'string' ? pkgJson.name : '<unnamed>';
  const peer = pkgJson.peerDependencies?.['typescript'];
  const meta = pkgJson.peerDependenciesMeta?.['typescript'];

  if (peer === undefined || peer === null) {
    return { name, peer, meta, reason: 'missing' };
  }
  if (peer !== MIN_TYPESCRIPT_PEER) {
    return { name, peer, meta, reason: 'wrong-range' };
  }
  if (meta?.optional !== true) {
    return { name, peer, meta, reason: 'not-optional' };
  }
  return null;
}

function listPublishablePackageDirs() {
  const out = execFileSync('node', ['scripts/list-publishable-packages.mjs'], {
    encoding: 'utf-8',
  });
  return out
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.replace(/^\.\//, ''));
}

const DEFAULT_IO = {
  listPublishablePackageDirs,
  readPackageJson: (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')),
  stdoutWrite: (s) => process.stdout.write(s),
  stderrWrite: (s) => process.stderr.write(s),
};

/**
 * Runs the manifest gate. Pure with respect to its `io` seam — the
 * default uses `scripts/list-publishable-packages.mjs` and the
 * workspace fs, but tests can stub each leg.
 *
 * Always returns a numeric exit code; the caller is responsible for
 * `process.exit(...)`.
 *
 * @param {object} [options]
 * @param {string[]} [options.argv]
 * @param {Partial<typeof DEFAULT_IO>} [options.io]
 * @returns {number}
 */
export function runCheck({ argv = process.argv.slice(2), io = {} } = {}) {
  const {
    listPublishablePackageDirs: listDirs,
    readPackageJson,
    stdoutWrite,
    stderrWrite,
  } = {
    ...DEFAULT_IO,
    ...io,
  };
  const args = new Set(argv);
  const json = args.has('--json');

  const dirs = listDirs();
  /** @type {Array<{ dir: string; name: string; peer: unknown; meta: unknown; reason: string }>} */
  const offenders = [];

  for (const dir of dirs) {
    const pkg = readPackageJson(dir);
    const offence = classifyPackage(pkg);
    if (offence) {
      offenders.push({ dir, ...offence });
    }
  }

  if (json) {
    stdoutWrite(
      `${JSON.stringify({ ok: offenders.length === 0, minTypescriptPeer: MIN_TYPESCRIPT_PEER, offenders }, null, 2)}\n`,
    );
    return offenders.length === 0 ? 0 : 1;
  }

  if (offenders.length === 0) {
    stderrWrite(
      `\nOK — all ${dirs.length} publishable packages declare "peerDependencies": { "typescript": "${MIN_TYPESCRIPT_PEER}" } with optional: true.\n`,
    );
    return 0;
  }

  stderrWrite(
    `\nFAIL — ${offenders.length} of ${dirs.length} publishable package(s) fail the TypeScript peer declaration check:\n`,
  );
  for (const o of offenders) {
    if (o.reason === 'missing') {
      stderrWrite(`\n  ${o.name} (${o.dir})\n    no "typescript" in peerDependencies\n`);
    } else if (o.reason === 'wrong-range') {
      stderrWrite(
        `\n  ${o.name} (${o.dir})\n    "typescript": ${JSON.stringify(o.peer)} (expected "${MIN_TYPESCRIPT_PEER}")\n`,
      );
    } else {
      stderrWrite(
        `\n  ${o.name} (${o.dir})\n    peerDependenciesMeta.typescript.optional is not true\n`,
      );
    }
  }
  stderrWrite(
    '\nEvery publishable package must declare:\n' +
      `  "peerDependencies": { "typescript": "${MIN_TYPESCRIPT_PEER}" }\n` +
      `  "peerDependenciesMeta": { "typescript": { "optional": true } }\n\n` +
      'To raise the TypeScript floor, update MIN_TYPESCRIPT_PEER in\n' +
      'scripts/validate-typescript-peer.mjs first, then re-run this check\n' +
      'to find which packages need updating.\n',
  );
  return 1;
}

export function main() {
  return runCheck();
}

// Only run `main` when invoked directly. Importing the module from a
// unit test gets you the pure helpers without enumerating the workspace.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
