import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { snapshotDiagnostics, snapshotFiles } from './check-snapshot-types.mjs';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const SNAPSHOT = 'packages/app/migrations/snapshots/abc/contract.d.ts';

let repo;

function write(relPath, content) {
  const full = join(repo, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function commitAll() {
  execFileSync('git', ['add', '-A'], { cwd: repo });
}

describe('check-snapshot-types', () => {
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'check-snapshot-types-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    write(
      'packages/app/tsconfig.json',
      JSON.stringify({ compilerOptions: { skipLibCheck: true } }),
    );
    write('packages/app/src/types.ts', 'export type Id = string;\n');
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('reports a snapshot import that resolves to nothing, though the package skips declaration checks', () => {
    write(SNAPSHOT, "import type { Id } from './types';\nexport type Contract = { id: Id };\n");
    commitAll();

    const problems = snapshotDiagnostics(repo);

    assert.equal(problems.length, 1);
    assert.match(
      problems[0],
      /^packages\/app\/migrations\/snapshots\/abc\/contract\.d\.ts:1: Cannot find module '\.\/types'/,
    );
  });

  it('passes a snapshot whose imports resolve and whose types check', () => {
    write(
      SNAPSHOT,
      "import type { Id } from '../../../src/types';\nexport type Contract = { id: Id };\n",
    );
    commitAll();

    assert.deepEqual(snapshotDiagnostics(repo), []);
  });

  it('ignores a contract.d.ts outside a snapshot folder', () => {
    write('packages/app/src/contract.d.ts', "import type { Id } from './missing';\n");
    write(SNAPSHOT, 'export type Contract = { id: string };\n');
    commitAll();

    assert.deepEqual(snapshotDiagnostics(repo), []);
  });

  it('fails when it finds no snapshot to check', () => {
    commitAll();

    assert.equal(snapshotDiagnostics(repo).length, 1);
    assert.match(snapshotDiagnostics(repo)[0], /no snapshot declaration files found/);
  });
});

describe('the snapshot declarations under packages/ in this repository', () => {
  it('typecheck with their imports resolved', () => {
    assert.ok(snapshotFiles(REPO_ROOT).length > 0);
    assert.deepEqual(snapshotDiagnostics(REPO_ROOT), []);
  });
});
