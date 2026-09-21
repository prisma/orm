import { AsyncLocalStorage } from 'node:async_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { BASE_DIR_KEY, baseDir } from '../src/config-base-dir';

type Slot = { [BASE_DIR_KEY]?: AsyncLocalStorage<string> };

afterEach(() => {
  delete (globalThis as Slot)[BASE_DIR_KEY];
});

describe('baseDir', () => {
  it('is undefined when no loader has published a store', () => {
    expect(baseDir()).toBeUndefined();
  });

  it('reads the directory a loader published through the shared store', async () => {
    const store = new AsyncLocalStorage<string>();
    (globalThis as Slot)[BASE_DIR_KEY] = store;

    await store.run('/app', async () => {
      expect(baseDir()).toBe('/app');
    });
    expect(baseDir()).toBeUndefined();
  });

  it('reaches a store published under the key by a loader that never imported this package', async () => {
    const store = new AsyncLocalStorage<string>();
    (globalThis as { [key: symbol]: unknown })[Symbol.for('prisma.config.baseDir')] = store;

    await store.run('/elsewhere', async () => {
      expect(baseDir()).toBe('/elsewhere');
    });
  });
});
