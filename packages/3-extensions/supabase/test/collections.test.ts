import { contractFromJson } from '@internal/postgres/static';
import { Collection } from '@internal/sql-orm-client';
import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';

const statements = vi.hoisted(() => [] as string[]);

vi.mock('pg', () => {
  const query = vi.fn(async (request: string | { readonly text: string }) => {
    statements.push(typeof request === 'string' ? request : request.text);
    return { rows: [], rowCount: 0 };
  });
  class Pool {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue({ query, release: vi.fn(), on: vi.fn() });
    end = vi.fn().mockResolvedValue(undefined);
  }
  class Client {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue(undefined);
    query = query;
    end = vi.fn().mockResolvedValue(undefined);
    release = vi.fn();
  }
  return { Pool, Client };
});

import supabase from '../src/runtime/supabase';
import type { Contract } from './fixtures/example-app/contract';
import contractJson from './fixtures/example-app/contract.json' with { type: 'json' };

class ProfileCollection extends Collection<Contract, 'Profile'> {
  named(username: string) {
    return this.where({ username });
  }
}

const contract = contractFromJson<Contract>(contractJson);
const jwtSecret = 'fixture-jwt-signing-input-not-a-real-credential';

describe('a supabase client with custom collection classes', () => {
  it('gives every role-bound client the classes', async () => {
    const db = await supabase({ contract, jwtSecret, collections: { Profile: ProfileCollection } });
    const jwt = await new SignJWT({ sub: 'user-1', role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(jwtSecret));
    const user = await db.asUser(jwt);

    expect({
      user: user.orm.public.Profile.named('ada') instanceof ProfileCollection,
      anon: db.asAnon().orm.public.Profile.named('ada') instanceof ProfileCollection,
      serviceRole: db.asServiceRole().orm.public.Profile.named('ada') instanceof ProfileCollection,
    }).toEqual({ user: true, anon: true, serviceRole: true });
    await db.close();
  });

  it('runs a class method on a role-bound client', async () => {
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      verifyMarker: false,
      jwtSecret,
      collections: { Profile: ProfileCollection },
    });

    await db.asAnon().orm.public.Profile.named('ada').all();
    await db.close();

    expect(statements).toEqual([
      'SELECT set_config($1, $2, false)',
      'SELECT set_config($1, $2, false)',
      'SELECT "profile"."id" AS "id", "profile"."userId" AS "userId", "profile"."username" AS "username" FROM "public"."profile" WHERE "profile"."username" = $1',
      'RESET ALL',
      'RESET ROLE',
    ]);
  });
});

describe('a supabase client given a class for a model the contract does not have', () => {
  it('rejects it when it is created', async () => {
    await expect(
      supabase({ contract, jwtSecret, collections: { NotAModel: ProfileCollection } }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: expect.stringContaining("No model found for custom collection 'NotAModel'"),
      }),
    );
  });
});
