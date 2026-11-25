import postgresAdapter from '@internal/adapter-postgres/runtime';
import type { Contract } from '@internal/contract/types';
import { defineContract } from '@internal/postgres/contract-builder';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('pg', () => {
  class Pool {
    on = vi.fn().mockReturnThis();
    connect = vi.fn(async () => ({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
      on: vi.fn(),
    }));
    end = vi.fn().mockResolvedValue(undefined);
  }
  return { Pool, Client: class {} };
});

import supabase from '../src/runtime/supabase';

const jwtSecret = 'fixture-jwt-signing-input-not-a-real-credential';

function spyLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('supabase() checks its stack against the contract', () => {
  it('warns nothing when the adapter and driver provide what the contract requires', async () => {
    const log = spyLog();
    await supabase({ contract: defineContract({ databaseVersion: 18 }), jwtSecret, log });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('warns once, when the client is created, naming each capability the stack lacks', async () => {
    const log = spyLog();
    // Typed as any contract, so the compile-time check, tested in stack-capabilities.types.test-d.ts, leaves the run-time one to be seen.
    const contract: Contract<SqlStorage> = defineContract({
      databaseVersion: 18,
      capabilities: [{ http: { batch: true } }],
    });
    await supabase({ contract, jwtSecret, log });
    expect(log.warn.mock.calls).toEqual([
      [
        expect.objectContaining({
          code: 'CONTRACT.CAPABILITIES_NOT_PROVIDED',
          missing: ['http.batch'],
        }),
      ],
    ]);
  });
});

describe('transaction() on a role-bound client', () => {
  it('is refused for a contract that does not list interactive transactions', async () => {
    const contract = defineContract({
      databaseVersion: 18,
      capabilities: [postgresAdapter.capabilities],
    });
    const db = await supabase({ contract, jwtSecret, url: 'postgres://localhost/db' });
    await expect(
      // @ts-expect-error the contract does not list sql.interactiveTransactions
      db.asAnon().transaction(async () => 1),
    ).rejects.toMatchObject({
      code: 'ORM.CAPABILITY_MISSING',
      meta: { capability: 'sql.interactiveTransactions', method: 'transaction' },
    });
    await db.close();
  });
});
