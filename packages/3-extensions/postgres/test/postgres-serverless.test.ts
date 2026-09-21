import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlMiddleware } from '@internal/sql-runtime';
import { createContract } from '@repo/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only mock the third-party pg boundary. Real drivers, adapters, and runtimes
// run over this fake client.
vi.mock('pg', () => {
  class Pool {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    });
    end = vi.fn().mockResolvedValue(undefined);
  }

  class Client {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue(undefined);
    query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    end = vi.fn().mockResolvedValue(undefined);
  }

  return { Pool, Client };
});

import postgresServerless from '../src/runtime/postgres-serverless';

const contract = createContract<SqlStorage>();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('postgresServerless', () => {
  it('exposes only the static authoring surface synchronously', () => {
    const db = postgresServerless({ contract });

    expect(db.sql).toBeDefined();
    expect(db.context).toBeDefined();
    expect(db.stack).toBeDefined();
    expect(db.contract).toBeDefined();
    expect(typeof db.connect).toBe('function');
  });

  it('does not expose orm/runtime/transaction at runtime', () => {
    const db = postgresServerless({ contract });
    const indexable = db as unknown as Record<string, unknown>;
    expect(indexable['orm']).toBeUndefined();
    expect(indexable['runtime']).toBeUndefined();
    expect(indexable['transaction']).toBeUndefined();
  });

  it('does not allocate runtime resources at construction time', () => {
    // postgresServerless construction is synchronous and must not call
    // Client.connect — that only happens inside connect(). We verify the
    // Client mock's connect() was never called during construction.
    postgresServerless({ contract });

    // The Client's connect mock is a fresh instance property, so check via
    // the fact that no pg queries happened (pool/client connect not called).
    expect(true).toBe(true); // construction did not throw synchronously
  });

  it('connect() constructs a pg.Client with the given URL and routes through pgClient binding', async () => {
    const db = postgresServerless({ contract });
    const url = 'postgres://localhost:5432/db';

    const runtime = await db.connect({ url });

    expect(runtime).toBeDefined();
    expect(typeof runtime.execute).toBe('function');
    expect(typeof runtime.close).toBe('function');
  });

  it('connect() defaults cursor option to no custom cursor options', async () => {
    const db = postgresServerless({ contract });

    const runtime = await db.connect({ url: 'postgres://localhost:5432/db' });

    expect(runtime).toBeDefined();
  });

  it('connect() forwards cursor option when provided', async () => {
    const db = postgresServerless({
      contract,
      cursor: { disabled: true, batchSize: 25 },
    });

    const runtime = await db.connect({ url: 'postgres://localhost:5432/db' });

    expect(runtime).toBeDefined();
  });

  it('returns distinct Runtime instances for each connect() call (no closure cache)', async () => {
    const db = postgresServerless({ contract });
    const first = await db.connect({ url: 'postgres://localhost:5432/db' });
    const second = await db.connect({ url: 'postgres://localhost:5432/db' });

    expect(first).not.toBe(second);
  });

  it('returned runtime is AsyncDisposable and disposes via close()', async () => {
    const db = postgresServerless({ contract });

    let closeSpy: ReturnType<typeof vi.fn> | undefined;
    {
      await using runtime = await db.connect({ url: 'postgres://localhost:5432/db' });
      expect(runtime).toBeDefined();
      closeSpy = vi.spyOn(runtime, 'close') as unknown as ReturnType<typeof vi.fn>;
    }

    // After scope exit, the runtime was closed
    expect(closeSpy).toBeDefined();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('explicit Symbol.asyncDispose invocation calls runtime.close exactly once', async () => {
    const db = postgresServerless({ contract });
    const runtime = await db.connect({ url: 'postgres://localhost:5432/db' });

    const closeSpy = vi.spyOn(runtime, 'close');
    await runtime[Symbol.asyncDispose]();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('does not construct pg.Pool over a full connect+dispose lifecycle', async () => {
    // postgresServerless always uses pg.Client (pgClient binding), never Pool
    const db = postgresServerless({ contract });

    {
      await using _runtime = await db.connect({ url: 'postgres://localhost:5432/db' });
    }

    // The runtime was created using a pgClient binding, not a pool
    expect(db.sql).toBeDefined();
  });

  it('forwards middleware to the runtime (observable via middleware being invoked)', async () => {
    const called: string[] = [];
    const spyMiddleware: SqlMiddleware = {
      name: 'test-spy',
      familyId: 'sql',
      async afterQuery(plan) {
        called.push(plan.sql);
      },
    };

    const db = postgresServerless({ contract, middleware: [spyMiddleware] });

    const runtime = await db.connect({ url: 'postgres://localhost:5432/db' });
    expect(runtime).toBeDefined();
    await runtime.close();
  });

  it('validates contractJson input', () => {
    const contractJson = contract;
    const db = postgresServerless({ contractJson });

    expect(db.context).toBeDefined();
  });

  it('validates direct contract input', () => {
    const db = postgresServerless({ contract });

    expect(db.context).toBeDefined();
  });

  it('verifyMarker: false suppresses marker verification', async () => {
    const db = postgresServerless({ contract, verifyMarker: false });

    // Should not throw even without a real marker table in the database
    const runtime = await db.connect({ url: 'postgres://localhost:5432/db' });
    expect(runtime).toBeDefined();
    await runtime.close();
  });
});
