import { timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadsPg(entry: () => Promise<unknown>): Promise<boolean> {
  const loaded = vi.fn();
  vi.resetModules();
  vi.doMock('pg', async (importOriginal) => {
    loaded();
    return importOriginal();
  });
  await entry();
  return loaded.mock.calls.length > 0;
}

afterEach(() => {
  vi.doUnmock('pg');
  vi.resetModules();
});

describe('the static entry', () => {
  it(
    'does not load pg',
    async () => {
      expect(await loadsPg(() => import('../src/exports/static'))).toBe(false);
    },
    timeouts.coldTransformImport,
  );

  it(
    'is not the runtime entry, which loads pg',
    async () => {
      expect(await loadsPg(() => import('../src/exports/runtime'))).toBe(true);
    },
    timeouts.coldTransformImport,
  );
});
