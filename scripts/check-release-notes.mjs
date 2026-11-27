#!/usr/bin/env node
// Pre-publish + PR-CI presence check for per-release notes files.
//
// Every `latest` release publishes a committed,
// hand-curated `docs/releases/v<version>.md` as the GitHub Release
// body — there is no auto-generated fallback. This check asserts that
// file exists so a release can never ship with missing or flat notes.
//
// `package.json.version` on a given ref is the *currently published*
// version on that ref. A change to that value across a branch is a
// release bump; that is the signal both modes key off.
//
//   - Publish mode. The version being published is read from
//     `--version <v>` if given, else from root `package.json` on the
//     `--head` ref. The gate asserts `docs/releases/v<version>.md`
//     exists in the working tree (the release checkout). Missing →
//     non-zero exit naming the expected path; present → exit 0.
//
//   - PR mode. The root `package.json` `version` is read on `--prev`
//     (default `origin/main`, falling back to local `main`) and on
//     `--head` (default HEAD). If the version changed on the branch
//     (a release bump), the gate asserts the matching
//     `docs/releases/v<head-version>.md` is present — so a release PR
//     fails early rather than only post-merge. If the version is
//     unchanged (no bump), the gate is a no-op and exits 0.
//
// Usage:
//   node scripts/check-release-notes.mjs [--mode pr|publish]
//                                        [--head <ref>] [--prev <ref>]
//                                        [--version <v>] [--json]
//
// Wired into root `package.json` as `pnpm check:release-notes`.
// Invoked from `.github/workflows/ci.yml` (mode pr) and
// `.github/workflows/publish.yml` (mode publish, scoped to dist-
// tag `latest`).

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { argv, cwd, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

import { parseVersion } from '../packages/0-shared/publish-surface/src/release-plan.ts';

const RELEASES_DIR = 'docs/releases';

/** A version read with the release plan's parser, which stops on one this repository does not publish. */
function checkedVersion(version) {
  parseVersion(version);
  return version;
}

/**
 * The committed notes file whose contents become the GitHub Release
 * body for a given version. Exported for unit tests.
 */
export function notesFileForVersion(version) {
  return `${RELEASES_DIR}/v${version}.md`;
}

function git(repoRoot, ...args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function tryGit(repoRoot, ...args) {
  try {
    return git(repoRoot, ...args).trim();
  } catch {
    return null;
  }
}

/**
 * Read the root `package.json` `version` at a git ref. Throws if the
 * ref can't be read or carries no usable `version`.
 */
export function readVersionAtRef(repoRoot, ref) {
  const parsed = JSON.parse(git(repoRoot, 'show', `${ref}:package.json`));
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error(`root package.json at "${ref}" has no usable \`version\` field`);
  }
  return parsed.version;
}

function resolveDefaultPrev(repoRoot) {
  // PR mode only. Prefer `origin/main`; fall back to local `main` (some
  // CI checkouts don't preserve the `origin` remote name).
  const refs = ['origin/main', 'main'];
  for (const ref of refs) {
    if (tryGit(repoRoot, 'rev-parse', '--verify', `${ref}^{commit}`)) {
      return ref;
    }
  }
  throw new Error(
    'check-release-notes: --mode pr default --prev requires either `origin/main` or `main` to exist; pass --prev <ref> explicitly',
  );
}

/**
 * Parse the supported CLI arguments. Exported for unit tests.
 */
export function parseArgs(args) {
  const out = { mode: 'pr', head: 'HEAD', prev: null, version: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--mode') {
      out.mode = args[++i];
    } else if (arg === '--head') {
      out.head = args[++i];
    } else if (arg === '--prev') {
      out.prev = args[++i];
    } else if (arg === '--version') {
      out.version = args[++i];
    } else if (arg === '--json') {
      out.json = true;
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else {
      throw new Error(`check-release-notes: unknown argument "${arg}"`);
    }
  }
  if (out.mode !== 'pr' && out.mode !== 'publish') {
    throw new Error(`check-release-notes: --mode must be "pr" or "publish" (got "${out.mode}")`);
  }
  return out;
}

/**
 * Run the check. Returns a result envelope; the caller decides how to
 * render it (text vs JSON) and owns `process.exit`.
 *
 * - publish: assert the notes file for the target version exists.
 * - pr: a no-op unless the version changed between prev and head; when
 *   it did, assert the notes file for the head version exists.
 */
export function runCheck({ repoRoot, mode, head, prev, version }) {
  if (mode === 'publish') {
    const targetVersion = checkedVersion(version ?? readVersionAtRef(repoRoot, head));
    const notesFile = notesFileForVersion(targetVersion);
    const present = existsSync(`${repoRoot}/${notesFile}`);
    return {
      ok: present,
      mode,
      version: targetVersion,
      bumped: null,
      notesFile,
      present,
      violations: present ? [] : [{ rule: 'missing-notes', version: targetVersion, notesFile }],
    };
  }

  const headVersion = checkedVersion(version ?? readVersionAtRef(repoRoot, head));
  const prevVersion = checkedVersion(readVersionAtRef(repoRoot, prev));
  const bumped = headVersion !== prevVersion;
  if (!bumped) {
    return {
      ok: true,
      mode,
      version: headVersion,
      prevVersion,
      bumped: false,
      notesFile: null,
      present: null,
      violations: [],
    };
  }
  const notesFile = notesFileForVersion(headVersion);
  const present = existsSync(`${repoRoot}/${notesFile}`);
  return {
    ok: present,
    mode,
    version: headVersion,
    prevVersion,
    bumped: true,
    notesFile,
    present,
    violations: present ? [] : [{ rule: 'missing-notes', version: headVersion, notesFile }],
  };
}

function renderViolations(result, write) {
  for (const v of result.violations) {
    write(
      `check-release-notes: missing release notes for v${v.version}\n` +
        '  expected a committed notes file at:\n' +
        `    ${v.notesFile}\n` +
        '  A latest/next release requires a hand-authored notes file — there is no\n' +
        '  auto-generated fallback. Author one (see docs/releases/README.md for\n' +
        '  the template and section order) and commit it before publishing.\n',
    );
  }
}

export function main(args = argv.slice(2), repoRoot = cwd()) {
  let parsed;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 2;
  }
  if (parsed.help) {
    stdout.write(
      [
        'Usage: node scripts/check-release-notes.mjs [--mode pr|publish] [--head <ref>] [--prev <ref>] [--version <v>] [--json]',
        '',
        '  --mode     pr (default) or publish',
        '  --head     git ref to read the version from (default: HEAD)',
        '  --prev     pr mode: git ref to compare against (default: origin/main, then main)',
        '  --version  override the detected version (skips reading package.json)',
        '  --json     emit a JSON result envelope on stdout instead of text on stderr',
        '',
      ].join('\n'),
    );
    return 0;
  }
  let prev = parsed.prev;
  try {
    if (parsed.mode === 'pr' && prev === null) {
      prev = resolveDefaultPrev(repoRoot);
    }
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 2;
  }
  let result;
  try {
    result = runCheck({
      repoRoot,
      mode: parsed.mode,
      head: parsed.head,
      prev,
      version: parsed.version,
    });
  } catch (err) {
    stderr.write(`check-release-notes: ${err.message}\n`);
    return 2;
  }
  if (parsed.json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  }
  if (result.ok) {
    return 0;
  }
  renderViolations(result, (s) => stderr.write(s));
  return 1;
}

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  exit(main());
}
