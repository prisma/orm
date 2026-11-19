import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { integerColumn } from '@internal/adapter-sqlite/column-types';
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

const char3 = { codecId: 'sql/char@1', typeParams: { length: 3 } } as const;

const PointBase = model('Point', {
  fields: {
    id: field.column(integerColumn).id(),
    seriesId: field.column(integerColumn).column('series_id'),
    code: field.column(char3),
  },
}).sql({ table: 'char_points' });

const Series = model('Series', {
  fields: { id: field.column(integerColumn).id() },
  relations: { points: rel.hasMany(() => PointBase, { by: 'seriesId' }) },
}).sql({ table: 'char_series' });

const contract = defineContract({ models: { Series, Point: PointBase } });
const stack = createSqlExecutionStack({
  target: sqliteTarget,
  adapter: sqliteAdapter,
  driver: sqliteDriver,
});
const context = createExecutionContext({ contract, stack });

describe('a SQLite sql/char@1 value, which SQLite stores unpadded, read through a relation include', () => {
  let directory: string | undefined;
  let database: DatabaseSync | undefined;
  let runtime: SqliteRuntimeImpl | undefined;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'pn-sqlite-char-'));
    const path = join(directory, 'test.db');
    database = new DatabaseSync(path);
    database.exec(`
      create table char_series (id integer primary key);
      create table char_points (
        id integer primary key,
        series_id integer not null,
        code text not null
      );
      insert into char_series (id) values (1);
      insert into char_points (id, series_id, code) values
        (1, 1, 'a  '),
        (2, 1, 'a' || char(9)),
        (3, 1, 'abc');
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

  it('is the value a flat read returns, as SQLite stores it', async () => {
    const namespace = { namespaceId: soleDomainNamespaceId(contract.domain) };
    const flat = await new Collection({ runtime: runtime!, context }, 'Point', namespace)
      .select('id', 'code')
      .orderBy((p) => p['id']!.asc())
      .all();
    const included = await new Collection({ runtime: runtime!, context }, 'Series', namespace)
      .select('id')
      .include('points', (point) => point.select('id', 'code').orderBy((p) => p['id']!.asc()))
      .all();

    expect({ flat, included }).toEqual({
      flat: [
        { id: 1, code: 'a  ' },
        { id: 2, code: 'a\t' },
        { id: 3, code: 'abc' },
      ],
      included: [{ id: 1, points: flat }],
    });
  });

  it('is read with the spaces it was written with, so a filter on the value read finds it', async () => {
    const namespace = { namespaceId: soleDomainNamespaceId(contract.domain) };
    const points = () => new Collection({ runtime: runtime!, context }, 'Point', namespace);
    await points().createAndCount([{ id: 10, seriesId: 1, code: 'b ' }]);
    const read = await points().where({ id: 10 }).select('code').all();

    expect({
      stored: { ...database!.prepare('select code from char_points where id = 10').get() },
      read,
      foundByValueRead: await points().where({ code: read[0]?.['code'] }).select('id').all(),
      foundWithoutTheSpace: await points().where({ code: 'b' }).select('id').all(),
    }).toEqual({
      stored: { code: 'b ' },
      read: [{ code: 'b ' }],
      foundByValueRead: [{ id: 10 }],
      foundWithoutTheSpace: [],
    });
  });
});
