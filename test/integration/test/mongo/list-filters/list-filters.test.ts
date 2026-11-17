import type { MongoWhereFilter } from '@internal/mongo-orm';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const documents = [
  { name: 'missing', strings: ['a'], nullableStrings: ['a'] },
  {
    name: 'null',
    nickname: null,
    strings: [],
    nullableStrings: [],
    optionalStrings: null,
    optionalNullableStrings: null,
    optionalEntries: null,
    optionalNullableEntries: null,
  },
  {
    name: 'empty',
    nickname: 'e',
    strings: [],
    nullableStrings: [],
    optionalStrings: [],
    optionalNullableStrings: [],
    optionalEntries: [],
    optionalNullableEntries: [],
  },
  {
    name: 'pair',
    nickname: 'p',
    strings: ['a', 'b'],
    nullableStrings: ['a', null],
    optionalStrings: ['a', 'b'],
    optionalNullableStrings: ['b'],
    optionalEntries: [{ value: 'b' }],
    optionalNullableEntries: [{ value: 'b' }],
  },
  {
    name: 'holdsNull',
    nickname: 'h',
    strings: ['c'],
    nullableStrings: [null],
    optionalStrings: ['c'],
    optionalNullableStrings: ['c', null],
    optionalEntries: [{ value: 'c' }],
    optionalNullableEntries: [{ value: 'c' }, null],
  },
];

const cases: ReadonlyArray<{
  readonly filter: MongoWhereFilter<Contract, 'Lists'>;
  readonly names: readonly string[];
}> = [
  { filter: { strings: ['a', 'b'] }, names: ['pair'] },
  { filter: { strings: [] }, names: ['empty', 'null'] },
  { filter: { strings: 'a' }, names: ['missing', 'pair'] },
  { filter: { nullableStrings: ['a', null] }, names: ['pair'] },
  { filter: { nullableStrings: [null] }, names: ['holdsNull'] },
  { filter: { nullableStrings: 'a' }, names: ['missing', 'pair'] },
  { filter: { optionalStrings: null }, names: ['missing', 'null'] },
  { filter: { optionalStrings: [] }, names: ['empty'] },
  { filter: { optionalStrings: ['a', 'b'] }, names: ['pair'] },
  { filter: { optionalStrings: 'b' }, names: ['pair'] },
  { filter: { optionalNullableStrings: ['c', null] }, names: ['holdsNull'] },
  { filter: { optionalNullableStrings: [] }, names: ['empty'] },
  { filter: { optionalNullableStrings: 'b' }, names: ['pair'] },
  { filter: { optionalNullableStrings: null }, names: ['missing', 'null'] },
  { filter: { nickname: null }, names: ['missing', 'null'] },
  { filter: { optionalEntries: null }, names: ['missing', 'null'] },
  { filter: { optionalEntries: [] }, names: ['empty'] },
  { filter: { optionalNullableEntries: null }, names: ['missing', 'null'] },
  { filter: { optionalNullableEntries: [{ value: 'c' }, null] }, names: ['holdsNull'] },
  { filter: { optionalEntries: { value: 'b' } }, names: ['pair'] },
  { filter: { optionalNullableEntries: { value: 'c' } }, names: ['holdsNull'] },
  { filter: { nickname: 'p' }, names: ['pair'] },
];

describe('Mongo where on list and nullable fields', () => {
  it(
    'matches a whole list exactly, one element by containment, and null as a null or missing field',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await mongoDb
          .collection('lists')
          .insertMany(documents.map((document) => ({ ...document })));

        const results = [];
        for (const { filter } of cases) {
          const rows = await db.lists.where(filter).select('name').orderBy({ name: 1 }).all();
          results.push({ filter, rows });
        }

        expect(results).toEqual(
          cases.map(({ filter, names }) => ({ filter, rows: names.map((name) => ({ name })) })),
        );
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'upserts after a one-element filter on a list by inserting only what the create data gives',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await db.lists.where({ optionalStrings: 'a' }).upsert({
          create: { name: 'created', strings: ['x'], nullableStrings: [] },
          update: { nickname: 'updated' },
        });

        expect(
          await mongoDb
            .collection('lists')
            .find({}, { projection: { _id: 0 } })
            .toArray(),
        ).toEqual([{ name: 'created', strings: ['x'], nullableStrings: [], nickname: 'updated' }]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
