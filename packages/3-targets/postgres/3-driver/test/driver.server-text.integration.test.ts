import { timeouts } from '@repo/test-utils';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { openDevDriver, queryRowsInMode } from './sql-queryable-test-utils';

const SELECT_ROW = `select
  true as bool,
  1::int2 as int2,
  2::int4 as int4,
  1.5::float8 as float8,
  'NaN'::float8 as float8_nan,
  'Infinity'::float8 as float8_infinity,
  '-Infinity'::float8 as float8_negative_infinity,
  '\\x0102ff'::bytea as bytea,
  42::oid as oid,
  interval '1 day 02:03:04' as interval,
  '{"a":1}'::json as json,
  '{"a":1}'::jsonb as jsonb`;

const SERVER_TEXT = {
  bool: 't',
  int2: '1',
  int4: '2',
  float8: '1.5',
  float8_nan: 'NaN',
  float8_infinity: 'Infinity',
  float8_negative_infinity: '-Infinity',
  bytea: '\\x0102ff',
  oid: '42',
  interval: '1 day 02:03:04',
  json: '{"a":1}',
  jsonb: '{"a": 1}',
};

describe.each(['pgClient', 'pgPool'] as const)('%s server text transport', (binding) => {
  describe.each(['buffered', 'cursor', 'named cursor'] as const)('%s', (mode) => {
    let close: (() => Promise<void>) | undefined;

    afterEach(async () => {
      await close?.();
      close = undefined;
    }, timeouts.spinUpPpgDev);

    it(
      'returns every column as server text and leaves pg global parsers unchanged',
      async () => {
        const opened = await openDevDriver(binding, mode);
        close = opened.close;

        expect(await queryRowsInMode(opened.driver, mode, SELECT_ROW)).toEqual([SERVER_TEXT]);
        expect({
          bool: pg.types.getTypeParser(pg.types.builtins.BOOL)('t'),
          int4: pg.types.getTypeParser(pg.types.builtins.INT4)('2'),
          float8: pg.types.getTypeParser(pg.types.builtins.FLOAT8)('NaN'),
          bytea: pg.types.getTypeParser(pg.types.builtins.BYTEA)('\\x01'),
          jsonb: pg.types.getTypeParser(pg.types.builtins.JSONB)('{"a":1}'),
        }).toEqual({
          bool: true,
          int4: 2,
          float8: Number.NaN,
          bytea: Buffer.from([1]),
          jsonb: { a: 1 },
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
