import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { blobColumn, integerColumn } from '@internal/adapter-sqlite/column-types';
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

const Cell = model('Cell', {
  fields: {
    id: field.column(integerColumn).id(),
    sheetId: field.column(integerColumn).column('sheet_id'),
    integer: field.column(integerColumn).optional(),
    sqlInt: field.column(sqlInt).column('sql_int').optional(),
    blob: field.column(blobColumn).optional(),
  },
}).sql({ table: 'mistyped_cells' });

const Sheet = model('Sheet', {
  fields: { id: field.column(integerColumn).id() },
  relations: { cells: rel.hasMany(() => Cell, { by: 'sheetId' }) },
}).sql({ table: 'mistyped_sheets' });

const contract = defineContract({ models: { Sheet, Cell } });
const stack = createSqlExecutionStack({
  target: sqliteTarget,
  adapter: sqliteAdapter,
  driver: sqliteDriver,
});
const context = createExecutionContext({ contract, stack });

const refusal = (codecId: string, reason: string) => ({
  code: 'RUNTIME.DECODE_FAILED',
  message: expect.stringContaining(`${codecId} wire value must be ${reason}`),
});

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
        blob blob
      );
      insert into mistyped_sheets (id) values (1), (2), (3), (4), (5), (6);
      insert into mistyped_cells (id, sheet_id, integer, sql_int, blob) values
        (1, 1, 7, 8, x'00ff'),
        (2, 2, 'abc', null, null),
        (3, 3, null, x'00ff', null),
        (4, 4, null, null, 'ABCD'),
        (5, 5, null, null, 42),
        (6, 6, null, 'abc', null);
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
      .include('cells', (cell) => cell.select('id', 'integer', 'sqlInt', 'blob'))
      .all();

  const readCell = (id: number) =>
    collections()
      .cells.where((c) => c['id']!.eq(id))
      .select('id', 'integer', 'sqlInt', 'blob')
      .all();

  it('reads values of the column types the same way flat and through an include', async () => {
    const flat = await readCell(1);
    expect({ flat, include: await includeCells(1) }).toEqual({
      flat: [{ id: 1, integer: 7, sqlInt: 8, blob: new Uint8Array([0x00, 0xff]) }],
      include: [{ id: 1, cells: flat }],
    });
  });

  it.each([
    ['text in an INTEGER column', 2, 'sqlite/integer@1', 'an integer or its decimal text'],
    ['a blob in an INTEGER column', 3, 'sql/int@1', 'an integer or its decimal text'],
    [
      'text in an INTEGER column read as sql/int@1',
      6,
      'sql/int@1',
      'an integer or its decimal text',
    ],
    [
      'hex text in a BLOB column, which is text and not bytes',
      4,
      'sqlite/blob@1',
      'bytes, or the array of their hex text an include carries',
    ],
    [
      'a number in a BLOB column',
      5,
      'sqlite/blob@1',
      'bytes, or the array of their hex text an include carries',
    ],
  ])('refuses %s', async (_name, id, codecId, reason) => {
    await expect(readCell(id)).rejects.toMatchObject(refusal(codecId, reason));
    await expect(includeCells(id)).rejects.toMatchObject(refusal(codecId, reason));
  });
});
