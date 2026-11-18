import { timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadsMongodb(entry: () => Promise<unknown>): Promise<boolean> {
  const loaded = vi.fn();
  vi.resetModules();
  vi.doMock('mongodb', async (importOriginal) => {
    loaded();
    return importOriginal();
  });
  await entry();
  return loaded.mock.calls.length > 0;
}

afterEach(() => {
  vi.doUnmock('mongodb');
  vi.resetModules();
});

describe('the static entry', () => {
  it(
    'does not load mongodb',
    async () => {
      expect(await loadsMongodb(() => import('../src/exports/static'))).toBe(false);
    },
    timeouts.coldTransformImport,
  );

  it(
    'is not the runtime entry, which loads mongodb',
    async () => {
      expect(await loadsMongodb(() => import('../src/exports/runtime'))).toBe(true);
    },
    timeouts.coldTransformImport,
  );
});
