import { EventEmitter } from 'node:events';
import type { PoolClient, PoolConfig } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const poolInstances: InstanceType<typeof import('pg').Pool>[] = [];

// Subclass the real pg.Pool so EventEmitter 'error' semantics are intact, but
// stub out everything that would open a TCP connection.
vi.mock('pg', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pg')>();
  class RecordingPool extends actual.Pool {
    constructor(config?: PoolConfig) {
      super(config);
      Object.assign(this, {
        connect: vi.fn().mockResolvedValue(makeFakePoolClient()),
        end: vi.fn().mockResolvedValue(undefined),
      });
      poolInstances.push(this);
    }
  }
  return { ...actual, Pool: RecordingPool };
});

import { Client, Pool } from 'pg';
import postgresRuntimeDriverDescriptor from '../src/exports/runtime';

function makeFakePoolClient(): PoolClient {
  const client = new EventEmitter();
  return Object.assign(client, {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  }) as unknown as PoolClient;
}

function makeFakeDirectClient(): Client {
  const client = new Client({ connectionString: 'postgres://localhost:5432/db' });
  return Object.assign(client, {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined),
  });
}

beforeEach(() => {
  poolInstances.length = 0;
});

describe('idle connection errors', () => {
  it('the pool created for a url binding survives an emitted idle-connection error', async () => {
    const driver = postgresRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'url', url: 'postgres://localhost:5432/db' });

    const pool = poolInstances.at(-1);
    expect(pool).toBeDefined();
    expect(() => pool?.emit('error', new Error('idle client lost connection'))).not.toThrow();

    await driver.close();
  });

  it('a caller-supplied pgPool binding survives an emitted idle-connection error', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const driver = postgresRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'pgPool', pool });

    expect(() => pool.emit('error', new Error('idle client lost connection'))).not.toThrow();

    await driver.close();
  });

  it('a caller-supplied pgClient binding survives an emitted connection error', async () => {
    const client = makeFakeDirectClient();
    const driver = postgresRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'pgClient', client });

    expect(() =>
      client.emit('error', new Error('connection terminated unexpectedly')),
    ).not.toThrow();

    await driver.close();
  });

  it('a checked-out pool client survives an emitted connection error', async () => {
    const driver = postgresRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'url', url: 'postgres://localhost:5432/db' });

    const connection = await driver.acquireConnection();
    const pool = poolInstances.at(-1);
    const checkedOut = await (pool as unknown as { connect: ReturnType<typeof vi.fn> }).connect.mock
      .results[0]?.value;

    expect(checkedOut).toBeDefined();
    expect(() =>
      (checkedOut as PoolClient).emit('error', new Error('connection terminated unexpectedly')),
    ).not.toThrow();

    await connection.release();
    await driver.close();
  });

  it('after a direct client connection error, acquiring a connection rejects with a clear error', async () => {
    const client = makeFakeDirectClient();
    const driver = postgresRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'pgClient', client });

    const connection = await driver.acquireConnection();
    client.emit('error', new Error('connection terminated unexpectedly'));
    await connection.release();

    await expect(driver.acquireConnection()).rejects.toThrow(
      'Postgres connection lost or closed. Call connect(binding) to reconnect.',
    );
  });
});
