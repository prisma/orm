import type { SqlStorage } from '@internal/sql-contract/types';
import { createContract } from '@repo/test-utils';
import type { ClientConfig, PoolConfig } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const poolInstances: InstanceType<typeof import('pg').Pool>[] = [];
const clientInstances: InstanceType<typeof import('pg').Client>[] = [];

// Subclass the real pg classes so EventEmitter 'error' semantics are intact,
// but stub out everything that would open a TCP connection.
vi.mock('pg', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pg')>();
  class RecordingPool extends actual.Pool {
    constructor(config?: PoolConfig) {
      super(config);
      Object.assign(this, {
        connect: vi.fn().mockResolvedValue({
          query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
          release: vi.fn(),
        }),
        end: vi.fn().mockResolvedValue(undefined),
      });
      poolInstances.push(this);
    }
  }
  class RecordingClient extends actual.Client {
    constructor(config?: string | ClientConfig) {
      super(config);
      Object.assign(this, {
        connect: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        end: vi.fn().mockResolvedValue(undefined),
      });
      clientInstances.push(this);
    }
  }
  return { ...actual, Pool: RecordingPool, Client: RecordingClient };
});

import postgres from '../src/runtime/postgres';
import postgresServerless from '../src/runtime/postgres-serverless';

const contract = createContract<SqlStorage>();

beforeEach(() => {
  poolInstances.length = 0;
  clientInstances.length = 0;
});

describe('postgres() idle connection errors', () => {
  it('the pool created from { url } survives an emitted idle-connection error', async () => {
    const db = postgres({ contract, url: 'postgres://localhost:5432/db' });
    db.runtime();
    await Promise.resolve();
    await Promise.resolve();

    const pool = poolInstances.at(-1);
    expect(pool).toBeDefined();
    expect(() => pool?.emit('error', new Error('idle client lost connection'))).not.toThrow();

    await db.close();
  });
});

describe('postgresServerless() idle connection errors', () => {
  it('the pg.Client that connect({ url }) creates survives an emitted connection error', async () => {
    const db = await postgresServerless({ contract }).connect({
      url: 'postgres://localhost:5432/db',
    });

    const client = clientInstances.at(-1);
    expect(client).toBeDefined();
    expect(() =>
      client?.emit('error', new Error('connection terminated unexpectedly')),
    ).not.toThrow();

    await db.close();
  });
});
