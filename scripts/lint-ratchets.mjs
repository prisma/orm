#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { filterNoBarecastDiags } from './lint-casts.mjs';
import { dedupeSites, loadConfig } from './lint-framework-vocabulary.mjs';
import { filterNoBareThrowDiags } from './lint-throws.mjs';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const BIOME_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'biome');
const BIOME_CONFIG = join(REPO_ROOT, 'biome.jsonc');
const FRAMEWORK_CONFIG_PATH = join('scripts', 'lint-framework-vocabulary.config.json');
const INCLUDED_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts']);

function diagnosticSites(diagnostics) {
  return diagnostics.map((diagnostic) => {
    const location = diagnostic.location ?? {};
    return `${location.path ?? ''}:${location.start?.line ?? 0}`;
  });
}

export function compareDiagnostics(headDiagnostics, baseDiagnostics, filter) {
  const headSites = diagnosticSites(filter(headDiagnostics));
  const baseSites = diagnosticSites(filter(baseDiagnostics));
  const baseSet = new Set(baseSites);
  return {
    current: headSites.length,
    baseline: baseSites.length,
    delta: headSites.length - baseSites.length,
    added: headSites.filter((site) => !baseSet.has(site)),
  };
}

export function sitesForScope(diagnostics, scopePath) {
  const prefix = `${scopePath.replace(/\/$/, '')}/`;
  return dedupeSites(diagnostics).filter((site) => site.startsWith(prefix));
}

export function inferScopeCount(baseThreshold, headDiagnostics, baseDiagnostics, scopePath) {
  return (
    baseThreshold +
    sitesForScope(headDiagnostics, scopePath).length -
    sitesForScope(baseDiagnostics, scopePath).length
  );
}

function scanDiagnostics(scanDir, paths) {
  if (paths.length === 0) return [];
  const result = spawnSync(
    BIOME_BIN,
    ['lint', '--config-path', BIOME_CONFIG, '--reporter=json', ...paths],
    { cwd: scanDir, encoding: 'utf-8', maxBuffer: 400 * 1024 * 1024 },
  );

  if (result.error) throw new Error(`biome spawn failed: ${result.error.message}`);

  const raw = (result.stdout ?? '').trim();
  if (!raw) return [];

  try {
    return JSON.parse(raw).diagnostics ?? [];
  } catch (error) {
    throw new Error(
      `biome JSON parse failed: ${error.message}\nraw output (first 500 chars): ${raw.slice(0, 500)}`,
    );
  }
}

function git(...args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function lines(value) {
  return value === '' ? [] : value.split('\n');
}

function changedSourceFiles(mergeBase, diffFilter) {
  return lines(
    git('diff', '--name-only', '--no-renames', `--diff-filter=${diffFilter}`, mergeBase, '--'),
  ).filter((path) => INCLUDED_EXTENSIONS.has(extname(path)));
}

function allChangedFiles(mergeBase) {
  return lines(git('diff', '--name-only', '--no-renames', mergeBase, '--'));
}

function untrackedSourceFiles() {
  return lines(git('ls-files', '--others', '--exclude-standard')).filter((path) =>
    INCLUDED_EXTENSIONS.has(extname(path)),
  );
}

function parseManifest(contents, source) {
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Cannot parse package.json from ${source}`, { cause: error });
  }
}

function biomeVersionAt(ref) {
  const manifest = ref
    ? parseManifest(git('show', `${ref}:package.json`), ref)
    : parseManifest(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'), REPO_ROOT);
  return manifest.devDependencies?.['@biomejs/biome'];
}

function requiresFullScan(paths, mergeBase) {
  return (
    paths.some(
      (path) =>
        path === 'biome.jsonc' ||
        path === 'pnpm-lock.yaml' ||
        path.startsWith('biome-plugins/') ||
        path.endsWith('/biome.jsonc'),
    ) ||
    (paths.includes('package.json') && biomeVersionAt() !== biomeVersionAt(mergeBase))
  );
}

function reportDelta(name, result, failureMessage) {
  const sign = result.delta > 0 ? '+' : '';
  console.log(
    `lint:${name}: changed-current=${result.current} changed-merge-base=${result.baseline} delta=${sign}${result.delta}`,
  );
  if (result.delta <= 0) return false;

  console.error(failureMessage(result.delta));
  for (const site of result.added) console.error(`  ${site}`);
  return true;
}

function reportFrameworkVocabulary(
  headDiagnostics,
  baseDiagnostics,
  headConfig,
  baseConfig,
  directCount,
) {
  const list = process.argv.slice(2).includes('--list');
  const baseScopes = new Map(baseConfig.scopes.map((scope) => [scope.path, scope]));
  let failed = false;

  for (const scope of headConfig.scopes) {
    const headSites = sitesForScope(headDiagnostics, scope.path);
    const baseScope = baseScopes.get(scope.path);
    if (!directCount && baseScope === undefined) {
      console.error(`lint:framework-vocabulary: scope=${scope.path} is absent at the merge-base.`);
      return true;
    }
    const count = directCount
      ? headSites.length
      : inferScopeCount(baseScope.threshold, headDiagnostics, baseDiagnostics, scope.path);
    const threshold = scope.threshold;
    console.log(
      `lint:framework-vocabulary: scope=${scope.path} count=${count} threshold=${threshold}`,
    );

    if (list) for (const site of headSites) console.log(`  ${site}`);

    if (count > threshold) {
      failed = true;
      console.error(
        `lint:framework-vocabulary: ${count - threshold} new family/target-vocabulary line(s) in ${scope.path}.`,
      );
      console.error(
        '  The framework domain is family-blind — move the new SQL/Mongo/target concept out of it.',
      );
      console.error(`  Find your additions: git diff origin/main -- ${scope.path}`);
      console.error('  List all current sites: pnpm lint:ratchets --list');
      console.error(
        '  If a site is genuinely family-blind, suppress it with `// biome-ignore lint/plugin/no-family-vocabulary: <why>`.',
      );
    } else if (count < threshold) {
      failed = true;
      console.error(
        `lint:framework-vocabulary: scope=${scope.path} improved (count=${count} < threshold=${threshold}).`,
      );
      console.error(
        `  Lower "threshold" to ${count} in scripts/lint-framework-vocabulary.config.json to lock in the reduction.`,
      );
    }
  }

  return failed;
}

function main() {
  try {
    git('rev-parse', 'origin/main');
  } catch {
    console.error('lint:ratchets: error — origin/main is not available.');
    console.error('  Run: git fetch --no-tags origin main:refs/remotes/origin/main');
    process.exit(1);
  }

  const head = git('rev-parse', 'HEAD');
  const mergeBase = git('merge-base', 'origin/main', 'HEAD');
  const headConfig = loadConfig(join(REPO_ROOT, FRAMEWORK_CONFIG_PATH));
  const list = process.argv.slice(2).includes('--list');

  if (head === mergeBase) {
    const scopes = headConfig.scopes.map((scope) => scope.path);
    const headDiagnostics = scanDiagnostics(REPO_ROOT, scopes);
    const failed = reportFrameworkVocabulary(headDiagnostics, [], headConfig, headConfig, true);
    console.log(
      'lint:casts: HEAD is at merge-base with origin/main — no branch diff to ratchet. Skipping.',
    );
    console.log(
      'lint:throws: HEAD is at merge-base with origin/main — no branch diff to ratchet. Skipping.',
    );
    if (failed) process.exit(1);
    return;
  }

  const changed = allChangedFiles(mergeBase);
  const fullScan = requiresFullScan(changed, mergeBase);
  const headPaths = fullScan
    ? ['.']
    : [...new Set([...changedSourceFiles(mergeBase, 'ACMRTUXB'), ...untrackedSourceFiles()])];
  if (list && !fullScan) {
    headPaths.push(...headConfig.scopes.map((scope) => scope.path));
  }
  const headDiagnostics = scanDiagnostics(REPO_ROOT, [...new Set(headPaths)]);

  const tempDir = mkdtempSync(join(tmpdir(), 'lint-ratchets-'));
  let baseDiagnostics;
  let baseConfig;
  try {
    git('worktree', 'add', '--detach', tempDir, mergeBase);
    const basePaths = fullScan ? ['.'] : changedSourceFiles(mergeBase, 'DMRTUXB');
    baseDiagnostics = scanDiagnostics(tempDir, basePaths);
    baseConfig = loadConfig(join(tempDir, FRAMEWORK_CONFIG_PATH));
  } finally {
    try {
      git('worktree', 'remove', '--force', tempDir);
    } catch {}
    rmSync(tempDir, { recursive: true, force: true });
  }

  let failed = reportFrameworkVocabulary(
    headDiagnostics,
    baseDiagnostics,
    headConfig,
    baseConfig,
    fullScan || list,
  );
  failed =
    reportDelta(
      'casts',
      compareDiagnostics(headDiagnostics, baseDiagnostics, filterNoBarecastDiags),
      (delta) =>
        `lint:casts: ${delta} new bare \`as\` cast(s) introduced. Replace with blindCast<T, "reason">(...) or castAs<T>(value):`,
    ) || failed;
  failed =
    reportDelta(
      'throws',
      compareDiagnostics(headDiagnostics, baseDiagnostics, filterNoBareThrowDiags),
      (delta) =>
        `lint:throws: ${delta} new bare \`throw new Error(...)\` introduced. Use structuredError(...) for user-facing errors, or InternalError/assertNever for bugs:`,
    ) || failed;

  if (failed) process.exit(1);
}

if (process.argv[1] === import.meta.filename) main();
