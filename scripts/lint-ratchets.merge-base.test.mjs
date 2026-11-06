import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execPath } from 'node:process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { filterNoBareCastDiags, filterNoBareThrowDiags } from './lint-ratchets.mjs';

const SCRIPT_PATH = join(fileURLToPath(new URL('.', import.meta.url)), 'lint-ratchets.mjs');

const FILE_WITH_CAST = 'declare const value: unknown;\nexport const x = value as string;\n';
const FILE_WITH_THROW = 'export function fail() {\n  throw new Error("bad");\n}\n';
const FILE_CLEAN = 'export const x = 1;\n';

const MERGE_BASE_RATCHETS = [
  {
    plugin: 'no-bare-cast',
    offendingFile: FILE_WITH_CAST,
    advice: /blindCast|castAs/,
  },
  {
    plugin: 'no-bare-throw',
    offendingFile: FILE_WITH_THROW,
    advice: /structuredError|InternalError/,
  },
];

let repo;

function git(...args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function writeRepoFile(relPath, content) {
  const full = join(repo, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function commitAll(message) {
  git('add', '-A');
  git('commit', '-m', message);
}

function setOriginMain(sha) {
  git('update-ref', 'refs/remotes/origin/main', sha);
}

function commitBase(files) {
  for (const [path, content] of Object.entries(files)) writeRepoFile(path, content);
  commitAll('base');
  setOriginMain(git('rev-parse', 'HEAD'));
}

function commitFeature(files) {
  for (const [path, content] of Object.entries(files)) writeRepoFile(path, content);
  commitAll('feature');
}

function runScript(...args) {
  return spawnSync(execPath, [SCRIPT_PATH, ...args], { cwd: repo, encoding: 'utf-8' });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pn-lint-ratchets-'));
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  writeRepoFile(
    'scripts/framework-vocabulary-thresholds.json',
    JSON.stringify({ scopes: [{ path: 'packages/1-framework', threshold: 0 }] }),
  );
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('filterNoBareCastDiags', () => {
  it('keeps plugin diagnostics with the no-bare-cast prefix', () => {
    const kept = filterNoBareCastDiags([
      { category: 'plugin', message: 'no-bare-cast: bare `as` cast' },
      { category: 'lint', message: 'no-bare-cast: wrong category' },
      { category: 'plugin', message: 'no-bare-throw: a different plugin' },
    ]);
    assert.deepEqual(kept, [{ category: 'plugin', message: 'no-bare-cast: bare `as` cast' }]);
  });

  it('returns empty array when no diagnostics match', () => {
    assert.deepEqual(filterNoBareCastDiags([]), []);
    assert.deepEqual(filterNoBareCastDiags([{ category: 'lint', message: 'x' }]), []);
  });
});

describe('filterNoBareThrowDiags', () => {
  it('keeps plugin diagnostics with the no-bare-throw prefix', () => {
    const kept = filterNoBareThrowDiags([
      { category: 'plugin', message: 'no-bare-throw: bare throw' },
      { category: 'lint', message: 'no-bare-throw: wrong category' },
      { category: 'plugin', message: 'no-bare-cast: a different plugin' },
    ]);
    assert.deepEqual(kept, [{ category: 'plugin', message: 'no-bare-throw: bare throw' }]);
  });

  it('does not count plugin fixtures, repo tooling scripts, or published upgrade codemods', () => {
    const at = (path) => ({ category: 'plugin', message: 'no-bare-throw: x', location: { path } });
    const kept = filterNoBareThrowDiags([
      at('biome-plugins/fixtures/throw-positive.ts'),
      at('scripts/lint-ratchets.mjs'),
      at('scripts/bump-version.ts'),
      at('skills/prisma-8/upgrading/app/upgrades/0.9-to-0.10/codemod.ts'),
      at('packages/x/src/scripts.ts'),
      at('packages/x/src/thing.ts'),
    ]);
    assert.deepEqual(
      kept.map((d) => d.location.path),
      ['packages/x/src/scripts.ts', 'packages/x/src/thing.ts'],
    );
  });
});

describe('lint-ratchets — merge-base ratchets', () => {
  it('skips the merge-base ratchets when HEAD is at the merge base', () => {
    commitBase({ 'src/app.ts': FILE_WITH_CAST + FILE_WITH_THROW });

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /HEAD is at the merge base/);
  });

  it('fails when origin/main is not available, after still reporting the vocabulary count', () => {
    writeRepoFile('src/app.ts', FILE_CLEAN);
    commitAll('base');

    const result = runScript();
    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /no-family-vocabulary scope=packages\/1-framework count=0 threshold=0/,
    );
    assert.match(result.stderr, /origin\/main is not available/);
  });

  it('reports a vocabulary failure and a cast failure from the same run', () => {
    commitBase({ 'src/app.ts': FILE_CLEAN });
    commitFeature({
      'src/cast.ts': FILE_WITH_CAST,
      'packages/1-framework/src/app.ts': "export const nativeType = 'int4';\n",
    });

    const result = runScript();
    assert.equal(result.status, 1, `expected exit 1; stdout=${result.stdout}`);
    assert.match(
      result.stdout,
      /no-family-vocabulary scope=packages\/1-framework count=1 threshold=0/,
    );
    assert.match(result.stdout, /no-bare-cast current=1 merge-base=0 delta=\+1/);
  });

  it('skips the merge-base ratchets under --list', () => {
    commitBase({ 'src/app.ts': FILE_CLEAN });
    commitFeature({ 'src/cast.ts': FILE_WITH_CAST });

    const result = runScript('--list');
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.doesNotMatch(result.stdout, /no-bare-cast/);
  });

  it('reports a new cast and a new throw from the same run', () => {
    commitBase({ 'src/app.ts': FILE_CLEAN });
    commitFeature({ 'src/cast.ts': FILE_WITH_CAST, 'src/throw.ts': FILE_WITH_THROW });

    const result = runScript();
    assert.equal(result.status, 1, `expected exit 1; stdout=${result.stdout}`);
    assert.match(result.stdout, /no-bare-cast current=1 merge-base=0 delta=\+1/);
    assert.match(result.stdout, /no-bare-throw current=1 merge-base=0 delta=\+1/);
    assert.match(result.stderr, /src\/cast\.ts:2/);
    assert.match(result.stderr, /src\/throw\.ts:2/);
  });

  for (const { plugin, offendingFile, advice } of MERGE_BASE_RATCHETS) {
    describe(plugin, () => {
      it('passes and reports delta=0 when the count is unchanged', () => {
        commitBase({ 'src/app.ts': offendingFile });
        commitFeature({ 'src/other.ts': FILE_CLEAN });

        const result = runScript();
        assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
        assert.match(result.stdout, new RegExp(`${plugin} current=1 merge-base=1 delta=0`));
      });

      it('passes and reports a negative delta when a site is removed', () => {
        commitBase({ 'src/app.ts': offendingFile });
        commitFeature({ 'src/app.ts': FILE_CLEAN });

        const result = runScript();
        assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
        assert.match(result.stdout, new RegExp(`${plugin} current=0 merge-base=1 delta=-1`));
      });

      it('fails, lists the new site as file:line and names the fix', () => {
        commitBase({ 'src/app.ts': FILE_CLEAN });
        commitFeature({ 'src/app.ts': offendingFile });

        const result = runScript();
        assert.equal(result.status, 1, `expected exit 1; stdout=${result.stdout}`);
        assert.match(result.stdout, new RegExp(`${plugin} current=1 merge-base=0 delta=\\+1`));
        assert.match(result.stderr, /src\/app\.ts:2/);
        assert.match(result.stderr, advice);
      });
    });
  }

  it('leaves no stray worktrees after a run', () => {
    commitBase({ 'src/app.ts': FILE_CLEAN });
    commitFeature({ 'src/other.ts': FILE_CLEAN });

    runScript();

    const worktrees = git('worktree', 'list', '--porcelain')
      .split('\n')
      .filter((line) => line.startsWith('worktree '));
    assert.equal(worktrees.length, 1, `expected 1 worktree; got:\n${worktrees.join('\n')}`);
  });
});
