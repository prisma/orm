#!/usr/bin/env node
/**
 * CI ratchets for the three Biome plugins in biome-plugins/.
 *
 * The plugins report at severity "info", because each has hundreds of
 * existing sites. This script stops the counts from growing. It runs Biome
 * once at HEAD and, when HEAD differs from `git merge-base origin/main HEAD`,
 * once more at the merge base, then applies every ratchet to those results:
 *
 *   - no-bare-cast, no-bare-throw: the HEAD count may not exceed the
 *     merge-base count. New sites are printed as file:line.
 *   - no-family-vocabulary: for each scope in
 *     scripts/framework-vocabulary-thresholds.json, the HEAD count,
 *     deduplicated by file and line, must equal the recorded threshold. A
 *     lower count fails too, so the author lowers the threshold and the
 *     reduction stays locked in. `--list` prints every current site and
 *     skips the merge-base ratchets.
 *
 * Exit codes:
 *   0 — every ratchet passed
 *   1 — at least one ratchet failed, or origin/main is not available
 *
 * The script uses process.cwd() as the git root and scan root so tests can
 * supply a temporary fixture repo by setting cwd on the child process.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The real repo root (where the biome binary + config live) — always the
// directory that contains this script's parent, regardless of cwd.
const REAL_REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const BIOME_BIN = join(REAL_REPO_ROOT, 'node_modules', '.bin', 'biome');
const BIOME_CONFIG = join(REAL_REPO_ROOT, 'biome.jsonc');

const GIT_ROOT = process.cwd();
const VOCABULARY_CONFIG_PATH = join(GIT_ROOT, 'scripts', 'framework-vocabulary-thresholds.json');

// Paths the throw ratchet does not count: plugin fixtures exist to fire the
// diagnostic on purpose, and repo tooling scripts plus published upgrade-step
// codemods cannot import structuredError/InternalError (they run standalone —
// pre-build, or via `pnpm exec tsx` from a consumer project with no
// `@internal/*` resolvable), so the ban would prescribe an impossible fix
// there. The plugin still reports them; only the CI count ignores them.
const UNCOUNTED_THROW_PATH_RE =
  /biome-plugins\/fixtures\/|(^|\/)scripts\/[^/]+\.(mjs|ts)$|(^|\/)skills\/.+\/upgrades\//;

function isPluginDiag(d, plugin) {
  return (
    d.category === 'plugin' && typeof d.message === 'string' && d.message.startsWith(`${plugin}: `)
  );
}

export function filterNoBareCastDiags(diagnostics) {
  return diagnostics.filter((d) => isPluginDiag(d, 'no-bare-cast'));
}

export function filterNoBareThrowDiags(diagnostics) {
  return diagnostics.filter(
    (d) =>
      isPluginDiag(d, 'no-bare-throw') && !UNCOUNTED_THROW_PATH_RE.test(d.location?.path ?? ''),
  );
}

export function filterVocabularyDiags(diagnostics) {
  return diagnostics.filter((d) => isPluginDiag(d, 'no-family-vocabulary'));
}

function siteOf(d) {
  const loc = d.location ?? {};
  return `${loc.path ?? ''}:${loc.start?.line ?? 0}`;
}

// One entry per (file, line): the vocabulary plugin reports every matching
// node, so a single line yields several diagnostics when it carries several
// terms or when nested nodes both match.
export function dedupeSites(diagnostics) {
  return [...new Set(filterVocabularyDiags(diagnostics).map(siteOf))].sort();
}

function lintWithBiome(scanDir) {
  const result = spawnSync(
    BIOME_BIN,
    ['lint', '--config-path', BIOME_CONFIG, '--reporter=json', '.'],
    { cwd: scanDir, encoding: 'utf-8', maxBuffer: 400 * 1024 * 1024 },
  );

  if (result.error) {
    throw new Error(`biome spawn failed: ${result.error.message}`);
  }

  const raw = (result.stdout ?? '').trim();
  if (!raw) {
    throw new Error(
      `biome printed no report (exit status ${result.status}):\n${(result.stderr ?? '').slice(0, 2000)}`,
    );
  }

  try {
    return JSON.parse(raw).diagnostics ?? [];
  } catch (e) {
    throw new Error(
      `biome JSON parse failed: ${e.message}\nraw output (first 500 chars): ${raw.slice(0, 500)}`,
    );
  }
}

function git(...args) {
  return execFileSync('git', args, { cwd: GIT_ROOT, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function lintAtCommit(sha) {
  const dir = mkdtempSync(join(tmpdir(), 'lint-ratchets-'));
  try {
    git('worktree', 'add', '--detach', dir, sha);
    return lintWithBiome(dir);
  } finally {
    try {
      git('worktree', 'remove', '--force', dir);
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
}

const MERGE_BASE_RATCHETS = [
  {
    plugin: 'no-bare-cast',
    filter: filterNoBareCastDiags,
    advice:
      'new bare `as` cast(s) introduced. Replace with blindCast<T, "reason">(...) or castAs<T>(value):',
  },
  {
    plugin: 'no-bare-throw',
    filter: filterNoBareThrowDiags,
    advice:
      'new bare `throw new Error(...)` introduced. Use structuredError(...) for user-facing errors, or InternalError/assertNever for bugs:',
  },
];

function checkMergeBaseRatchet({ plugin, filter, advice }, headDiags, baseDiags) {
  const headSites = filter(headDiags).map(siteOf);
  const baseSites = filter(baseDiags).map(siteOf);
  const delta = headSites.length - baseSites.length;
  const sign = delta > 0 ? '+' : '';
  console.log(
    `lint:ratchets: ${plugin} current=${headSites.length} merge-base=${baseSites.length} delta=${sign}${delta}`,
  );
  if (delta <= 0) return true;

  const baseSet = new Set(baseSites);
  console.error(`lint:ratchets: ${plugin}: ${delta} ${advice}`);
  for (const site of headSites.filter((s) => !baseSet.has(s))) {
    console.error(`  ${site}`);
  }
  return false;
}

function checkVocabularyScope(scope, headDiags, list) {
  const sites = dedupeSites(headDiags).filter((site) => site.startsWith(`${scope.path}/`));
  const count = sites.length;
  const { threshold } = scope;

  console.log(
    `lint:ratchets: no-family-vocabulary scope=${scope.path} count=${count} threshold=${threshold}`,
  );
  if (list) {
    for (const site of sites) console.log(`  ${site}`);
  }

  if (count > threshold) {
    console.error(
      `lint:ratchets: ${count - threshold} new family/target-vocabulary line(s) in ${scope.path}.`,
    );
    console.error(
      '  The framework domain is family-blind — move the new SQL/Mongo/target concept out of it.',
    );
    console.error(`  Find your additions: git diff origin/main -- ${scope.path}`);
    console.error('  List all current sites: pnpm lint:ratchets --list');
    console.error('  If a site is genuinely family-blind, suppress it at the line with');
    console.error(
      '  `// biome-ignore lint/plugin/no-family-vocabulary: <why>` and lower the threshold.',
    );
    console.error(
      `  Otherwise raise "threshold" to ${count} in scripts/framework-vocabulary-thresholds.json with justification in review.`,
    );
    return false;
  }
  if (count < threshold) {
    console.error(
      `lint:ratchets: scope=${scope.path} improved (count=${count} < threshold=${threshold}).`,
    );
    console.error(
      `  Lower "threshold" to ${count} in scripts/framework-vocabulary-thresholds.json to lock in the reduction.`,
    );
    return false;
  }
  return true;
}

function resolveMergeBase() {
  try {
    git('rev-parse', 'origin/main');
  } catch {
    return undefined;
  }
  return git('merge-base', 'origin/main', 'HEAD');
}

function main() {
  const list = process.argv.slice(2).includes('--list');
  const vocabularyConfig = JSON.parse(readFileSync(VOCABULARY_CONFIG_PATH, 'utf-8'));

  const headDiags = lintWithBiome(GIT_ROOT);
  let passed = true;

  for (const scope of vocabularyConfig.scopes) {
    passed = checkVocabularyScope(scope, headDiags, list) && passed;
  }

  if (list) {
    if (!passed) process.exit(1);
    return;
  }

  const mergeBase = resolveMergeBase();
  if (mergeBase === undefined) {
    console.error('lint:ratchets: error — origin/main is not available.');
    console.error('  Run: git fetch --no-tags origin main:refs/remotes/origin/main');
    console.error('  Or ensure the CI checkout uses fetch-depth: 0.');
    passed = false;
  } else if (mergeBase === git('rev-parse', 'HEAD')) {
    console.log(
      'lint:ratchets: HEAD is at the merge base with origin/main — skipping the merge-base ratchets.',
    );
  } else {
    const baseDiags = lintAtCommit(mergeBase);
    for (const ratchet of MERGE_BASE_RATCHETS) {
      passed = checkMergeBaseRatchet(ratchet, headDiags, baseDiags) && passed;
    }
  }

  if (!passed) process.exit(1);
}

if (process.argv[1] === import.meta.filename) main();
