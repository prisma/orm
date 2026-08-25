#!/usr/bin/env node

/**
 * Composes the version + dist-tag the publish workflow will use.
 *
 * The base version comes from the root `package.json` (the
 * source-of-truth introduced by the package.json-versioning refactor).
 * This script is responsible only for the suffix and dist-tag
 * appropriate to the GitHub event:
 *
 * - `push`              → if the root `version` changed in this push,
 *                          `<base>` (no suffix), dist-tag `latest`. This
 *                          is how a merged `chore(release): ...` PR
 *                          ships a release automatically — on the RC
 *                          line `latest` tracks the newest `8.0.0-rc.N`
 *                          (these package names have no pre-v8 stable
 *                          audience to protect; the bare `prisma`
 *                          package, which does, is published elsewhere).
 *                          The plan then also carries `devVersion`
 *                          (`<base>-dev.N`) so the workflow can publish
 *                          a dev build of the same commit — the `dev`
 *                          dist-tag must never fall behind `latest`.
 *                         Otherwise, `<base>-dev.N`, dist-tag `dev`
 *                          (N is the next available build number,
 *                          discovered by querying npm).
 * - `workflow_dispatch` → `<base>` (no suffix), dist-tag from
 *                          `INPUT_DIST_TAG` (defaults to `latest`).
 *                          Useful as a manual escape hatch (re-publish
 *                          after a transient failure, cut a beta).
 *
 * Outputs `version`, `tag`, and `devVersion` (empty unless the push is
 * a release bump) to `$GITHUB_OUTPUT` for downstream workflow steps.
 */

import { execFileSync, execSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import type { PreviousVersionLookup, VersionResult } from './determine-version-utils.ts';
import { assertCanonicalBase, planPushPublish } from './determine-version-utils.ts';

// The counter reads one package's `dev` dist-tag as the high-water mark, so
// that package must be one this repo still publishes on every dev build.
// `prisma-next` used to be it, but #30005 retired the bin and stopped
// publishing it — leaving its `dev` tag frozen one build behind the packages
// that do ship. A frozen anchor re-issues a `<base>-dev.N` npm already holds
// and fails the publish, so anchor on the toolchain shell instead.
const PACKAGE_NAME = process.argv[2] ?? '@prisma/orm-toolchain';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function readRootVersion(): string {
  const pkgPath = join(rootDir, 'package.json');
  const parsed = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: unknown };
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error(
      `Root package.json (${pkgPath}) is missing a \`version\` field. ` +
        'The publish pipeline now reads the version directly from the workspace root; ' +
        'set it (e.g. `pnpm bump-version`) before publishing.',
    );
  }
  return parsed.version;
}

function run(command: string): string | undefined {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return undefined;
  }
}

function getLatestDevVersion(): string | undefined {
  return run(`npm view "${PACKAGE_NAME}" dist-tags.dev`);
}

/**
 * Reads the root `package.json` `version` at `PUSH_BEFORE_SHA` (the ref
 * that `main` pointed at *before* the push). Distinguishes "we
 * successfully read the previous file" (so the comparison is meaningful)
 * from "we couldn't" (shallow clone, missing SHA, etc.) so the caller
 * can fall back to the safe `dev` path on any I/O hiccup.
 */
function readPreviousRootVersion(): PreviousVersionLookup {
  const beforeSha = process.env.PUSH_BEFORE_SHA;
  if (!beforeSha || /^0+$/.test(beforeSha)) {
    return { available: false };
  }
  try {
    const json = execFileSync('git', ['show', `${beforeSha}:package.json`], {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(json) as { version?: unknown };
    return {
      available: true,
      version: typeof parsed.version === 'string' ? parsed.version : undefined,
    };
  } catch {
    return { available: false };
  }
}

function writeGitHubOutput(result: VersionResult): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `version<<EOF\n${result.version}\nEOF\n`);
    appendFileSync(outputFile, `tag<<EOF\n${result.tag}\nEOF\n`);
    appendFileSync(outputFile, `devVersion<<EOF\n${result.devVersion ?? ''}\nEOF\n`);
  }
}

const eventName = process.env.GITHUB_EVENT_NAME;
const inputDistTag = process.env.INPUT_DIST_TAG;

const baseVersion = readRootVersion();
assertCanonicalBase(baseVersion);

console.log(`Event:                 ${eventName}`);
console.log(`Base version (root):   ${baseVersion}`);

let result: VersionResult;

switch (eventName) {
  case 'workflow_dispatch':
    // `??` is wrong here: an empty INPUT_DIST_TAG would slip through as
    // the dist-tag and cause `pnpm publish --tag ""` to fail downstream.
    result = { version: baseVersion, tag: inputDistTag || 'latest' };
    break;

  case 'push': {
    const previous = readPreviousRootVersion();
    result = planPushPublish(baseVersion, previous, getLatestDevVersion());
    if (result.tag === 'latest') {
      console.log(
        `Previous root version: ${previous.available ? (previous.version ?? '(unset)') : '(unreadable)'} → release bump detected.`,
      );
    }
    break;
  }

  default:
    throw new Error(`don't know how to handle event ${eventName}`);
}

console.log(`Resolved version:      ${result.version}`);
console.log(`Resolved dist-tag:     ${result.tag}`);
if (result.devVersion) {
  console.log(`Dev follow-up version: ${result.devVersion}`);
}
writeGitHubOutput(result);
