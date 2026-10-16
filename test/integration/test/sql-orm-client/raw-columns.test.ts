import { int4Column, rawColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { defineContract, field, model, rel } from '@internal/postgres/contract-builder';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { timeouts, withPushedContractRuntime } from './integration-helpers';

const ShelfBase = model('Shelf', {
  fields: {
    id: field.column(int4Column).id(),
    search: field.column(rawColumn('tsvector')),
    area: field.column(rawColumn('circle')),
    size: field.column(rawColumn('integer')),
    open: field.column(rawColumn('boolean')),
    net: field.column(rawColumn('cidr')).optional(),
    nets: field.column(rawColumn('cidr')).many(),
    codes: field.column(rawColumn('character varying(3)')).many(),
  },
}).sql({ table: 'raw_shelves' });

const Book = model('Book', {
  fields: {
    id: field.column(int4Column).id(),
    shelfId: field.column(int4Column).column('shelf_id'),
    search: field.column(rawColumn('tsvector')),
  },
  relations: { shelf: rel.belongsTo(ShelfBase, { from: 'shelfId', to: 'id' }) },
}).sql({ table: 'raw_books' });

const Shelf = ShelfBase.relations({
  books: rel.hasMany(() => Book, { by: 'shelfId' }),
}).sql({ table: 'raw_shelves' });

const contract = defineContract({ models: { Shelf, Book } });
const context = createExecutionContext({
  contract,
  stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
});
const namespace = { namespaceId: 'public' };

const shelfFields = ['id', 'search', 'area', 'size', 'open', 'net', 'nets', 'codes'] as const;

/** Each raw value as the text the database prints for it. */
const shelfAsPrinted = {
  id: 1,
  search: "'a' 'b'",
  area: '<(0,0),1>',
  size: '42',
  open: 't',
  net: null,
  nets: ['10.0.0.0/8', '192.168.0.0/16'],
  codes: ['abc', 'xy'],
};

describe('raw fields through the ORM', () => {
  it(
    'read as the text the database prints, flat and through includes, and write back as read',
    async () => {
      await withPushedContractRuntime(contract, async (runtime) => {
        const shelves = new Collection({ runtime, context }, 'Shelf', namespace);
        const books = new Collection({ runtime, context }, 'Book', namespace);
        await shelves.create({
          id: 1,
          search: 'b a',
          area: '<(0,0),1>',
          size: '42',
          open: 'true',
          net: null,
          nets: ['10.0.0.0/8', '192.168.0.0/16'],
          codes: ['abc', 'xy'],
        });
        await books.create({ id: 1, shelfId: 1, search: 'c' });

        const flat = await shelves.select(...shelfFields).all();
        const toMany = await shelves
          .select('id')
          .include('books', (book) => book.select('id', 'search'))
          .all();
        const toOne = await books
          .select('id')
          .include('shelf', (shelf) => shelf.select(...shelfFields))
          .all();
        const [read] = flat;
        await shelves.create({ ...read, id: 2 } as Parameters<typeof shelves.create>[0]);
        const writtenBack = await shelves
          .select(...shelfFields)
          .where((s) => s['id']!.eq(2))
          .all();

        expectTypeOf(flat).toEqualTypeOf<
          {
            id: number;
            search: unknown;
            area: unknown;
            size: unknown;
            open: unknown;
            net: unknown;
            nets: readonly unknown[];
            codes: readonly unknown[];
          }[]
        >();
        expect({ flat, toMany, toOne, writtenBack }).toEqual({
          flat: [shelfAsPrinted],
          toMany: [{ id: 1, books: [{ id: 1, search: "'c'" }] }],
          toOne: [{ id: 1, shelf: shelfAsPrinted }],
          writtenBack: [{ ...shelfAsPrinted, id: 2 }],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'refuses a list element too long for its type instead of cutting it',
    async () => {
      await withPushedContractRuntime(contract, async (runtime) => {
        const shelves = new Collection({ runtime, context }, 'Shelf', namespace);
        await expect(
          shelves.create({
            id: 1,
            search: 'a',
            area: '<(0,0),1>',
            size: '1',
            open: 'false',
            net: null,
            nets: [],
            codes: ['abcdef'],
          }),
        ).rejects.toThrow(/too long/);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
