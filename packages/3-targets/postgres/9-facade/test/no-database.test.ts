import postgresDriver from '@internal/driver-postgres/runtime';
import { Collection } from '@internal/sql-orm-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contract } from './fixtures/generated/contract';
import fixtureContractJson from './fixtures/generated/contract.json' with { type: 'json' };

const created = vi.hoisted(() => ({ pools: 0, clients: 0 }));

vi.mock('pg', () => {
  class Pool {
    on() {
      return this;
    }
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

import postgres from '../src/exports/runtime';
import postgresServerless from '../src/exports/serverless';
import postgresStatic, { contractFromJson } from '../src/exports/static';

class PostCollection extends Collection<Contract, 'Post'> {
  titled(title: string) {
    return this.where({ title });
  }
}

const contract = contractFromJson<Contract>(fixtureContractJson);
const collections = { Post: PostCollection };

const selectIds = { sql: 'SELECT "id" AS "id" FROM "public"."posts" LIMIT 10', params: [] };
const resetViews = { sql: 'UPDATE posts SET views = $1', params: [0] };
const selectTitled = {
  sql: 'SELECT "posts"."id" AS "id" FROM "public"."posts" WHERE "posts"."title" = $1',
  params: ['Hello'],
};

let driverCreate: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  created.pools = 0;
  created.clients = 0;
  driverCreate = vi.spyOn(postgresDriver, 'create');
});

afterEach(() => {
  driverCreate.mockRestore();
});

function expectNothingCreated() {
  expect(created).toEqual({ pools: 0, clients: 0 });
  expect(driverCreate).not.toHaveBeenCalled();
}

describe('a postgres client with no database', () => {
  it('builds and renders plans from sql, raw and orm without a pool, driver or connection', () => {
    const db = postgres({ contract, collections });

    expect(db.contract.target).toBe('postgres');
    expect(db.enums).toBeDefined();
    expect(db.nativeEnums).toBeDefined();
    expect(db.toSql(db.sql.public.posts.select('id').limit(10).build())).toEqual(selectIds);
    expect(db.toSql(db.raw.sql`UPDATE posts SET views = ${0}`.affectedCount().build())).toEqual(
      resetViews,
    );
    expect(db.toSql(db.orm.public.Post.titled('Hello').select('id').prepared.all().plan)).toEqual(
      selectTitled,
    );
    expectNothingCreated();
  });
});

describe('a postgres client given a URL', () => {
  it('creates its pool and driver on the first use', () => {
    const db = postgres({ contract, url: 'postgres://localhost:5432/db' });
    db.toSql(db.sql.public.posts.select('id').build());

    expectNothingCreated();

    db.runtime();

    expect(created.pools).toBe(1);
    expect(driverCreate).toHaveBeenCalledTimes(1);
  });
});

describe('a serverless client with no database', () => {
  it('builds and renders plans from sql and raw without a driver or connection', () => {
    const serverless = postgresServerless({ contract, collections });

    expect(serverless.contract.target).toBe('postgres');
    expect(serverless.enums).toBeDefined();
    expect(serverless.nativeEnums).toBeDefined();
    expect(serverless.toSql(serverless.sql.public.posts.select('id').limit(10).build())).toEqual(
      selectIds,
    );
    expect(
      serverless.toSql(serverless.raw.sql`UPDATE posts SET views = ${0}`.affectedCount().build()),
    ).toEqual(resetViews);
    expectNothingCreated();
  });
});

describe('the static entry', () => {
  it('renders plans from sql and raw', () => {
    const db = postgresStatic({ contract });

    expect(db.toSql(db.sql.public.posts.select('id').limit(10).build())).toEqual(selectIds);
    expect(db.toSql(db.raw.sql`UPDATE posts SET views = ${0}`.affectedCount().build())).toEqual(
      resetViews,
    );
  });
});

describe('toSql', () => {
  it('renders the same SQL on every client', () => {
    const plan = postgresStatic({ contract }).sql.public.posts.select('id').limit(10).build();

    expect(postgres({ contract }).toSql(plan)).toEqual(selectIds);
    expect(postgresServerless({ contract }).toSql(plan)).toEqual(selectIds);
  });

  it('rejects a plan with a prepare bind site', async () => {
    const db = postgres({ contract });
    let bound: Parameters<typeof db.toSql>[0] | undefined;
    await db.prepare({ id: 'pg/int4@1' }, (params) => {
      bound = db.sql.public.posts
        .select('id')
        .where((f, fns) => fns.eq(f.id, params.id))
        .build();
      return bound;
    });
    if (bound === undefined) throw new Error('prepare did not call its callback');
    const plan = bound;

    expect(() => db.toSql(plan)).toThrow(
      expect.objectContaining({ code: 'RUNTIME.PREPARE_BIND_ON_ADHOC' }),
    );
  });
});
