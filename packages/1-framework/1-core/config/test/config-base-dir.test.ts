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

  it('is the shared slot any loader can set without importing this package', async () => {
    const slot = globalThis as { [BASE_DIR_KEY]?: string };
    slot[Symbol.for('prisma.config.baseDir') as typeof BASE_DIR_KEY] = '/elsewhere';

    expect(baseDir()).toBe('/elsewhere');

    delete slot[BASE_DIR_KEY];
  });
});
