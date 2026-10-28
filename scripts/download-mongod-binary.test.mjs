import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { removeLockFiles, withRetries } from './download-mongod-binary.mjs';

function failingTimes(failures, result) {
  let calls = 0;
  const attempt = async () => {
    calls++;
    if (calls <= failures) throw new Error(`failure ${calls}`);
    return result;
  };
  return { attempt, calls: () => calls };
}

describe('withRetries', () => {
  it('returns the result of the first attempt that succeeds', async () => {
    const { attempt, calls } = failingTimes(2, 'mongod');
    const waits = [];
    let cleanups = 0;
    const result = await withRetries(attempt, {
      attempts: 4,
      delayMs: 10,
      beforeRetry: () => cleanups++,
      wait: async (ms) => waits.push(ms),
    });
    deepStrictEqual(
      { result, calls: calls(), cleanups, waits },
      {
        result: 'mongod',
        calls: 3,
        cleanups: 2,
        waits: [10, 20],
      },
    );
  });

  it('throws the last error once every attempt fails', async () => {
    const { attempt, calls } = failingTimes(10, 'mongod');
    await rejects(
      withRetries(attempt, {
        attempts: 3,
        delayMs: 0,
        beforeRetry: () => {},
        wait: async () => {},
      }),
      /failure 3/,
    );
    strictEqual(calls(), 3);
  });
});

describe('removeLockFiles', () => {
  it('removes lock files and keeps binaries', () => {
    const folder = mkdtempSync(join(tmpdir(), 'mongod-binaries-'));
    writeFileSync(join(folder, '8.2.6.lock'), '');
    writeFileSync(join(folder, 'mongod-x64-ubuntu-8.2.6'), '');
    mkdirSync(join(folder, 'nested.lock'));
    removeLockFiles(folder);
    deepStrictEqual(readdirSync(folder).sort(), ['mongod-x64-ubuntu-8.2.6', 'nested.lock']);
  });

  it('does nothing when the folder does not exist', () => {
    removeLockFiles(join(tmpdir(), 'mongod-binaries-missing-folder'));
  });
});
