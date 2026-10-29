import type { Contract } from '@internal/contract/types';
import { coreHash } from '@internal/contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { isStructuredError } from '@internal/utils/structured-error';
import { createContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import sqlite from '../src/runtime/sqlite';

const contract: Contract<SqlStorage> = createContract<SqlStorage>({
  target: 'sqlite',
  storage: new SqlStorage({
    storageHash: coreHash('sqlite-structured-errors-test'),
    namespaces: {
      __unbound__: sqliteCreateNamespace({ id: '__unbound__', entries: { table: {} } }),
    },
  }),
});

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

async function captureAsync(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to reject');
}

describe('sqlite facade structured errors', () => {
  it('runtime() after close() raises DRIVER.NOT_CONNECTED', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.close();

    const error = capture(() => db.runtime());
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
      message: 'SQLite client is closed',
      meta: { extension: 'sqlite' },
    });
  });

  it('connect() after close() raises DRIVER.NOT_CONNECTED', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.close();

    const error = await captureAsync(() => db.connect({ path: ':memory:' }));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
      message: 'SQLite client is closed',
      meta: { extension: 'sqlite' },
    });
  });

  it('connect() on a connected client raises DRIVER.ALREADY_CONNECTED', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    const error = await captureAsync(() => db.connect({ path: ':memory:' }));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'DRIVER.ALREADY_CONNECTED',
      message: 'SQLite client is already bound',
      meta: { extension: 'sqlite' },
    });

    await db.close();
  });

  it('connect() with no binding configured raises RUNTIME.BINDING_MISSING', async () => {
    const db = sqlite({ contract });

    const error = await captureAsync(() => db.connect());
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.BINDING_MISSING',
      message:
        'SQLite binding not configured. Pass path to sqlite(...) or call db.connect({ path }).',
      meta: { extension: 'sqlite' },
    });
  });
});
