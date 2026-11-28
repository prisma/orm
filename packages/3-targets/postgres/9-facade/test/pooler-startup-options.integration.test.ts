import postgresAdapter from '@internal/adapter-postgres/control';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import postgresTarget from '@internal/target-postgres/control';
import {
  createDevDatabase,
  type DevDatabase,
  type PrismaPostgresPoolerStandIn,
  startPrismaPostgresPoolerStandIn,
  timeouts,
} from '@repo/test-utils';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from '../src/exports/runtime';
import postgresServerless from '../src/exports/serverless';
import { contractFromJson } from '../src/exports/static';
import type { Contract } from './fixtures/generated/contract';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);
const options = { contract, verifyMarker: false as const };

describe('a stand-in for the Prisma Postgres pooler, which accepts only DateStyle, TimeZone and extra_float_digits as startup options', () => {
  let database: DevDatabase;
  let pooler: PrismaPostgresPoolerStandIn;

  beforeAll(async () => {
    database = await createDevDatabase();
    pooler = await startPrismaPostgresPoolerStandIn(database.connectionString);
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await pooler.close();
    await database.close();
  }, timeouts.spinUpPpgDev);

  it('refuses a connection whose startup options set lc_monetary', async () => {
    const client = new pg.Client({
      connectionString: pooler.url,
      options: '-c DateStyle=ISO -c lc_monetary=C',
    });

    await expect(client.connect()).rejects.toThrow('Failed to connect to upstream database');
  });

  it('lets postgres({ url }) connect and query', async () => {
    const db = postgres({ ...options, url: pooler.url });
    try {
      const rows = await db
        .query(db.raw.sql`SELECT 1 AS one`.returnsRow({ one: 'pg/int4@1' }).build())
        .toArray();
      expect(rows).toEqual([{ one: 1 }]);
    } finally {
      await db.close();
    }
  });

  it('lets a serverless connection connect and query', async () => {
    const db = await postgresServerless(options).connect({ url: pooler.url });
    try {
      const rows = await db
        .query(db.raw.sql`SELECT 1 AS one`.returnsRow({ one: 'pg/int4@1' }).build())
        .toArray();
      expect(rows).toEqual([{ one: 1 }]);
    } finally {
      await db.close();
    }
  });

  it('lets the control driver the CLI builds from the control stack connect, query and introspect', async () => {
    const stack = createControlStack({
      family: sql,
      target: postgresTarget,
      adapter: postgresAdapter,
      driver: postgresDriver,
    });
    const driver = (await stack.driver?.create(pooler.url)) as
      | SqlControlDriverInstance<'postgres'>
      | undefined;
    if (driver === undefined) throw new Error('the control stack has no driver');
    try {
      expect((await driver.query<{ one: number }>('SELECT 1 AS one')).rows).toEqual([{ one: 1 }]);
      await expect(sql.create(stack).introspect({ driver })).resolves.toBeDefined();
    } finally {
      await driver.close();
    }
  });
});
