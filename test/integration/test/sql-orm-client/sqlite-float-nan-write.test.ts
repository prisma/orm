import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { integerColumn, realColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import { soleDomainNamespaceId } from '@internal/contract/types';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import { defineContract, field, model } from '@internal/sqlite/contract-builder';
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { InternalError } from '@internal/utils/internal-error';
import { join } from 'pathe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const sqlFloat = { codecId: 'sql/float@1', nativeType: 'real' } as const;

const Point = model('Point', {
  fields: {
    id: field.column(integerColumn).id(),
    real: field.column(realColumn).optional(),
    sqlFloat: field.column(sqlFloat).column('sql_float').optional(),
  },
}).sql({ table: 'nan_points' });

const contract = defineContract({ models: { Point } });
const stack = createSqlExecutionStack({
  target: sqliteTarget,
  adapter: sqliteAdapter,
  driver: sqliteDriver,
});
const context = createExecutionContext({ contract, stack });

const nanRefusal = (codecId: string) => ({
  code: 'RUNTIME.ENCODE_FAILED',
  message: `${codecId} value must be a number other than NaN, which SQLite cannot store`,
});

async function outcome(run: () => PromiseLike<unknown>) {
  try {
    return { resolved: await run() };
  } catch (error) {
    const { code, message } = error as { code?: string; message: string };
    return { code, message };
  }
}

describe('NaN written to or filtered by a SQLite REAL column', () => {
  let directory: string | undefined;
  let database: DatabaseSync | undefined;
  let runtime: SqliteRuntimeImpl | undefined;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'pn-sqlite-float-nan-'));
    const path = join(directory, 'test.db');
    database = new DatabaseSync(path);
    database.exec(`
      create table nan_points (
        id integer primary key,
        real real,
        sql_float real
      );
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

  function points() {
    return new Collection({ runtime: runtime!, context }, 'Point', {
      namespaceId: soleDomainNamespaceId(contract.domain),
    });
  }

  it('is refused on insert through sqlite/real@1 and sql/float@1 alike, and nothing is stored', async () => {
    const inserts = [
      await outcome(() => points().create({ id: 1, real: Number.NaN })),
      await outcome(() => points().create({ id: 2, sqlFloat: Number.NaN })),
    ];
    expect({ inserts, stored: database!.prepare('select * from nan_points').all() }).toEqual({
      inserts: [nanRefusal('sqlite/real@1'), nanRefusal('sql/float@1')],
      stored: [],
    });
  });

  it('is refused as a filter value through either codec', async () => {
    expect([
      await outcome(() =>
        points()
          .where((p) => p['real']!.eq(Number.NaN))
          .all(),
      ),
      await outcome(() =>
        points()
          .where((p) => p['sqlFloat']!.eq(Number.NaN))
          .all(),
      ),
    ]).toEqual([nanRefusal('sqlite/real@1'), nanRefusal('sql/float@1')]);
  });

  it('leaves Infinity and -Infinity to be stored and read back through either codec', async () => {
    await points().create({
      id: 10,
      real: Number.POSITIVE_INFINITY,
      sqlFloat: Number.NEGATIVE_INFINITY,
    });
    expect(
      await points()
        .where((p) => p['id']!.eq(10))
        .select('id', 'real', 'sqlFloat')
        .all(),
    ).toEqual([{ id: 10, real: Number.POSITIVE_INFINITY, sqlFloat: Number.NEGATIVE_INFINITY }]);
  });
});
