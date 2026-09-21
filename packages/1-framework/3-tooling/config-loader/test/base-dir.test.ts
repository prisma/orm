import { baseDir } from '@internal/config/config-base-dir';
import { describe, expect, it } from 'vitest';
import { withBaseDir } from '../src/base-dir';

describe('withBaseDir', () => {
  it('publishes the directory while the evaluation runs and clears it after', async () => {
    let seen: string | undefined;

    await withBaseDir('/app', async () => {
      seen = baseDir();
    });

    expect(seen).toBe('/app');
    expect(baseDir()).toBeUndefined();
  });

  it('restores the outer directory for a nested evaluation', async () => {
    let inner: string | undefined;
    let afterInner: string | undefined;

    await withBaseDir('/outer', async () => {
      await withBaseDir('/inner', async () => {
        inner = baseDir();
      });
      afterInner = baseDir();
    });

    expect({ inner, afterInner }).toEqual({ inner: '/inner', afterInner: '/outer' });
  });

  it('keeps two overlapping evaluations apart', async () => {
    let seenA: string | undefined;
    let seenB: string | undefined;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await Promise.all([
      withBaseDir('/a', async () => {
        await gate;
        seenA = baseDir();
      }),
      withBaseDir('/b', async () => {
        release();
        seenB = baseDir();
      }),
    ]);

    expect({ seenA, seenB }).toEqual({ seenA: '/a', seenB: '/b' });
  });

  it('clears the directory when the evaluation throws', async () => {
    await expect(
      withBaseDir('/app', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(baseDir()).toBeUndefined();
  });
});
