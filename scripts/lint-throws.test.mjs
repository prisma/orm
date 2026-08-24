import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execPath } from 'node:process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { filterNoBareThrowDiags } from './lint-throws.mjs';

const SCRIPT_PATH = join(fileURLToPath(new URL('.', import.meta.url)), 'lint-throws.mjs');

// A single bare `throw new Error(...)` that the plugin recognises.
const FILE_WITH_THROW = 'export function fail() {\n  throw new Error("bad");\n}\n';
// No bare throws.
const FILE_WITHOUT_THROW = 'export const x = 1;\n';

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
  // Materialize refs/remotes/origin/main without needing a real remote.
  git('update-ref', 'refs/remotes/origin/main', sha);
}

function runScript() {
  return spawnSync(execPath, [SCRIPT_PATH], { cwd: repo, encoding: 'utf-8' });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pn-lint-throws-'));
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('filterNoBareThrowDiags', () => {
  it('keeps plugin diagnostics with the no-bare-throw prefix', () => {
    const diags = [
      { category: 'plugin', message: 'no-bare-throw: bare `throw new Error(...)`' },
      { category: 'lint', message: 'no-bare-throw: should be ignored' },
      { category: 'plugin', message: 'other-plugin: something else' },
    ];
    const kept = filterNoBareThrowDiags(diags);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].category, 'plugin');
    assert.match(kept[0].message, /^no-bare-throw:/);
  });

  it('returns empty array when no diagnostics match', () => {
    assert.deepEqual(filterNoBareThrowDiags([]), []);
    assert.deepEqual(filterNoBareThrowDiags([{ category: 'lint', message: 'something' }]), []);
  });

  it('does not count plugin fixtures, repo tooling scripts, or published upgrade codemods', () => {
    const msg = 'no-bare-throw: bare `throw new Error(...)`';
    const diags = [
      {
        category: 'plugin',
        message: msg,
        location: { path: 'biome-plugins/fixtures/throw-positive.ts' },
      },
      { category: 'plugin', message: msg, location: { path: 'scripts/lint-throws.mjs' } },
      { category: 'plugin', message: msg, location: { path: 'scripts/bump-version.ts' } },
      {
        category: 'plugin',
        message: msg,
        location: { path: 'skills/prisma-8/upgrading/app/upgrades/0.9-to-0.10/codemod.ts' },
      },
      { category: 'plugin', message: msg, location: { path: 'packages/x/src/scripts.ts' } },
      { category: 'plugin', message: msg, location: { path: 'packages/x/src/thing.ts' } },
    ];
    const kept = filterNoBareThrowDiags(diags);
    assert.deepEqual(
      kept.map((d) => d.location.path),
      ['packages/x/src/scripts.ts', 'packages/x/src/thing.ts'],
    );
  });
});

describe('lint-throws — skip on main', () => {
  it('exits 0 and prints a skip message when HEAD is at merge-base', () => {
    writeRepoFile('src/app.ts', FILE_WITHOUT_THROW);
    commitAll('initial');
    setOriginMain(git('rev-parse', 'HEAD'));
    // HEAD == merge-base → should skip
    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /Skipping/i);
  });
});

describe('lint-throws — zero delta', () => {
  it('exits 0 and reports delta=0 when throw count is unchanged', () => {
    writeRepoFile('src/app.ts', FILE_WITH_THROW);
    commitAll('base: one throw');
    setOriginMain(git('rev-parse', 'HEAD'));

    writeRepoFile('src/other.ts', FILE_WITHOUT_THROW);
    commitAll('feature: add unrelated file');

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /delta=0/);
  });
});

describe('lint-throws — negative delta', () => {
  it('exits 0 and reports a negative delta when a throw is removed', () => {
    writeRepoFile('src/app.ts', FILE_WITH_THROW);
    commitAll('base: one throw');
    setOriginMain(git('rev-parse', 'HEAD'));

    writeRepoFile('src/app.ts', FILE_WITHOUT_THROW);
    commitAll('feature: remove throw');

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /delta=-1/);
  });
});

describe('lint-throws — positive delta', () => {
  it('exits 1 and prints added site(s) when a bare throw is introduced', () => {
    writeRepoFile('src/app.ts', FILE_WITHOUT_THROW);
    commitAll('base: no throws');
    setOriginMain(git('rev-parse', 'HEAD'));

    writeRepoFile('src/app.ts', FILE_WITH_THROW);
    commitAll('feature: add throw');

    const result = runScript();
    assert.equal(result.status, 1, `expected exit 1; stdout=${result.stdout}`);
    assert.match(result.stdout, /delta=\+1/);
    assert.match(result.stderr, /no-bare-throw|throw new Error/i);
    assert.match(result.stderr, /structuredError|InternalError/);
  });

  it('lists each new throw site with file:line', () => {
    writeRepoFile('src/app.ts', FILE_WITHOUT_THROW);
    commitAll('base: no throws');
    setOriginMain(git('rev-parse', 'HEAD'));

    writeRepoFile('src/app.ts', FILE_WITH_THROW);
    commitAll('feature: add throw');

    const result = runScript();
    assert.equal(result.status, 1);
    // The throw is on line 2 of FILE_WITH_THROW
    assert.match(result.stderr, /src\/app\.ts:2/);
  });
});

describe('lint-throws — worktree cleanup', () => {
  it('leaves no stray worktrees after a successful run', () => {
    writeRepoFile('src/app.ts', FILE_WITHOUT_THROW);
    commitAll('base');
    setOriginMain(git('rev-parse', 'HEAD'));
    writeRepoFile('src/other.ts', FILE_WITHOUT_THROW);
    commitAll('feature');

    runScript();

    const worktreeList = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repo,
      encoding: 'utf-8',
    });
    // Only the main worktree should remain (one `worktree <path>` entry)
    const worktreeCount = worktreeList.split('\n').filter((l) => l.startsWith('worktree ')).length;
    assert.equal(worktreeCount, 1, `expected 1 worktree; got:\n${worktreeList}`);
  });
});
