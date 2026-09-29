import type { ColumnDefaultLiteralValue } from '@internal/contract/types';
import { col, lit } from '@internal/sql-relational-core/contract-free';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { PostgresCreateTable } from '@internal/target-postgres/ddl';
import { buildColumnDefaultSql } from '@internal/target-postgres/planner-ddl-builders';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../src/core/control-adapter';
import type { PostgresContract } from '../src/core/types';

async function createTableDefault(
  nativeType: string,
  codecId: string,
  value: ColumnDefaultLiteralValue,
  many = false,
): Promise<string> {
  const ast = new PostgresCreateTable({
    table: 't',
    columns: [col('v', nativeType, { default: lit(value), codecRef: { codecId, many } })],
  });
  const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
  const lowered = await adapter.lowerToExecuteRequest(ast, { contract: {} as PostgresContract });
  return lowered.sql.slice(lowered.sql.indexOf('DEFAULT'), lowered.sql.lastIndexOf('\n'));
}

function setDefault(
  nativeType: string,
  codecId: string,
  value: ColumnDefaultLiteralValue,
  many = false,
): string {
  return buildColumnDefaultSql({ kind: 'literal', value }, { nativeType, codecId, many });
}

describe('a date or time default in DDL', () => {
  it.each([
    ['timestamptz', 'pg/timestamptz-temporal@1', '2024-01-01T00:00:00Z', "'2024-01-01T00:00:00Z'"],
    [
      'timestamptz',
      'pg/timestamptz-temporal@1',
      '2024-01-01T00:00:00.000Z',
      "'2024-01-01T00:00:00Z'",
    ],
    ['timestamptz', 'pg/timestamptz-date@1', '2024-01-01T00:00:00.5Z', "'2024-01-01T00:00:00.5Z'"],
    ['timestamptz', 'pg/timestamptz-string@1', '2024-01-01 00:00:00+00', "'2024-01-01T00:00:00Z'"],
    [
      'timestamptz',
      'pg/timestamptz-temporal@1',
      '-000043-03-15T00:00:00Z',
      "'0044-03-15T00:00:00Z BC'",
    ],
    [
      'timestamptz',
      'pg/timestamptz-temporal@1',
      '0000-06-15T00:00:00Z',
      "'0001-06-15T00:00:00Z BC'",
    ],
    [
      'timestamptz',
      'pg/timestamptz-string@1',
      '+012026-01-02T03:04:05Z',
      "'12026-01-02T03:04:05Z'",
    ],
    ['timestamptz', 'pg/timestamptz-string@1', 'infinity', "'infinity'"],
    ['timestamp', 'pg/timestamp-temporal@1', '2024-01-01 12:00:00', "'2024-01-01T12:00:00'"],
    ['timestamp', 'pg/timestamp-temporal@1', '-000043-03-15T00:00:00', "'0044-03-15T00:00:00 BC'"],
    ['date', 'pg/date-temporal@1', '2024-01-01', "'2024-01-01'"],
    ['date', 'pg/date-temporal@1', '-000043-03-15', "'0044-03-15 BC'"],
    ['time', 'pg/time-temporal@1', '12:34:56.500', "'12:34:56.5'"],
    ['timetz', 'pg/timetz@1', '12:34:56+02', "'12:34:56+02:00'"],
    ['interval', 'pg/interval@1', 'P13M', "'P1Y1M'"],
  ])(
    'writes a %s default through %s, given %s, as %s in CREATE TABLE and in SET DEFAULT',
    async (nativeType, codecId, value, literal) => {
      expect({
        createTable: await createTableDefault(nativeType, codecId, value),
        setDefault: setDefault(nativeType, codecId, value),
      }).toEqual({
        createTable: `DEFAULT ${literal}::${nativeType}`,
        setDefault: `DEFAULT ${literal}`,
      });
    },
  );

  it('writes each element of a list default the same way in both paths', async () => {
    const value = ['2024-01-01T00:00:00.000Z', '-000043-03-15T00:00:00Z'];
    const array = "ARRAY['2024-01-01T00:00:00Z', '0044-03-15T00:00:00Z BC']::timestamptz[]";
    expect({
      createTable: await createTableDefault(
        'timestamptz[]',
        'pg/timestamptz-temporal@1',
        value,
        true,
      ),
      setDefault: setDefault('timestamptz', 'pg/timestamptz-temporal@1', value, true),
    }).toEqual({ createTable: `DEFAULT ${array}`, setDefault: `DEFAULT ${array}` });
  });
});
