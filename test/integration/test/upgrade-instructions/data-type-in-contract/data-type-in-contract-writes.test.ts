import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { timeouts } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appScript,
  copyFixture,
  expectedTree,
  type Run,
  readTree,
  removeWorkDirs,
  runScript,
} from './test-helpers';

afterAll(removeWorkDirs);

describe('a run that stops partway', () => {
  const failAtWrite = join(dirname(fileURLToPath(import.meta.url)), 'fail-at-write.ts');

  function runFailingAt(root: string, failAt: number): Run {
    const result = spawnSync(process.execPath, ['--import', failAtWrite, appScript, root], {
      encoding: 'utf8',
      env: { ...process.env, FAIL_AT_WRITE: String(failAt) },
    });
    return { root, status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  for (const name of [
    'postgres-extension-space',
    'snapshot-already-present',
    'two-migration-roots',
  ]) {
    it(`leaves ${name} in a state a second run finishes, whichever write fails`, {
      timeout: timeouts.repeatedScriptRuns,
    }, () => {
      const expected = expectedTree(name, 'after');
      const outcomes: { failAt: number; first: unknown; second: unknown }[] = [];
      for (let failAt = 1; ; failAt++) {
        const first = runFailingAt(copyFixture(name, 'before'), failAt);
        if (first.status === 0) break;
        const second = runScript(first.root);
        outcomes.push({
          failAt,
          first: { status: first.status, stderr: first.stderr },
          second: { status: second.status, stderr: second.stderr, tree: readTree(second.root) },
        });
      }
      expect(outcomes.length).toBeGreaterThan(2);
      expect(outcomes).toEqual(
        outcomes.map(({ failAt }) => ({
          failAt,
          first: {
            status: 1,
            stderr: `injected failure at write ${failAt}; the upgrade stopped partway, run the script again to finish it\n`,
          },
          second: { status: 0, stderr: '', tree: expected },
        })),
      );
    });
  }
});

describe('a file the script rewrites', () => {
  it('keeps its file mode', () => {
    const root = copyFixture('postgres-extension-space', 'before');
    const path = join(root, 'migrations/app/20260101T0000_initial/migration.ts');
    chmodSync(path, 0o755);
    const run = runScript(root);
    expect({ status: run.status, mode: statSync(path).mode & 0o777 }).toEqual({
      status: 0,
      mode: 0o755,
    });
  });
});

describe('a contract.json that is not valid JSON', () => {
  it('names the file, changes no file and exits 1', () => {
    const root = copyFixture('postgres-extension-space', 'before');
    const path = join(root, 'prisma/contract.json');
    writeFileSync(path, readFileSync(path, 'utf8').slice(0, 100));
    const before = readTree(root);
    const run = runScript(root);
    expect({ status: run.status, stderr: run.stderr, tree: readTree(root) }).toEqual({
      status: 1,
      stderr: 'prisma/contract.json: not valid JSON\n',
      tree: before,
    });
  });
});
