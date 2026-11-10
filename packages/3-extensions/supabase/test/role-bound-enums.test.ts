import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { PostgresSchema } from '@internal/target-postgres/types';
import { createContract } from '@repo/test-utils';
import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';

const pool = vi.hoisted(() => ({ connects: 0 }));

vi.mock('pg', () => {
  class Pool {
    on = vi.fn().mockReturnThis();
    connect = vi.fn(async () => {
      pool.connects += 1;
      return {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: vi.fn(),
        on: vi.fn(),
      };
    });
    end = vi.fn().mockResolvedValue(undefined);
  }
  return { Pool, Client: class {} };
});

import supabase from '../src/runtime/supabase';

const base = createContract<SqlStorage>();
const enumContract = {
  ...base,
  domain: {
    namespaces: {
      public: {
        models: {},
        enum: {
          Role: {
            codecId: 'pg/text@1',
            members: [
              { name: 'User', value: 'user' },
              { name: 'Admin', value: 'admin' },
            ],
          },
        },
      },
    },
  },
  storage: {
    ...base.storage,
    namespaces: {
      public: new PostgresSchema({
        id: 'public',
        entries: {
          table: {},
          valueSet: { AalLevel: { kind: 'valueSet', values: ['aal1', 'aal2'] } },
        },
      }),
    },
  },
} as const;

type EnumContract = Contract<SqlStorage> & {
  readonly domain: (typeof enumContract)['domain'];
  readonly storage: (typeof enumContract)['storage'];
};

const jwtSecret = 'fixture-jwt-signing-input-not-a-real-credential';

function userJwt(): Promise<string> {
  return new SignJWT({ sub: 'user-1', role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(jwtSecret));
}

describe('enums and nativeEnums on a role-bound client', () => {
  it("expose the application contract's enums without opening a connection", async () => {
    const db = await supabase<EnumContract>({ contract: enumContract, jwtSecret });
    const anon = db.asAnon();

    expect({
      roleValues: anon.enums.public.Role.values,
      adminName: anon.enums.public.Role.nameOf('admin'),
      aalLevels: anon.nativeEnums.public['AalLevel']?.values,
      connects: pool.connects,
    }).toEqual({
      roleValues: ['user', 'admin'],
      adminName: 'Admin',
      aalLevels: ['aal1', 'aal2'],
      connects: 0,
    });
  });

  it('are the same objects on every role-bound client and on their transactions', async () => {
    const db = await supabase<EnumContract>({
      contract: enumContract,
      jwtSecret,
      url: 'postgres://localhost/db',
      verifyMarker: false,
    });
    const anon = db.asAnon();
    const user = await db.asUser(await userJwt());
    const admin = db.asServiceRole();

    const inTransaction = await user.transaction(async (tx) => ({
      enums: tx.enums,
      nativeEnums: tx.nativeEnums,
      sql: tx.sql,
      raw: tx.raw,
    }));
    await db.close();

    expect(anon.enums.public.Role.values).toEqual(['user', 'admin']);
    for (const client of [user, admin, inTransaction]) {
      expect(client.enums).toBe(anon.enums);
      expect(client.nativeEnums).toBe(anon.nativeEnums);
      expect(client.sql).toBe(anon.sql);
      expect(client.raw).toBe(anon.raw);
    }
  });
});
