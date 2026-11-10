import { contractFromJson } from '@internal/postgres/static';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pg = vi.hoisted(() => ({
  hold: undefined as ((text: string) => Promise<void> | undefined) | undefined,
  ends: 0,
}));

vi.mock('pg', () => {
  class Pool {
    on = vi.fn().mockReturnThis();
    connect = vi.fn(async () => ({
      query: vi.fn(async (request: string | { readonly text: string }) => {
        await pg.hold?.(typeof request === 'string' ? request : request.text);
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
      on: vi.fn(),
    }));
    end = vi.fn(async () => {
      pg.ends += 1;
    });
    totalCount = 0;
    idleCount = 0;
    waitingCount = 0;
  }
  class Client {
    on = vi.fn().mockReturnThis();
    escapeIdentifier = vi.fn();
    escapeLiteral = vi.fn();
  }
  return { Pool, Client };
});

import { Client, Pool } from 'pg';
import supabase from '../src/runtime/supabase';
import type { Contract } from './fixtures/example-app/contract';
import contractJson from './fixtures/example-app/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);
const jwtSecret = 'fixture-jwt-signing-input-not-a-real-credential';
const url = 'postgres://localhost/db';
const closedError = { code: 'DRIVER.NOT_CONNECTED', message: 'Runtime is closed' };

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function delay(ms = 10): Promise<void> {
  return new Promise((settle) => setTimeout(settle, ms));
}

// Holds the first statement whose SQL contains `fragment` until the returned gate opens.
function holdStatement(fragment: string) {
  const gate = deferred();
  const reached = deferred();
  pg.hold = (text) => {
    if (!text.includes(fragment)) return undefined;
    pg.hold = undefined;
    reached.resolve();
    return gate.promise;
  };
  return { reached: reached.promise, open: gate.resolve };
}

async function openClient(options: { readonly pg?: Pool } = {}) {
  const db = await supabase({
    contract,
    jwtSecret,
    verifyMarker: false,
    ...(options.pg === undefined ? { url } : { pg: options.pg }),
  });
  const anon = db.asAnon();
  const admin = db.asServiceRole();
  const appPlan = anon.sql.public.profile.select('id').build();
  const authPlan = admin.supabase.sql.auth.users.select('id').build();
  await anon.query(appPlan).toArray();
  return { db, anon, admin, appPlan, authPlan };
}

afterEach(() => {
  pg.hold = undefined;
  pg.ends = 0;
});

describe('a supabase client after close()', () => {
  it('refuses a role-bound query, transaction and ORM call with "Runtime is closed"', async () => {
    const { db, anon, appPlan } = await openClient();
    await db.close();

    await expect(anon.query(appPlan).toArray()).rejects.toMatchObject(closedError);
    await expect(anon.execute(appPlan)).rejects.toMatchObject(closedError);
    await expect(anon.transaction(async () => undefined)).rejects.toMatchObject(closedError);
    await expect(anon.orm.public.Profile.all()).rejects.toMatchObject(closedError);
  });

  it('refuses a service-role query on the Supabase contract with "Runtime is closed"', async () => {
    const { db, admin, authPlan } = await openClient();
    await db.close();

    await expect(admin.supabase.query(authPlan).toArray()).rejects.toMatchObject(closedError);
    await expect(admin.supabase.execute(authPlan)).rejects.toMatchObject(closedError);
    await expect(admin.supabase.orm.auth.AuthUser.all()).rejects.toMatchObject(closedError);
  });

  it('waits for an open role transaction to finish before it ends the pool', async () => {
    const { db, anon, appPlan } = await openClient();
    const inside = deferred();
    const finish = deferred();
    const transaction = anon.transaction(async (tx) => {
      inside.resolve();
      await finish.promise;
      return tx.query(appPlan).toArray();
    });
    await inside.promise;

    let closed = false;
    const closing = db.close().then(() => {
      closed = true;
    });
    await delay();
    const whileOpen = { closed, ends: pg.ends };
    finish.resolve();

    await expect(transaction).resolves.toEqual([]);
    await closing;
    expect({ whileOpen, ends: pg.ends }).toEqual({
      whileOpen: { closed: false, ends: 0 },
      ends: 1,
    });
  });

  it('waits for a Supabase-contract query in flight before it ends the pool', async () => {
    const { db, admin, authPlan } = await openClient();
    const held = holdStatement('"auth"."users"');
    const pending = admin.supabase.query(authPlan).toArray();
    await held.reached;

    let closed = false;
    const closing = db.close().then(() => {
      closed = true;
    });
    await delay();
    const whileRunning = { closed, ends: pg.ends };
    held.open();

    await expect(pending).resolves.toEqual([]);
    await closing;
    expect({ whileRunning, ends: pg.ends }).toEqual({
      whileRunning: { closed: false, ends: 0 },
      ends: 1,
    });
  });

  it('with a pool the caller passed in, waits for work in flight and refuses new work, but leaves the pool open', async () => {
    const pool = new Pool();
    const { db, anon, admin, appPlan, authPlan } = await openClient({ pg: pool });
    const held = holdStatement('"auth"."users"');
    const pending = admin.supabase.query(authPlan).toArray();
    await held.reached;

    let closed = false;
    const closing = db.close().then(() => {
      closed = true;
    });
    await delay();
    const whileRunning = closed;
    held.open();
    await pending;
    await closing;

    await expect(anon.query(appPlan).toArray()).rejects.toMatchObject(closedError);
    await expect(admin.supabase.query(authPlan).toArray()).rejects.toMatchObject(closedError);
    expect({ whileRunning, ends: pg.ends }).toEqual({ whileRunning: false, ends: 0 });
  });
});

describe('the pg option', () => {
  it('rejects a pg.Client with SUPABASE.CONFIG_INVALID', async () => {
    const client = new Client() as unknown as Pool;

    await expect(supabase({ contract, jwtSecret, pg: client })).rejects.toMatchObject({
      code: 'SUPABASE.CONFIG_INVALID',
    });
  });
});

describe('tx.prepare on a role-bound transaction still open after close()', () => {
  it('does not throw at the call, and prepares, because preparing sends nothing to the database', async () => {
    const { db, anon } = await openClient();

    const outcome = await anon.transaction(async (tx) => {
      const closing = db.close();
      let prepared: Promise<unknown> | undefined;
      expect(() => {
        prepared = tx.prepare({}, () => tx.sql.public.profile.select('id').build());
      }).not.toThrow();
      const result = await Promise.resolve(prepared).catch((error: unknown) => error);
      return { result, closing };
    });
    await outcome.closing;

    expect(outcome.result).toMatchObject({ query: expect.any(Function) });
  });
});
