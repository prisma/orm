import { createDevDatabase, timeouts } from '@repo/test-utils';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { createBoundDriverFromBinding } from '../src/postgres-driver';
import { queryRows } from './sql-queryable-test-utils';

const SESSION_SETTINGS = { DateStyle: 'ISO', lc_monetary: 'C' } as const;
const OTHER_SETTINGS = ["SET DateStyle TO 'German, DMY'", "SET lc_monetary TO 'POSIX'"];

type Queryable = Parameters<typeof queryRows>[0];

async function settingsOf(
  queryable: Queryable,
): Promise<{ DateStyle: string; lc_monetary: string }> {
  const [dateStyle] = await queryRows<{ DateStyle: string }>(queryable, 'SHOW DateStyle');
  const [lcMonetary] = await queryRows<{ lc_monetary: string }>(queryable, 'SHOW lc_monetary');
  return { DateStyle: dateStyle?.DateStyle ?? '', lc_monetary: lcMonetary?.lc_monetary ?? '' };
}

const APPLIED = { DateStyle: expect.stringMatching(/^ISO/), lc_monetary: 'C' };

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
      for (const statement of OTHER_SETTINGS) await pool.query(statement);
      const driver = createBoundDriverFromBinding(
        { kind: 'pgPool', pool, ownedByDriver: false },
        undefined,
        {
          sessionSettings: SESSION_SETTINGS,
        },
      );
      cleanups.push(() => driver.close());

      expect(await settingsOf(driver)).toEqual(APPLIED);
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
      for (const sql of OTHER_SETTINGS) await connection.execute({ sql });
      await connection.release();

      expect(await settingsOf(driver)).toEqual(APPLIED);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'are applied to a client whose session holds another value, before the driver uses it, and again after an exclusive connection is released',
    async () => {
      const client = new pg.Client({ connectionString: await devDatabaseUrl() });
      await client.connect();
      for (const statement of OTHER_SETTINGS) await client.query(statement);
      const driver = createBoundDriverFromBinding(
        { kind: 'pgClient', client, ownedByDriver: false },
        undefined,
        {
          sessionSettings: SESSION_SETTINGS,
        },
      );
      cleanups.push(() => driver.close());

      const first = await settingsOf(driver);
      const connection = await driver.acquireConnection();
      for (const sql of OTHER_SETTINGS) await connection.execute({ sql });
      await connection.release();

      expect({ first, afterRelease: await settingsOf(driver) }).toEqual({
        first: APPLIED,
        afterRelease: APPLIED,
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
