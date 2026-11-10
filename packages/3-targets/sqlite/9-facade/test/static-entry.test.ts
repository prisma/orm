import { timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadsNodeSqlite(entry: () => Promise<unknown>): Promise<boolean> {
  const loaded = vi.fn();
  vi.resetModules();
  vi.doMock('node:sqlite', async (importOriginal) => {
    loaded();
    return importOriginal();
  });
  await entry();
  return loaded.mock.calls.length > 0;
}

afterEach(() => {
  vi.doUnmock('node:sqlite');
  vi.resetModules();
});

describe('the static entry', () => {
  it(
    'does not load node:sqlite',
    async () => {
      expect(await loadsNodeSqlite(() => import('../src/exports/static'))).toBe(false);
    },
    timeouts.coldTransformImport,
  );

  it(
    'is not the runtime entry, which loads node:sqlite',
    async () => {
      expect(await loadsNodeSqlite(() => import('../src/exports/runtime'))).toBe(true);
    },
    timeouts.coldTransformImport,
  );
});
