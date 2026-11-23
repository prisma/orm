import { describe, expect, it, vi } from 'vitest';

const created = vi.hoisted(() => ({
  pools: [] as Array<{ end: () => Promise<void> }>,
  configs: [] as unknown[],
}));

vi.mock('pg', () => {
  class Pool {
    on = vi.fn().mockReturnThis();
    connect = vi.fn();
    end = vi.fn().mockResolvedValue(undefined);
    totalCount = 0;
    idleCount = 0;
    waitingCount = 0;
    constructor(config?: unknown) {
      created.pools.push(this);
      created.configs.push(config);
    }
  }
  class Client {}
  return { Pool, Client };
});

import { Pool } from 'pg';
import { connectWithBinding } from '../src/runtime/binding';

const connectFailure = new Error('connection refused');

function rejectingDriver() {
  return { connect: vi.fn().mockRejectedValue(connectFailure) };
}

describe('connectWithBinding when the driver fails to connect', () => {
  it('ends the pool it created for a url binding', async () => {
    created.pools.length = 0;
    const driver = rejectingDriver();

    await expect(
      connectWithBinding(driver, { kind: 'url', url: 'postgres://localhost:5432/db' }, {}),
    ).rejects.toBe(connectFailure);

    expect(created.pools.map((pool) => vi.mocked(pool.end).mock.calls.length)).toEqual([1]);
    expect(driver.connect).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'pgPool', ownedByDriver: true, pool: created.pools[0] }),
    );
  });

  it('leaves open a pool the caller passed in', async () => {
    const pool = new Pool();
    const driver = rejectingDriver();

    await expect(connectWithBinding(driver, { kind: 'pgPool', pool }, {})).rejects.toBe(
      connectFailure,
    );

    expect(vi.mocked(pool.end)).not.toHaveBeenCalled();
    expect(driver.connect).toHaveBeenCalledWith({ kind: 'pgPool', pool, ownedByDriver: false });
  });
});

describe('the pool connectWithBinding creates for a url binding', () => {
  const url = 'postgres://localhost:5432/db';

  async function poolConfigFor(poolOptions?: { readonly max?: number }) {
    created.configs.length = 0;
    await connectWithBinding({ connect: vi.fn() }, { kind: 'url', url }, { poolOptions });
    return created.configs[0];
  }

  it('opens at most poolOptions.max connections', async () => {
    expect(await poolConfigFor({ max: 1 })).toMatchObject({ max: 1 });
  });

  it("leaves the size to pg's default without max", async () => {
    expect(await poolConfigFor()).toEqual({
      connectionString: url,
      connectionTimeoutMillis: 20_000,
      idleTimeoutMillis: 30_000,
      Client: expect.any(Function),
    });
  });

  it('hands pg the max it is given without checking it, as for the timeouts', async () => {
    expect(await poolConfigFor({ max: 0 })).toMatchObject({ max: 0 });
  });
});
