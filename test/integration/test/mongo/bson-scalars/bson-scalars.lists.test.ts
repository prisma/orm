import { MongoFieldFilter } from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const idA = '65f0000000000000000000e1';
const idB = '65f0000000000000000000e2';
const at = new Date('2024-01-02T03:04:05.000Z');

const empty = {
  ints: [],
  doubles: [],
  longs: [],
  ids: [],
  decimals: [],
  bytes: [],
  words: [],
  flags: [],
  dates: [],
  points: [],
};

const filled = {
  ints: [1, 2],
  doubles: [1.5, 2],
  longs: [9_007_199_254_740_993n, 5n],
  ids: [idA, idB],
  decimals: ['1.50', '2'],
  bytes: [new Uint8Array([1, 2])],
  words: ['a', 'b'],
  flags: [true, false],
  dates: [at],
  points: [{ x: 3, tags: [7n] }],
};

describe('Mongo list fields', () => {
  it(
    'write every scalar list type, empty and filled, stored as the element BSON type and read back',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await db.series.create(empty);
        await db.series.create(filled);

        const [stored] = await mongoDb
          .collection('series')
          .aggregate([
            { $match: { 'ints.0': { $exists: true } } },
            {
              $project: {
                _id: 0,
                types: [
                  { $type: { $arrayElemAt: ['$ints', 0] } },
                  { $type: { $arrayElemAt: ['$doubles', 1] } },
                  { $type: { $arrayElemAt: ['$longs', 1] } },
                  { $type: { $arrayElemAt: ['$ids', 0] } },
                  { $type: { $arrayElemAt: ['$decimals', 0] } },
                  { $type: { $arrayElemAt: ['$bytes', 0] } },
                  { $type: { $arrayElemAt: ['$dates', 0] } },
                  { $type: { $arrayElemAt: [{ $arrayElemAt: ['$points.tags', 0] }, 0] } },
                ],
              },
            },
          ])
          .toArray();
        expect(stored).toEqual({
          types: ['int', 'double', 'long', 'objectId', 'decimal', 'binData', 'date', 'long'],
        });

        const rows = await db.series.all();
        expect(rows.map(({ _id: _, ...row }) => row)).toEqual([empty, filled]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'set, compare and change a whole list and its elements through their element codec',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await db.series.create(empty);

        await db.series
          .where(MongoFieldFilter.eq('ints', []))
          .update({ ints: [3, 4], longs: [1n], ids: [idA] });
        expect(await db.series.where(MongoFieldFilter.eq('ints', [3, 4])).all()).toHaveLength(1);
        await db.series
          .where(MongoFieldFilter.eq('longs', [new MongoParamRef(1n)]))
          .update((u) => [u.longs.push(2n), u.ids.addToSet(idB), u.doubles.push(2), u.ints.pop(1)]);

        const [stored] = await mongoDb
          .collection('series')
          .aggregate([
            {
              $project: {
                _id: 0,
                ints: 1,
                ids: 1,
                longTypes: { $map: { input: '$longs', in: { $type: '$$this' } } },
                doubleTypes: { $map: { input: '$doubles', in: { $type: '$$this' } } },
              },
            },
          ])
          .toArray();
        expect(stored).toEqual({
          ints: [3],
          ids: [new ObjectId(idA), new ObjectId(idB)],
          longTypes: ['long', 'long'],
          doubleTypes: ['double'],
        });
        const [row] = await db.series.all();
        expect(row).toMatchObject({ ints: [3], longs: [1n, 2n], ids: [idA, idB], doubles: [2] });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it.each([
    ['words', 'mongo/string@1', 'must be a string'],
    ['flags', 'mongo/bool@1', 'must be a boolean'],
    ['dates', 'mongo/date@1', 'must be a valid Date'],
    ['ids', 'mongo/objectId@1', 'must be a 24-digit hex string or an ObjectId'],
  ] as const)(
    'refuse a null element in a %s list, naming the element',
    (field, codec, rule) =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await expect(
          db.series.create({ ...empty, [field]: [null] } as unknown as typeof empty),
        ).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
          message: `Failed to encode field ${field}.0 in collection 'series' with codec '${codec}': ${codec} value ${rule}; received null`,
        });
        expect(await mongoDb.collection('series').countDocuments()).toBe(0);
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
