import { describe, expect, it } from 'vitest';

import { callbackToPromise } from '../src/callback-to-promise';

describe('callbackToPromise', () => {
  it('resolves with result on success', async () => {
    const result = await callbackToPromise<number>((cb) => {
      cb(null, 42);
    });
    expect(result).toBe(42);
  });

  it('rejects with error on failure', async () => {
    const error = new Error('test error');
    await expect(
      callbackToPromise<number>((cb) => {
        cb(error, 0);
      }),
    ).rejects.toThrow('test error');
  });

  it('resolves void on success', async () => {
    await expect(
      callbackToPromise((cb) => {
        cb(null);
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects void with error on failure', async () => {
    const error = new Error('test error');
    await expect(
      callbackToPromise((cb) => {
        cb(error);
      }),
    ).rejects.toThrow('test error');
  });
});
