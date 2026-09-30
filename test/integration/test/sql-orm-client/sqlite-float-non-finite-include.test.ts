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
import { defineContract, field, model, rel } from '@internal/sqlite/contract-builder';
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { InternalError } from '@internal/utils/internal-error';
import { join } from 'pathe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const sqlFloat = { codecId: 'sql/float@1', nativeType: 'real' } as const;

const PointBase = model('Point', {
  fields: {
    id: field.column(integerColumn).id(),
    seriesId: field.column(integerColumn).column('series_id'),
    real: field.column(realColumn),
    sqlFloat: field.column(sqlFloat).column('sql_float'),
  },
}).sql({ table: 'float_points' });

const Series = model('Series', {
  fields: { id: field.column(integerColumn).id() },
  relations: { points: rel.hasMany(() => PointBase, { by: 'seriesId' }) },
}).sql({ table: 'float_series' });

const contract = defineContract({ models: { Series, Point: PointBase } });
const stack = createSqlExecutionStack({
  target: sqliteTarget,
  adapter: sqliteAdapter,
  driver: sqliteDriver,
});
const context = createExecutionContext({ contract, stack });

describe('a SQLite REAL column holding an infinity, read through a relation include', () => {
  let directory: string | undefined;
  let database: DatabaseSync | undefined;
  let runtime: SqliteRuntimeImpl | undefined;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'pn-sqlite-float-'));
    const path = join(directory, 'test.db');
    database = new DatabaseSync(path);
    database.exec(`
      create table float_series (id integer primary key);
      create table float_points (
        id integer primary key,
        series_id integer not null,
        real real not null,
        sql_float real not null
      );
      insert into float_series (id) values (1), (2), (3);
      insert into float_points (id, series_id, real, sql_float) values
        (1, 1, 9e999, 9e999),
        (2, 1, -9e999, -9e999),
        (3, 1, 1.5, 1.5),
        (4, 2, 'abc', 'abc'),
        (5, 3, x'00ff', x'00ff');
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
      series: new Collection({ runtime: runtime!, context }, 'Series', namespace),
      points: new Collection({ runtime: runtime!, context }, 'Point', namespace),
    };
  }

  function includePoints(seriesId: number) {
    return collections()
      .series.where((s) => s['id']!.eq(seriesId))
      .select('id')
      .include('points', (point) =>
        point.select('id', 'real', 'sqlFloat').orderBy((p) => p['id']!.asc()),
      )
      .all();
  }

  function readPoints(ids: readonly number[]) {
    return collections()
      .points.where((p) => p['id']!.in(ids))
      .select('id', 'real', 'sqlFloat')
      .orderBy((p) => p['id']!.asc())
      .all();
  }

  it('comes back as Infinity and -Infinity for sqlite/real@1 and sql/float@1, as a flat read does', async () => {
    const flat = await readPoints([1, 2, 3]);

    expect({ include: await includePoints(1), flat }).toEqual({
      include: [{ id: 1, points: flat }],
      flat: [
        { id: 1, real: Number.POSITIVE_INFINITY, sqlFloat: Number.POSITIVE_INFINITY },
        { id: 2, real: Number.NEGATIVE_INFINITY, sqlFloat: Number.NEGATIVE_INFINITY },
        { id: 3, real: 1.5, sqlFloat: 1.5 },
      ],
    });
  });

  // Outside a STRICT table, SQLite keeps text and a blob in a REAL column as they are.
  it('refuses text in a REAL column through an include rather than reading it as a number', async () => {
    expect(await readPoints([4])).toEqual([{ id: 4, real: 'abc', sqlFloat: 'abc' }]);
    await expect(includePoints(2)).rejects.toThrow(
      expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED' }),
    );
  });

  it('refuses a blob in a REAL column through an include rather than reading it as a number', async () => {
    const [flat] = await readPoints([5]);
    expect(flat?.real).toEqual(new Uint8Array([0x00, 0xff]));
    await expect(includePoints(3)).rejects.toThrow('JSON cannot hold BLOB values');
  });
});
