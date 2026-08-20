import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const guardPath = join(dirname(fileURLToPath(import.meta.url)), 'guard-review-artifacts-ignored.mjs');

let workspaceRoot;
let outsideRoot;

function runGuard(dir) {
  return spawnSync(process.execPath, [guardPath, '--dir', dir], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  });
}

describe('guard-review-artifacts-ignored in a jj workspace without git', () => {
  before(() => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'guard-review-')));
    workspaceRoot = join(base, 'workspace');
    outsideRoot = join(base, 'outside');
    mkdirSync(join(workspaceRoot, '.jj'), { recursive: true });
    mkdirSync(join(workspaceRoot, 'wip', 'reviews', 'x'), { recursive: true });
    mkdirSync(join(workspaceRoot, 'docs'), { recursive: true });
    mkdirSync(outsideRoot, { recursive: true });
    symlinkSync(outsideRoot, join(workspaceRoot, 'wip', 'escape'), 'dir');
  });

  after(() => {
    rmSync(dirname(workspaceRoot), { recursive: true, force: true });
  });

  it('accepts a directory under the ignored wip/ tree', () => {
    const result = runGuard(join(workspaceRoot, 'wip', 'reviews', 'x'));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ok: review artifacts are under the ignored wip\/ tree/);
  });

  it('rejects a directory outside the wip/ tree', () => {
    const result = runGuard(join(workspaceRoot, 'docs'));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must live under the ignored wip\/ tree/);
  });

  it('rejects a path that a symlink under wip/ points outside the workspace', () => {
    const result = runGuard(join(workspaceRoot, 'wip', 'escape', 'reviews'));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /outside/);
  });
});
