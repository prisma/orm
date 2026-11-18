import { deepStrictEqual, rejects, strictEqual, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArguments, withRetries } from './retry-command.mjs';

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
      { result: 'mongod', calls: 3, cleanups: 2, waits: [10, 20] },
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

describe('parseArguments', () => {
  it('reads the options and the command after the separator', () => {
    deepStrictEqual(
      parseArguments([
        '--attempts',
        '4',
        '--before-retry',
        'supabase stop',
        '--',
        'supabase',
        'start',
        '--debug',
      ]),
      {
        attempts: 4,
        beforeRetry: 'supabase stop',
        command: 'supabase',
        args: ['start', '--debug'],
      },
    );
  });

  it('defaults to three attempts and no cleanup', () => {
    deepStrictEqual(parseArguments(['--', 'pnpm', 'db:up']), {
      attempts: 3,
      beforeRetry: undefined,
      command: 'pnpm',
      args: ['db:up'],
    });
  });

  it('rejects a missing command, an unknown option and a bad attempt count', () => {
    throws(() => parseArguments(['supabase', 'start']), /Usage/);
    throws(() => parseArguments(['--']), /Usage/);
    throws(() => parseArguments(['--tries', '2', '--', 'x']), /Unknown option --tries/);
    throws(() => parseArguments(['--attempts', '0', '--', 'x']), /positive whole number/);
    throws(() => parseArguments(['--attempts', '--', 'x']), /--attempts needs a value/);
  });
});
