import type { ColumnDefaultLiteralValue } from '@internal/contract/types';
import { col, lit } from '@internal/sql-relational-core/contract-free';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { PostgresCreateTable } from '@internal/target-postgres/ddl';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../src/core/control-adapter';
import type { PostgresContract } from '../src/core/types';

/**
 * The planner hands CREATE TABLE a default in canonical form; the literals below are the ones the
 * planner's SET DEFAULT writes for the same defaults.
 */
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

describe('a date or time default in CREATE TABLE', () => {
  it.each([
    ['timestamptz', 'pg/timestamptz-temporal@1', '2024-01-01T00:00:00Z', "'2024-01-01T00:00:00Z'"],
    ['timestamptz', 'pg/timestamptz-date@1', '2024-01-01T00:00:00.5Z', "'2024-01-01T00:00:00.5Z'"],
    ['timestamptz', 'pg/timestamptz-string@1', '2024-01-01T00:00:00Z', "'2024-01-01T00:00:00Z'"],
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
    ['timestamp', 'pg/timestamp-temporal@1', '-000043-03-15T00:00:00', "'0044-03-15T00:00:00 BC'"],
    ['date', 'pg/date-temporal@1', '-000043-03-15', "'0044-03-15 BC'"],
    ['time', 'pg/time-temporal@1', '12:34:56.5', "'12:34:56.5'"],
    ['timetz', 'pg/timetz@1', '12:34:56+02:00', "'12:34:56+02:00'"],
    ['interval', 'pg/interval@1', 'P1Y1M', "'P1Y1M'"],
  ])(
    'writes a %s default through %s, %s, as %s',
    async (nativeType, codecId, canonical, literal) => {
      expect(await createTableDefault(nativeType, codecId, canonical)).toBe(
        `DEFAULT ${literal}::${nativeType}`,
      );
    },
  );

  it.each([
    ['jsonb[]', 'pg/jsonb@1'],
    ['timestamptz[]', 'pg/timestamptz-temporal@1'],
  ])('writes a null %s container as SQL NULL with %s', async (nativeType, codecId) => {
    const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
    const column = col('v', nativeType, {
      default: lit(null),
      codecRef: { codecId, many: true },
    });
    expect(await createTableDefault(nativeType, codecId, null, true)).toBe('DEFAULT NULL');
    expect(await adapter.renderColumnDefault(column, 't')).toBe('DEFAULT NULL');
  });

  it('writes each element of a list default the same way', async () => {
    expect(
      await createTableDefault(
        'timestamptz[]',
        'pg/timestamptz-temporal@1',
        ['2024-01-01T00:00:00Z', '-000043-03-15T00:00:00Z'],
        true,
      ),
    ).toBe("DEFAULT ARRAY['2024-01-01T00:00:00Z', '0044-03-15T00:00:00Z BC']::timestamptz[]");
  });

  it.each([
    ['timestamptz', 'pg/timestamptz-temporal@1', 'not a date'],
    ['timestamptz', 'pg/timestamptz-date@1', '2024-01-01T00:00:00'],
    ['date', 'pg/date-temporal@1', '2024-02-30'],
    ['interval', 'pg/interval@1', '1 day'],
  ])(
    'refuses a %s default its codec %s does not read, %s, naming the column',
    async (nativeType, codecId, value) => {
      await expect(createTableDefault(nativeType, codecId, value)).rejects.toMatchObject({
        code: 'CONTRACT.DEFAULT_INVALID',
        meta: { table: 't', column: 'v', codecId, value, reason: 'codec-refused-default' },
      });
    },
  );
});
