import { describe, expect, it, vi } from 'vitest';

const created = vi.hoisted(() => ({ pools: [] as Array<{ end: () => Promise<void> }> }));

vi.mock('pg', () => {
  class Pool {
    on = vi.fn().mockReturnThis();
    connect = vi.fn();
    end = vi.fn().mockResolvedValue(undefined);
    totalCount = 0;
    idleCount = 0;
    waitingCount = 0;
    constructor() {
      created.pools.push(this);
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
