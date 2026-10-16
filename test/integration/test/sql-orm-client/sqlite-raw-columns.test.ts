import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { integerColumn, rawColumn } from '@internal/adapter-sqlite/column-types';
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

const OwnerBase = model('Owner', {
  fields: {
    id: field.column(integerColumn).id(),
    shape: field.column(rawColumn('geometry')).optional(),
  },
}).sql({ table: 'raw_owners' });

const Place = model('Place', {
  fields: {
    id: field.column(integerColumn).id(),
    ownerId: field.column(integerColumn).column('owner_id'),
    shape: field.column(rawColumn('geometry')).optional(),
  },
  relations: { owner: rel.belongsTo(OwnerBase, { from: 'ownerId', to: 'id' }) },
}).sql({ table: 'raw_places' });

const Owner = OwnerBase.relations({
  places: rel.hasMany(() => Place, { by: 'ownerId' }),
}).sql({ table: 'raw_owners' });

const contract = defineContract({ models: { Owner, Place } });
const stack = createSqlExecutionStack({
  target: sqliteTarget,
  adapter: sqliteAdapter,
  driver: sqliteDriver,
});
const context = createExecutionContext({ contract, stack });

/** One value of each storage class, in the shape the driver reads it. */
const values = [
  { shape: new Uint8Array([0x00, 0x01, 0x0a, 0xff]), storageClass: 'blob' },
  { shape: 42, storageClass: 'integer' },
  { shape: 1.5, storageClass: 'real' },
  { shape: 'POINT(1 2)', storageClass: 'text' },
  { shape: null, storageClass: 'null' },
] as const;

describe('a SQLite raw value, read flat and through relation includes', () => {
  let directory: string | undefined;
  let database: DatabaseSync | undefined;
  let runtime: SqliteRuntimeImpl | undefined;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'pn-sqlite-raw-'));
    const path = join(directory, 'test.db');
    database = new DatabaseSync(path);
    database.exec(`
      create table raw_owners (id integer primary key, shape geometry);
      create table raw_places (id integer primary key, owner_id integer not null, shape geometry);
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

  it('keeps the shape of its storage class, and writes back as read', async () => {
    const namespace = { namespaceId: soleDomainNamespaceId(contract.domain) };
    const owners = new Collection({ runtime: runtime!, context }, 'Owner', namespace);
    const places = new Collection({ runtime: runtime!, context }, 'Place', namespace);
    for (const [index, { shape }] of values.entries()) {
      await owners.create({ id: index + 1, shape });
      await places.create({ id: index + 1, ownerId: index + 1, shape });
    }

    const flat = await places
      .select('id', 'shape')
      .orderBy((p) => p['id']!.asc())
      .all();
    const toMany = await owners
      .select('id')
      .include('places', (place) => place.select('id', 'shape'))
      .orderBy((o) => o['id']!.asc())
      .all();
    const toOne = await places
      .select('id')
      .include('owner', (owner) => owner.select('id', 'shape'))
      .orderBy((p) => p['id']!.asc())
      .all();
    for (const { id, shape } of flat) {
      await places.create({ id: id + 10, ownerId: id, shape });
    }
    const writtenBack = await places
      .select('id', 'shape')
      .where((p) => p['id']!.gt(10))
      .orderBy((p) => p['id']!.asc())
      .all();

    const rows = values.map(({ shape }, index) => ({ id: index + 1, shape }));
    expect({ flat, toMany, toOne, writtenBack }).toEqual({
      flat: rows,
      toMany: rows.map((row) => ({ id: row.id, places: [row] })),
      toOne: rows.map((row) => ({ id: row.id, owner: row })),
      writtenBack: rows.map((row) => ({ ...row, id: row.id + 10 })),
    });
    const storageClasses = database!
      .prepare('select typeof(shape) as storageClass from raw_places order by id')
      .all();
    expect(storageClasses).toEqual(
      [...values, ...values].map(({ storageClass }) => ({ storageClass })),
    );
  });
});
