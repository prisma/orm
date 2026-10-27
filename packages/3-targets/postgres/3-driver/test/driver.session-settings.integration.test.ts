import { createDevDatabase, timeouts } from '@repo/test-utils';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { createBoundDriverFromBinding } from '../src/postgres-driver';
import { queryRows } from './sql-queryable-test-utils';

const SESSION_SETTINGS = { DateStyle: 'ISO' } as const;
const GERMAN = "SET DateStyle TO 'German, DMY'";

async function dateStyleOf(
  queryable: Parameters<typeof queryRows>[0],
): Promise<string | undefined> {
  const rows = await queryRows<{ DateStyle: string }>(queryable, 'SHOW DateStyle');
  return rows[0]?.DateStyle;
}

describe('the session settings on a connection the application supplies', () => {
  const cleanups: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => undefined);
  });

  async function devDatabaseUrl(): Promise<string> {
    const database = await createDevDatabase();
    cleanups.push(() => database.close());
    return database.connectionString;
  }

  it(
    'are applied to a pooled connection whose session holds another value, before the driver uses it',
    async () => {
      const pool = new pg.Pool({ connectionString: await devDatabaseUrl(), max: 1 });
      await pool.query(GERMAN);
      const driver = createBoundDriverFromBinding(
        { kind: 'pgPool', pool, ownedByDriver: false },
        undefined,
        {
          sessionSettings: SESSION_SETTINGS,
        },
      );
      cleanups.push(() => driver.close());

      expect(await dateStyleOf(driver)).toMatch(/^ISO/);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'are applied again after a connection handed out for exclusive use is released',
    async () => {
      const pool = new pg.Pool({ connectionString: await devDatabaseUrl(), max: 1 });
      const driver = createBoundDriverFromBinding(
        { kind: 'pgPool', pool, ownedByDriver: false },
        undefined,
        {
          sessionSettings: SESSION_SETTINGS,
        },
      );
      cleanups.push(() => driver.close());

      const connection = await driver.acquireConnection();
      await connection.execute({ sql: GERMAN });
      await connection.release();

      expect(await dateStyleOf(driver)).toMatch(/^ISO/);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'are applied to a client whose session holds another value, before the driver uses it, and again after an exclusive connection is released',
    async () => {
      const client = new pg.Client({ connectionString: await devDatabaseUrl() });
      await client.connect();
      await client.query(GERMAN);
      const driver = createBoundDriverFromBinding(
        { kind: 'pgClient', client, ownedByDriver: false },
        undefined,
        {
          sessionSettings: SESSION_SETTINGS,
        },
      );
      cleanups.push(() => driver.close());

      const first = await dateStyleOf(driver);
      const connection = await driver.acquireConnection();
      await connection.execute({ sql: GERMAN });
      await connection.release();

      expect({ first, afterRelease: await dateStyleOf(driver) }).toEqual({
        first: expect.stringMatching(/^ISO/),
        afterRelease: expect.stringMatching(/^ISO/),
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'refuse a connection whose settings the server rejects, and evict it from the pool',
    async () => {
      const pool = new pg.Pool({ connectionString: await devDatabaseUrl(), max: 1 });
      const driver = createBoundDriverFromBinding(
        { kind: 'pgPool', pool, ownedByDriver: false },
        undefined,
        {
          sessionSettings: { no_such_setting: 'x' },
        },
      );
      cleanups.push(() => driver.close());

      await expect(driver.acquireConnection()).rejects.toThrow(/no_such_setting/);
      expect(pool.totalCount).toBe(0);
    },
    timeouts.spinUpPpgDev,
  );
});
