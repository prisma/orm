import type { DdlColumn } from '@internal/sql-relational-core/ast';
import { col, fn, lit } from '@internal/sql-relational-core/contract-free';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import { describe, expect, it } from 'vitest';
import { createTestSqliteControlAdapter } from './helpers/test-control-adapter';

const adapter = createTestSqliteControlAdapter(createSqliteBuiltinCodecLookup());
const render = (column: DdlColumn) => adapter.renderColumnDefault(column, 't');

describe('the DEFAULT clause the SQLite adapter writes in every DDL statement', () => {
  it.each([
    ['no default', col('c', 'TEXT'), ''],
    ['a string', col('c', 'TEXT', { default: lit('hello') }), "DEFAULT 'hello'"],
    ['a number', col('c', 'INTEGER', { default: lit(42) }), 'DEFAULT 42'],
    ['true', col('c', 'INTEGER', { default: lit(true) }), 'DEFAULT 1'],
    ['false', col('c', 'INTEGER', { default: lit(false) }), 'DEFAULT 0'],
    ['null', col('c', 'TEXT', { default: lit(null) }), 'DEFAULT NULL'],
    [
      'a datetime, as the text its codec writes for every row',
      col('c', 'TEXT', {
        default: lit('2024-01-01T00:00:00.000Z'),
        codecRef: { codecId: 'sqlite/datetime@1' },
      }),
      "DEFAULT '2024-01-01T00:00:00.000Z'",
    ],
    [
      'a datetime before Christ',
      col('c', 'TEXT', {
        default: lit('-000043-03-15T00:00:00.500Z'),
        codecRef: { codecId: 'sqlite/datetime@1' },
      }),
      "DEFAULT '-000043-03-15T00:00:00.500Z'",
    ],
    [
      'date text on a text column, unchanged',
      col('c', 'TEXT', {
        default: lit('2024-01-01T00:00:00Z'),
        codecRef: { codecId: 'sqlite/text@1' },
      }),
      "DEFAULT '2024-01-01T00:00:00Z'",
    ],
    [
      'now(), as the text the datetime codec writes',
      col('c', 'TEXT', { default: fn('now()') }),
      "DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    ],
    [
      'now() on a date, as the text sqlite/date stores',
      col('c', 'TEXT', { default: fn('now()'), codecRef: { codecId: 'sqlite/date-string@1' } }),
      "DEFAULT (date('now'))",
    ],
    [
      'now() on a Temporal date, as the text sqlite/date stores',
      col('c', 'TEXT', { default: fn('now()'), codecRef: { codecId: 'sqlite/date-temporal@1' } }),
      "DEFAULT (date('now'))",
    ],
    [
      'now() on a time of day, as the text sqlite/time stores',
      col('c', 'TEXT', { default: fn('now()'), codecRef: { codecId: 'sqlite/time-string@1' } }),
      "DEFAULT (strftime('%H:%M:%f','now'))",
    ],
    [
      'now() on an instant read as text, as the text sqlite/datetime stores',
      col('c', 'TEXT', {
        default: fn('now()'),
        codecRef: { codecId: 'sqlite/datetime-string@1' },
      }),
      "DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    ],
    [
      'autoincrement(), which the type writes',
      col('c', 'INTEGER', { default: fn('autoincrement()') }),
      '',
    ],
    ['a function', col('c', 'REAL', { default: fn('random()') }), 'DEFAULT (random())'],
    [
      'a tagged-literal body, verbatim',
      col('c', 'TEXT', { default: fn('CURRENT_TIMESTAMP') }),
      'DEFAULT (CURRENT_TIMESTAMP)',
    ],
  ])('writes %s', async (_name, column, clause) => {
    expect(await render(column)).toBe(clause);
  });

  it.each(['$$x$$', "eek(); DROP TABLE 'x'"])(
    'refuses the unsafe expression %s with CONTRACT.DEFAULT_INVALID, the same rule as Postgres',
    async (expression) => {
      await expect(render(col('c', 'TEXT', { default: fn(expression) }))).rejects.toMatchObject({
        code: 'CONTRACT.DEFAULT_INVALID',
        meta: { expression },
      });
    },
  );

  it('refuses a literal its codec does not read, naming the table and the column', async () => {
    await expect(
      render(col('c', 'TEXT', { default: lit(1), codecRef: { codecId: 'sqlite/text@1' } })),
    ).rejects.toMatchObject({
      code: 'CONTRACT.DEFAULT_INVALID',
      meta: { table: 't', column: 'c', codecId: 'sqlite/text@1', value: 1 },
    });
  });
});
