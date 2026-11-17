#!/usr/bin/env node
// PR-time CI gate (FR2/FR3 of the OSS-setup project).
//
// For every publishable package in the workspace, asserts that
// `package.json` declares a `license` field whose value is the SPDX
// identifier `Apache-2.0`. License declarations are required for npm
// tarballs to be readable by license scanners (Snyk, FOSSA,
// `license-checker`); enterprise consumers will be blocked from
// depending on packages that ship without one.
//
// Wired into `.github/workflows/ci.yml` via the `lint` job (as
// `pnpm lint:manifests`). Also runnable locally:
//   pnpm lint:manifests
//
// The validator is deliberately scoped to publishable packages — every
// `package.json` under `packages/**` that is **not** marked
// `"private": true`. Internal packages (config bags, fixtures, internal
// tooling) are exempt because they never ship a tarball; their license
// status is irrelevant to downstream consumers.
//
// Usage:
//   node scripts/validate-package-manifests.mjs           — exit 1 on offenders
//   node scripts/validate-package-manifests.mjs --json    — same, with JSON report

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_LICENSE = 'Apache-2.0';

/**
 * Returns true if `license` is the SPDX identifier we require on every
 * publishable package. Strict equality, not a regex: SPDX expressions
 * like `Apache-2.0 OR MIT` are not permitted because they introduce
 * ambiguity for downstream license scanners.
 *
 * Exported so the unit test can exercise the rule without enumerating
 * the workspace.
 *
 * @param {unknown} license
 * @returns {boolean}
 */
export function isAcceptedLicense(license) {
  return license === REQUIRED_LICENSE;
}

/**
 * Classifies a publishable `package.json` against the license rule.
 * Returns `null` when the package conforms; otherwise returns a
 * structured offender record naming the package, its declared license
 * (if any), and the failure reason.
 *
 * Pure / side-effect-free; exported for tests.
 *
 * @param {Record<string, unknown>} pkgJson
 * @returns {{ name: string; license: unknown; reason: 'missing' | 'wrong' } | null}
 */
export function classifyPackage(pkgJson) {
  const license = pkgJson.license;
  const name = typeof pkgJson.name === 'string' ? pkgJson.name : '<unnamed>';
  if (license === undefined || license === null || license === '') {
    return { name, license, reason: 'missing' };
  }
  if (!isAcceptedLicense(license)) {
    return { name, license, reason: 'wrong' };
  }
  return null;
}

const REQUIRED_REPO_URL = 'https://github.com/prisma/orm.git';

/**
 * Classifies a publishable `package.json` against the repository rule.
 * npm provenance verification (OIDC Trusted Publishing) rejects a
 * tarball whose `repository.url` does not match the repository the
 * workflow runs in, so every publishable package must declare the
 * object form with the canonical url and its own workspace directory.
 *
 * Pure / side-effect-free; exported for tests.
 *
 * @param {Record<string, unknown>} pkgJson
 * @param {string} dir
 * @returns {{ name: string; repository: unknown; reason: 'repository-missing' | 'repository-wrong' } | null}
 */
export function classifyRepository(pkgJson, dir) {
  const name = typeof pkgJson.name === 'string' ? pkgJson.name : '<unnamed>';
  const repository = pkgJson.repository;
  if (repository === undefined || repository === null) {
    return { name, repository, reason: 'repository-missing' };
  }
  const conforms =
    typeof repository === 'object' &&
    repository.type === 'git' &&
    repository.url === REQUIRED_REPO_URL &&
    repository.directory === dir;
  return conforms ? null : { name, repository, reason: 'repository-wrong' };
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
  /** @type {Array<{ dir: string; name: string; license: unknown; reason: 'missing' | 'wrong' }>} */
  const offenders = [];

  for (const dir of dirs) {
    const pkg = readPackageJson(dir);
    const offence = classifyPackage(pkg);
    if (offence) {
      offenders.push({ dir, ...offence });
    }
    const repoOffence = classifyRepository(pkg, dir);
    if (repoOffence) {
      offenders.push({ dir, ...repoOffence });
    }
  }

  if (json) {
    stdoutWrite(`${JSON.stringify({ ok: offenders.length === 0, offenders }, null, 2)}\n`);
    return offenders.length === 0 ? 0 : 1;
  }

  if (offenders.length === 0) {
    stderrWrite(
      `\nOK — all ${dirs.length} publishable packages declare "license": "${REQUIRED_LICENSE}" and the canonical "repository".\n`,
    );
    return 0;
  }

  stderrWrite(
    `\nFAIL — ${offenders.length} manifest declaration problem(s) across ${dirs.length} publishable package(s):\n`,
  );
  for (const o of offenders) {
    if (o.reason === 'missing') {
      stderrWrite(`\n  ${o.name} (${o.dir})\n    no "license" field declared\n`);
    } else if (o.reason === 'wrong') {
      stderrWrite(
        `\n  ${o.name} (${o.dir})\n    "license": ${JSON.stringify(o.license)} (expected "${REQUIRED_LICENSE}")\n`,
      );
    } else if (o.reason === 'repository-missing') {
      stderrWrite(`\n  ${o.name} (${o.dir})\n    no "repository" field declared\n`);
    } else {
      stderrWrite(
        `\n  ${o.name} (${o.dir})\n    "repository": ${JSON.stringify(o.repository)}\n` +
          `    (expected { "type": "git", "url": "${REQUIRED_REPO_URL}", "directory": "${o.dir}" })\n`,
      );
    }
  }
  stderrWrite(
    `\nEvery publishable package must declare "license": "${REQUIRED_LICENSE}" and a\n` +
      `"repository" object ({ "type": "git", "url": "${REQUIRED_REPO_URL}",\n` +
      '"directory": <package dir> }) — npm provenance verification rejects tarballs\n' +
      'without the matching repository url. Internal packages that should not be\n' +
      'published must instead set "private": true.\n',
  );
  return 1;
}

export function main() {
  return runCheck();
}

// Only run `main` when invoked directly. Importing the module from a
// unit test gets you the pure helpers (`classifyPackage`,
// `isAcceptedLicense`) without enumerating the workspace.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
