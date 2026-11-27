#!/usr/bin/env node

/**
 * Maintainer-facing release bump.
 *
 * Reads the root `package.json` version *as committed at HEAD*, computes
 * the next release version (`8.0.0-rc.1` → `8.0.0-rc.2`; a pre-8 stable
 * base transitions onto the RC line as `8.0.0-rc.1` — see
 * docs/oss/releasing.md), and writes that value to every workspace
 * `package.json` via `set-version.ts`.
 *
 * Reading from HEAD (rather than disk) is what makes the script
 * idempotent: re-running it without committing the previous bump
 * would otherwise read the *bumped* root version and double-advance.
 *
 * Designed to be invoked from a maintainer skill (see
 * `docs/oss/releasing.md` for the procedure). The skill is
 * responsible for: branch creation, commit, and PR opening.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { assertCanonicalBase, computeNextReleaseVersion } from './determine-version-utils.ts';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function readRootVersionAtHead(): string {
  const json = execFileSync('git', ['show', 'HEAD:package.json'], {
    cwd: rootDir,
    encoding: 'utf-8',
  });

  const parsed = JSON.parse(json) as { version?: unknown };
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error(
      'Root package.json at HEAD is missing a `version` field. ' +
        'The bump-version script requires a canonical base to start from.',
    );
  }
  return parsed.version;
}

const currentVersion = readRootVersionAtHead();
assertCanonicalBase(currentVersion);

const nextVersion = computeNextReleaseVersion(currentVersion);

console.log(`Current root version (HEAD): ${currentVersion}`);
console.log(`Next release version:        ${nextVersion}`);
console.log('');

const setVersionScript = join(rootDir, 'scripts', 'set-version.ts');
execFileSync('node', [setVersionScript, nextVersion], {
  cwd: rootDir,
  stdio: 'inherit',
});
