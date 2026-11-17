import type { SqlStorage } from '@internal/sql-contract/types';
import { createContract } from '@repo/test-utils';
import type { PoolConfig } from 'pg';
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
        connect: vi.fn().mockResolvedValue({
          query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
          release: vi.fn(),
          on: vi.fn(),
        }),
        end: vi.fn().mockResolvedValue(undefined),
      });
      poolInstances.push(this);
    }
  }
  return { ...actual, Pool: RecordingPool };
});

import supabase from '../src/runtime/supabase';

const contract = createContract<SqlStorage>();
const fixtureJwtSecret = 'fixture-jwt-signing-input-not-a-real-credential';

beforeEach(() => {
  poolInstances.length = 0;
});

describe('supabase() idle connection errors', () => {
  it('the pool created from { url } on the first query survives an emitted idle-connection error', async () => {
    const db = await supabase({
      contract,
      url: 'postgres://localhost:5432/db',
      jwtSecret: fixtureJwtSecret,
      verifyMarker: false,
    });
    const anon = db.asAnon();
    await anon.execute(anon.raw.sql`SELECT 1`.affectedCount().build());

    const pool = poolInstances.at(-1);
    expect(pool).toBeDefined();
    expect(() => pool?.emit('error', new Error('idle client lost connection'))).not.toThrow();
  });
});
