import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempDisposableSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const guardPath = join(dirname(fileURLToPath(import.meta.url)), 'guard-review-artifacts-ignored.mjs');

const FAKE_JJ_SCRIPT = `#!/bin/sh
case "$*" in
  "workspace root --ignore-working-copy") ;;
  *) echo "fake jj: unexpected args: $*" >&2; exit 2 ;;
esac
if [ -z "$FAKE_JJ_WORKSPACE_ROOT" ]; then
  echo 'Error: There is no jj repo in "."' >&2
  exit 1
fi
printf '%s\\n' "$FAKE_JJ_WORKSPACE_ROOT"
`;

let tempRoot;
let workspaceRoot;
let outsideRoot;
let fakeWorkspaceRoot;
let wipLinkWorkspaceRoot;
let fakeJjBinDir;

function runGuard(dir, { jjRoot = workspaceRoot, cwd = workspaceRoot } = {}) {
  return spawnSync(process.execPath, [guardPath, '--dir', dir], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeJjBinDir}${delimiter}${process.env.PATH}`,
      FAKE_JJ_WORKSPACE_ROOT: jjRoot ?? '',
    },
  });
}

describe('guard-review-artifacts-ignored in a jj workspace without git', () => {
  before(() => {
    tempRoot = mkdtempDisposableSync(join(tmpdir(), 'guard-review-'));
    const base = realpathSync(tempRoot.path);
    workspaceRoot = join(base, 'workspace');
    outsideRoot = join(base, 'outside');
    fakeWorkspaceRoot = join(base, 'fake-workspace');
    fakeJjBinDir = join(base, 'bin');
    wipLinkWorkspaceRoot = join(base, 'wip-link-workspace');
    mkdirSync(join(workspaceRoot, 'wip', 'reviews', 'x'), { recursive: true });
    mkdirSync(join(workspaceRoot, 'docs'), { recursive: true });
    mkdirSync(join(outsideRoot, 'reviews'), { recursive: true });
    mkdirSync(join(fakeWorkspaceRoot, '.jj'), { recursive: true });
    mkdirSync(join(fakeWorkspaceRoot, 'wip', 'reviews'), { recursive: true });
    mkdirSync(join(wipLinkWorkspaceRoot, 'docs', 'reviews'), { recursive: true });
    mkdirSync(fakeJjBinDir, { recursive: true });
    writeFileSync(join(fakeJjBinDir, 'jj'), FAKE_JJ_SCRIPT, { mode: 0o755 });
    symlinkSync(outsideRoot, join(workspaceRoot, 'wip', 'escape'), 'dir');
    symlinkSync(join(base, 'nonexistent'), join(workspaceRoot, 'wip', 'dangling'), 'dir');
    symlinkSync(join(wipLinkWorkspaceRoot, 'docs'), join(wipLinkWorkspaceRoot, 'wip'), 'dir');
  });

  after(() => {
    tempRoot.remove();
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

  it('rejects a path through a dangling symlink under wip/', () => {
    const result = runGuard(join(workspaceRoot, 'wip', 'dangling', 'reviews'));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ENOENT/);
  });

  it('rejects an artifact dir when wip itself is a symlink to a non-ignored directory', () => {
    const result = runGuard(join(wipLinkWorkspaceRoot, 'wip', 'reviews'), {
      jjRoot: wipLinkWorkspaceRoot,
      cwd: wipLinkWorkspaceRoot,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must live under the ignored wip\/ tree/);
  });

  it('fails with ENOENT for a missing output path', () => {
    const result = runGuard(join(workspaceRoot, 'wip', 'reviews', 'missing'));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ENOENT/);
  });

  it('rejects a directory under another workspace marked only by a .jj directory', () => {
    const result = runGuard(join(fakeWorkspaceRoot, 'wip', 'reviews'));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must stay inside the workspace/);
  });

  it('fails when jj reports no workspace for the working directory', () => {
    const result = runGuard(join(workspaceRoot, 'wip', 'reviews', 'x'), { jjRoot: null });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not in a git repository or a jj workspace/);
  });
});
