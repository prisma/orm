/**
 * The driver is the lossless transport boundary: PostgreSQL renders temporal
 * values as text and the driver hands that text on untouched, so no precision
 * is lost to a JavaScript `Date` before a codec ever sees the value.
 */

import type { SqlDriver, SqlExecuteRequest } from '@internal/sql-relational-core/ast';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBoundDriverFromBinding,
  type PostgresBinding,
  type PostgresCursorOptions,
} from '../src/postgres-driver';
import { executeSql, queryRows } from './sql-queryable-test-utils';

const CREATE_TABLE = `create table moments (
  d date,
  t time(6),
  ts timestamp(6),
  tstz timestamptz(6),
  da date[],
  ta time(6)[],
  tsa timestamp(6)[],
  tstza timestamptz(6)[]
)`;

const INSERT_ROW = `insert into moments values (
  date '2026-01-02',
  time '03:04:05.123456',
  timestamp '2026-01-02 03:04:05.123456',
  timestamptz '2026-01-02 03:04:05.123456+00',
  array[date '2026-01-02', date '2026-03-04'],
  array[time '03:04:05.123456', time '06:07:08.987654'],
  array[timestamp '2026-01-02 03:04:05.123456', timestamp '2026-03-04 06:07:08.987654'],
  array[timestamptz '2026-01-02 03:04:05.123456+00', timestamptz '2026-03-04 06:07:08.987654+00']
)`;

const SELECT_ROW = 'select d, t, ts, tstz, da, ta, tsa, tstza from moments';

const SERVER_TEXT = {
  d: '2026-01-02',
  t: '03:04:05.123456',
  ts: '2026-01-02 03:04:05.123456',
  tstz: '2026-01-02 03:04:05.123456+00',
  da: ['2026-01-02', '2026-03-04'],
  ta: ['03:04:05.123456', '06:07:08.987654'],
  tsa: ['2026-01-02 03:04:05.123456', '2026-03-04 06:07:08.987654'],
  tstza: ['2026-01-02 03:04:05.123456+00', '2026-03-04 06:07:08.987654+00'],
};

type MomentRow = typeof SERVER_TEXT;

describe('@internal/driver-postgres temporal text transport', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  }, timeouts.spinUpPpgDev);

  async function seededDriver(cursor?: PostgresCursorOptions): Promise<{
    driver: SqlDriver<PostgresBinding>;
    client: pg.Client;
  }> {
    const database = await createDevDatabase();
    const client = new pg.Client({ connectionString: database.connectionString });
    const driver = createBoundDriverFromBinding({ kind: 'pgClient', client }, cursor);
    cleanups.push(async () => {
      await driver.close();
      await database.close();
    });
    await executeSql(driver, "set time zone 'UTC'");
    await executeSql(driver, CREATE_TABLE);
    await executeSql(driver, INSERT_ROW);
    return { driver, client };
  }

  function preparedRequest(): SqlExecuteRequest {
    let name: unknown;
    return {
      sql: SELECT_ROW,
      preparedStatementHandle: {
        get: () => name,
        set: (value: unknown) => {
          name = value;
        },
      },
    };
  }

  it(
    'buffered reads carry every temporal column as PostgreSQL text',
    async () => {
      const { driver } = await seededDriver({ disabled: true });

      const rows = await queryRows<MomentRow>(driver, SELECT_ROW);

      expect(rows).toEqual([SERVER_TEXT]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'unnamed cursor reads carry every temporal column as PostgreSQL text',
    async () => {
      const { driver } = await seededDriver();

      const rows = await queryRows<MomentRow>(driver, SELECT_ROW);

      expect(rows).toEqual([SERVER_TEXT]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'named cursor reads carry every temporal column as PostgreSQL text',
    async () => {
      const { driver } = await seededDriver();

      const rows: MomentRow[] = [];
      for await (const row of driver.query<MomentRow>(preparedRequest())) {
        rows.push(row);
      }

      expect(rows).toEqual([SERVER_TEXT]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'temporal values arrive as strings and arrays of strings, never as Date',
    async () => {
      const { driver } = await seededDriver({ disabled: true });

      const [row] = await queryRows<MomentRow>(driver, SELECT_ROW);

      expect([row?.d, row?.t, row?.ts, row?.tstz].map((value) => typeof value)).toEqual([
        'string',
        'string',
        'string',
        'string',
      ]);
      for (const values of [row?.da, row?.ta, row?.tsa, row?.tstza]) {
        expect(Array.isArray(values)).toBe(true);
        expect(values?.map((value) => typeof value)).toEqual(['string', 'string']);
      }
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'leaves the caller-supplied client and pg global parsers on their defaults',
    async () => {
      const { driver, client } = await seededDriver({ disabled: true });

      await queryRows<MomentRow>(driver, SELECT_ROW);
      const direct = await client.query<MomentRow>(SELECT_ROW);

      expect(direct.rows[0]?.ts).toBeInstanceOf(Date);
      expect(direct.rows[0]?.tsa?.[0]).toBeInstanceOf(Date);
      expect(
        pg.types.getTypeParser(pg.types.builtins.TIMESTAMP)('2026-01-02 03:04:05'),
      ).toBeInstanceOf(Date);
    },
    timeouts.spinUpPpgDev,
  );
});
