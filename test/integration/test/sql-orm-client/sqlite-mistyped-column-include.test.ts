import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import {
  blobColumn,
  decimalStringColumn,
  integerBigIntColumn,
  integerBooleanColumn,
  integerNumberColumn,
  realColumn,
} from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import { soleDomainNamespaceId } from '@internal/contract/types';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import { defineContract, field, model, rel } from '@internal/sqlite/contract-builder';
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { InternalError } from '@internal/utils/internal-error';
import { join } from 'pathe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const sqlInt = { codecId: 'sql/int@1' } as const;
const bigintNumber = { codecId: 'sqlite/bigintnumber@1' } as const;

const Cell = model('Cell', {
  fields: {
    id: field.column(integerNumberColumn).id(),
    sheetId: field.column(integerNumberColumn).column('sheet_id'),
    integer: field.column(integerNumberColumn).optional(),
    sqlInt: field.column(sqlInt).column('sql_int').optional(),
    blob: field.column(blobColumn).optional(),
    boolean: field.column(integerBooleanColumn).optional(),
    decimal: field.column(decimalStringColumn).optional(),
    bigint: field.column(integerBigIntColumn).optional(),
    bigintNumber: field.column(bigintNumber).column('bigint_number').optional(),
    real: field.column(realColumn).optional(),
  },
}).sql({ table: 'mistyped_cells' });

const Sheet = model('Sheet', {
  fields: { id: field.column(integerNumberColumn).id() },
  relations: { cells: rel.hasMany(() => Cell, { by: 'sheetId' }) },
}).sql({ table: 'mistyped_sheets' });

const contract = defineContract({ models: { Sheet, Cell } });
const stack = createSqlExecutionStack({
  target: sqliteTarget,
  adapter: sqliteAdapter,
  driver: sqliteDriver,
});
const context = createExecutionContext({ contract, stack });

const notAnInteger = (column: string, shown: string, codecId: string) =>
  `Column "mistyped_cells"."${column}" holds ${shown}, which is not an integer within the safe integer range. ${codecId} reads integers from -9007199254740991 to 9007199254740991.`;

const BLOB_REFUSAL =
  'sqlite/blob@1 wire value must be bytes, or the array of their hex text an include carries';

// Outside a STRICT table, SQLite keeps a value of any type in any column. A codec reads a row and an
// include with the same fromWire, so a value its type does not hold is refused both ways.
describe('a SQLite column holding a value of another type, read flat and through an include', () => {
  let directory: string | undefined;
  let database: DatabaseSync | undefined;
  let runtime: SqliteRuntimeImpl | undefined;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'pn-sqlite-mistyped-'));
    const path = join(directory, 'test.db');
    database = new DatabaseSync(path);
    database.exec(`
      create table mistyped_sheets (id integer primary key);
      create table mistyped_cells (
        id integer primary key,
        sheet_id integer not null,
        integer integer,
        sql_int integer,
        blob blob,
        boolean integer,
        decimal text,
        bigint integer,
        bigint_number integer,
        real real
      );
      insert into mistyped_sheets (id) values (1), (2), (3), (4), (5), (6), (7), (8), (9), (10), (11), (12), (13), (14);
      insert into mistyped_cells (id, sheet_id, integer, sql_int, blob, boolean, decimal) values
        (1, 1, 7, 8, x'00ff', 1, '12.50'),
        (2, 2, 'abc', null, null, null, null),
        (3, 3, null, x'00ff', null, null, null),
        (4, 4, null, null, 'ABCD', null, null),
        (5, 5, null, null, 42, null, null),
        (6, 6, null, 'abc', null, null, null),
        (7, 7, x'35', null, null, null, null),
        (8, 8, x'00ff', null, null, null, null),
        (9, 9, null, x'35', null, null, null),
        (10, 10, null, null, null, x'01', null),
        (11, 11, null, null, null, null, x'3132');
      insert into mistyped_cells (id, sheet_id, bigint, bigint_number, real) values
        (12, 12, x'35', null, null),
        (13, 13, null, x'35', null),
        (14, 14, null, null, x'00ff');
    `);
    const instance = instantiateExecutionStack(stack);
    if (instance.adapter === undefined || instance.driver === undefined) {
      throw new InternalError('SQLite execution stack is missing its adapter or driver');
    }
    await instance.driver.connect({ kind: 'path', path });
    runtime = new SqliteRuntimeImpl({
      context,
      adapter: instance.adapter,
      driver: instance.driver,
    });
  });

  afterAll(async () => {
    await runtime?.close();
    database?.close();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  });

  function collections() {
    const namespace = { namespaceId: soleDomainNamespaceId(contract.domain) };
    return {
      sheets: new Collection({ runtime: runtime!, context }, 'Sheet', namespace),
      cells: new Collection({ runtime: runtime!, context }, 'Cell', namespace),
    };
  }

  const includeCells = (sheetId: number) =>
    collections()
      .sheets.where((s) => s['id']!.eq(sheetId))
      .select('id')
      .include('cells', (cell) =>
        cell.select(
          'id',
          'integer',
          'sqlInt',
          'blob',
          'boolean',
          'decimal',
          'bigint',
          'bigintNumber',
          'real',
        ),
      )
      .all();

  const readCell = (id: number) =>
    collections()
      .cells.where((c) => c['id']!.eq(id))
      .select(
        'id',
        'integer',
        'sqlInt',
        'blob',
        'boolean',
        'decimal',
        'bigint',
        'bigintNumber',
        'real',
      )
      .all();

  it('reads values of the column types the same way flat and through an include', async () => {
    const flat = await readCell(1);
    expect({ flat, include: await includeCells(1) }).toEqual({
      flat: [
        {
          id: 1,
          integer: 7,
          sqlInt: 8,
          blob: new Uint8Array([0x00, 0xff]),
          boolean: true,
          decimal: '12.50',
          bigint: null,
          bigintNumber: null,
          real: null,
        },
      ],
      include: [{ id: 1, cells: flat }],
    });
  });

  it.each([
    [
      'text in an INTEGER column',
      2,
      'integer',
      'sqlite/integer@1',
      notAnInteger('integer', '"abc"', 'sqlite/integer@1'),
    ],
    [
      'one byte in an INTEGER column, which a cast to text would read as the digit it spells',
      7,
      'integer',
      'sqlite/integer@1',
      notAnInteger('integer', "bytes x'35'", 'sqlite/integer@1'),
    ],
    [
      'two bytes in an INTEGER column',
      8,
      'integer',
      'sqlite/integer@1',
      notAnInteger('integer', "bytes x'00FF'", 'sqlite/integer@1'),
    ],
    [
      'text in an INTEGER column read as sql/int@1',
      6,
      'sql_int',
      'sql/int@1',
      notAnInteger('sql_int', '"abc"', 'sql/int@1'),
    ],
    [
      'one byte in an INTEGER column read as sql/int@1',
      9,
      'sql_int',
      'sql/int@1',
      notAnInteger('sql_int', "bytes x'35'", 'sql/int@1'),
    ],
    [
      'two bytes in an INTEGER column read as sql/int@1',
      3,
      'sql_int',
      'sql/int@1',
      notAnInteger('sql_int', "bytes x'00FF'", 'sql/int@1'),
    ],
    [
      'bytes in a Boolean column',
      10,
      'boolean',
      'sqlite/boolean@1',
      `Column "mistyped_cells"."boolean" holds bytes x'01', which is not 0 or 1. sqlite/boolean@1 reads 0 as false and 1 as true.`,
    ],
    [
      'bytes in a Decimal column',
      11,
      'decimal',
      'sqlite/decimal@1',
      `Column "mistyped_cells"."decimal" holds bytes x'3132', which is not decimal text. sqlite/decimal@1 reads decimal text, such as "12.50".`,
    ],
    [
      'hex text in a BLOB column, which is text and not bytes',
      4,
      'blob',
      'sqlite/blob@1',
      BLOB_REFUSAL,
    ],
    ['a number in a BLOB column', 5, 'blob', 'sqlite/blob@1', BLOB_REFUSAL],
    [
      'one byte in a BigInt column, which a cast to text would read as the digit it spells',
      12,
      'bigint',
      'sqlite/bigint@1',
      `Column "mistyped_cells"."bigint" holds bytes x'35', which is not an integer. sqlite/bigint@1 reads integers from -9223372036854775808 to 9223372036854775807.`,
    ],
    [
      'one byte in an INTEGER column read as sqlite/bigintnumber@1',
      13,
      'bigint_number',
      'sqlite/bigintnumber@1',
      notAnInteger('bigint_number', "bytes x'35'", 'sqlite/bigintnumber@1'),
    ],
    [
      'bytes in a REAL column',
      14,
      'real',
      'sqlite/real@1',
      `Column "mistyped_cells"."real" holds bytes x'00FF', which is not a number. sqlite/real@1 reads a number, or the text Infinity or -Infinity.`,
    ],
  ])('refuses %s', async (_name, id, column, codecId, message) => {
    await expect(readCell(id)).rejects.toMatchObject({ code: 'RUNTIME.DECODE_FAILED', message });
    await expect(includeCells(id)).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: `Failed to decode column mistyped_cells.${column} with codec '${codecId}': ${message}`,
      cause: { code: 'RUNTIME.DECODE_FAILED', message },
    });
  });
});
