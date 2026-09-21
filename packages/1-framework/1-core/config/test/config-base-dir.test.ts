import type { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it } from 'vitest';
import { BASE_DIR_KEY, baseDir, withBaseDir } from '../src/config-base-dir';

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

  it('clears the directory when the evaluation throws', async () => {
    await expect(
      withBaseDir('/app', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(baseDir()).toBeUndefined();
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

  it('is one store any loader can publish through without importing this package', async () => {
    const shared = (globalThis as { [BASE_DIR_KEY]?: AsyncLocalStorage<string> })[
      Symbol.for('prisma.config.baseDir') as typeof BASE_DIR_KEY
    ];
    if (shared === undefined) throw new Error('store not published');

    await shared.run('/elsewhere', async () => {
      expect(baseDir()).toBe('/elsewhere');
    });
  });
});
