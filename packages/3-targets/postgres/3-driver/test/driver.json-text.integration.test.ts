import type { SqlDriver } from '@internal/sql-relational-core/ast';
import { timeouts } from '@repo/test-utils';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import type { PostgresBinding } from '../src/postgres-driver';
import { executeSql, openDevDriver, queryRowsInMode } from './sql-queryable-test-utils';

const values = [
  'standard',
  '123',
  'true',
  'null',
  123,
  true,
  { name: 'standard' },
  ['standard', 123],
  null,
];

describe.each(['pgClient', 'pgPool'] as const)('%s JSON transport', (binding) => {
  describe.each(['buffered', 'cursor', 'named cursor'] as const)('%s', (mode) => {
    let close: (() => Promise<void>) | undefined;

    afterEach(async () => {
      await close?.();
      close = undefined;
    }, timeouts.spinUpPpgDev);

    async function openDriver(): Promise<SqlDriver<PostgresBinding>> {
      const opened = await openDevDriver(binding, mode);
      close = opened.close;
      return opened.driver;
    }

    function rows(driver: SqlDriver<PostgresBinding>, sql: string, text: string) {
      return queryRowsInMode<{ json: string; jsonb: string }>(driver, mode, sql, [text]);
    }

    it(
      'preserves JSON text for reads without decoding scalar strings',
      async () => {
        const driver = await openDriver();
        for (const value of values) {
          const text = JSON.stringify(value);
          const result = await rows(driver, 'select $1::json as json, $1::jsonb as jsonb', text);
          expect(result).toEqual([{ json: text, jsonb: expect.any(String) }]);
          expect(result.map((row) => JSON.parse(row.jsonb))).toEqual([value]);
        }
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'preserves JSON text for returning mutations and leaves pg global parsers unchanged',
      async () => {
        const driver = await openDriver();
        await executeSql(driver, 'create table payloads (json json, jsonb jsonb)');
        for (const value of values) {
          const text = JSON.stringify(value);
          const result = await rows(
            driver,
            'insert into payloads values ($1::json, $1::jsonb) returning json, jsonb',
            text,
          );
          expect(result).toEqual([{ json: text, jsonb: expect.any(String) }]);
          expect(result.map((row) => JSON.parse(row.jsonb))).toEqual([value]);
          const updated = await rows(
            driver,
            'update payloads set json = $1::json where jsonb = $1::jsonb returning json, jsonb',
            text,
          );
          expect(updated).toEqual([{ json: expect.any(String), jsonb: expect.any(String) }]);
          expect(updated.map((row) => [JSON.parse(row.json), JSON.parse(row.jsonb)])).toEqual([
            [value, value],
          ]);
          expect(pg.types.getTypeParser(pg.types.builtins.JSON)(text)).toEqual(value);
          expect(pg.types.getTypeParser(pg.types.builtins.JSONB)(text)).toEqual(value);
        }
      },
      timeouts.spinUpPpgDev,
    );
  });
});
