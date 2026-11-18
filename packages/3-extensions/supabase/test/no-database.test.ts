import postgresDriver from '@internal/driver-postgres/runtime';
import { contractFromJson } from '@internal/postgres/static';
import { Collection } from '@internal/sql-orm-client';
import type { SqlMiddleware } from '@internal/sql-runtime';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

const created = vi.hoisted(() => ({ pools: 0, clients: 0, poolConnects: 0, poolEnds: 0 }));

vi.mock('pg', () => {
  class Pool {
    on = vi.fn().mockReturnThis();
    connect = vi.fn(async () => {
      created.poolConnects += 1;
      return {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: vi.fn(),
        on: vi.fn(),
      };
    });
    end = vi.fn(async () => {
      created.poolEnds += 1;
    });
    totalCount = 0;
    idleCount = 0;
    waitingCount = 0;
    constructor() {
      created.pools += 1;
    }
  }
  class Client {
    constructor() {
      created.clients += 1;
    }
  }
  return { Pool, Client };
});

import { Pool } from 'pg';
import supabase from '../src/runtime/supabase';
import type { Contract } from './fixtures/example-app/contract';
import contractJson from './fixtures/example-app/contract.json' with { type: 'json' };

class ProfileCollection extends Collection<Contract, 'Profile'> {
  named(username: string) {
    return this.where({ username });
  }
}

const contract = contractFromJson<Contract>(contractJson);
const collections = { Profile: ProfileCollection };
const jwtSecret = 'fixture-jwt-signing-input-not-a-real-credential';
const url = 'postgres://localhost/db';

const selectIds = { sql: 'SELECT "id" AS "id" FROM "public"."profile" LIMIT 10', params: [] };
const renameAll = { sql: 'UPDATE profile SET username = $1', params: ['ada'] };
const selectNamed = {
  sql: 'SELECT "profile"."id" AS "id" FROM "public"."profile" WHERE "profile"."username" = $1',
  params: ['ada'],
};

let driverCreate: MockInstance<typeof postgresDriver.create>;

beforeEach(() => {
  created.pools = 0;
  created.clients = 0;
  created.poolConnects = 0;
  created.poolEnds = 0;
  driverCreate = vi.spyOn(postgresDriver, 'create');
});

afterEach(() => {
  driverCreate.mockRestore();
});

describe('a supabase client with no database', () => {
  it('builds and renders plans from sql, raw and orm without a pool, driver or connection', async () => {
    const db = await supabase({ contract, jwtSecret, collections });
    const anon = db.asAnon();

    expect(db.context.contract.target).toBe('postgres');
    expect(db.stack).toBeDefined();
    expect(anon.toSql(anon.sql.public.profile.select('id').limit(10).build())).toEqual(selectIds);
    expect(
      anon.toSql(anon.raw.sql`UPDATE profile SET username = ${'ada'}`.affectedCount().build()),
    ).toEqual(renameAll);
    expect(
      anon.toSql(anon.orm.public.Profile.named('ada').select('id').prepared.all().plan),
    ).toEqual(selectNamed);
    expect(created).toEqual({ pools: 0, clients: 0, poolConnects: 0, poolEnds: 0 });
    expect(driverCreate).not.toHaveBeenCalled();
  });
});

describe('a supabase client given a URL', () => {
  it('creates its pool and driver on the first query', async () => {
    const db = await supabase({ contract, url, jwtSecret, verifyMarker: false });
    const anon = db.asAnon();
    anon.toSql(anon.sql.public.profile.select('id').build());
    db.asServiceRole();

    expect(created.pools).toBe(0);
    expect(driverCreate).not.toHaveBeenCalled();

    await anon.query(anon.sql.public.profile.select('id').build()).toArray();
    await db.asServiceRole().query(anon.sql.public.profile.select('id').build()).toArray();
    await db.close();

    expect(created.pools).toBe(1);
    expect(driverCreate).toHaveBeenCalledTimes(1);
  });

  it('leaves no pool open when creating the driver fails, and creates one when a later query succeeds', async () => {
    const db = await supabase({ contract, url, jwtSecret, verifyMarker: false });
    const anon = db.asAnon();
    const plan = anon.sql.public.profile.select('id').build();
    driverCreate.mockImplementationOnce(() => {
      throw new Error('driver creation failed');
    });

    await expect(anon.query(plan).toArray()).rejects.toThrow('driver creation failed');
    expect(created.pools).toBe(0);

    await anon.query(plan).toArray();
    await db.close();

    expect(created.pools).toBe(1);
  });

  it('keeps a failed driver connect and throws it on the next query, ending its pool', async () => {
    const createDriver = postgresDriver.create.bind(postgresDriver);
    driverCreate.mockImplementationOnce((options) => {
      const driver = createDriver(options);
      vi.spyOn(driver, 'connect').mockRejectedValueOnce(new Error('connect failed'));
      return driver;
    });
    const db = await supabase({ contract, url, jwtSecret, verifyMarker: false });
    const anon = db.asAnon();
    const plan = anon.sql.public.profile.select('id').build();

    await expect(anon.query(plan).toArray()).rejects.toThrow();

    await expect(anon.query(plan).toArray()).rejects.toThrow('connect failed');
    expect(created.poolEnds).toBe(1);
  });

  it('leaves a pool the caller passed in open when it is closed, and refuses later queries', async () => {
    const pool = new Pool();
    const db = await supabase({ contract, pg: pool, jwtSecret, verifyMarker: false });
    const anon = db.asAnon();
    const plan = anon.sql.public.profile.select('id').build();

    await anon.query(plan).toArray();
    await db.close();

    expect(created.poolEnds).toBe(0);
    await expect(anon.query(plan).toArray()).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
      message: 'Runtime is closed',
    });
  });

  it('makes every concurrent close() wait for the pool to end', async () => {
    const db = await supabase({ contract, url, jwtSecret, verifyMarker: false });
    const anon = db.asAnon();
    await anon.query(anon.sql.public.profile.select('id').build()).toArray();

    const first = db.close();
    const second = db.close();
    await second;

    expect(second).toBe(first);
    expect(created.poolEnds).toBe(1);
  });

  it('ends the pool it created when it is closed', async () => {
    const db = await supabase({ contract, url, jwtSecret, verifyMarker: false });
    const anon = db.asAnon();

    await anon.query(anon.sql.public.profile.select('id').build()).toArray();
    await db.close();

    expect(created.poolEnds).toBe(1);
  });

  it('creates no pool when it is closed before a query', async () => {
    const db = await supabase({ contract, url, jwtSecret });

    await db.close();

    const anon = db.asAnon();
    const plan = anon.sql.public.profile.select('id').build();
    const closedError = { code: 'DRIVER.NOT_CONNECTED', message: 'Runtime is closed' };

    expect(created.pools).toBe(0);
    await expect(anon.query(plan).toArray()).rejects.toMatchObject(closedError);
    await expect(anon.execute(plan)).rejects.toMatchObject(closedError);
    await expect(anon.orm.public.Profile.all()).rejects.toMatchObject(closedError);
    await expect(anon.transaction(async () => undefined)).rejects.toMatchObject(closedError);
    let prepared: Promise<unknown> | undefined;
    expect(() => {
      prepared = anon.prepare({}, () => plan);
    }).not.toThrow();
    await expect(prepared).rejects.toMatchObject(closedError);
    expect(created.pools).toBe(0);
  });

  it("gives a role-bound transaction the client's toSql", async () => {
    const db = await supabase({ contract, url, jwtSecret, verifyMarker: false });
    const anon = db.asAnon();

    const toSql = await anon.transaction(async (tx) => tx.toSql);
    await db.close();

    expect(toSql).toBe(anon.toSql);
  });

  it('passes the mode option to middleware', async () => {
    const modes: string[] = [];
    const recordMode: SqlMiddleware = {
      name: 'record-mode',
      familyId: 'sql',
      async beforeEncode(_plan, ctx) {
        modes.push(ctx.mode);
      },
    };
    const db = await supabase({
      contract,
      url,
      jwtSecret,
      verifyMarker: false,
      middleware: [recordMode],
      mode: 'permissive',
    });
    const anon = db.asAnon();

    await anon.query(anon.sql.public.profile.select('id').build()).toArray();
    await db.close();

    expect(modes).toEqual(['permissive']);
  });
});

describe('toSql on a supabase client', () => {
  it("renders a plan of the Supabase contract only on the service role's supabase member", async () => {
    const db = await supabase({ contract, jwtSecret });
    const admin = db.asServiceRole();
    const plan = admin.supabase.sql.auth.users.select('id').limit(1).build();

    expect(admin.supabase.toSql(plan)).toEqual({
      sql: 'SELECT "id" AS "id" FROM "auth"."users" LIMIT 1',
      params: [],
    });
    expect(() => admin.toSql(plan)).toThrow(
      expect.objectContaining({ code: 'PLAN.HASH_MISMATCH' }),
    );
  });
});
