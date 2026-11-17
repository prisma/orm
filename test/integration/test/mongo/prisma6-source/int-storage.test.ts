import { Double, Int32, Long } from 'mongodb';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

function bigintTypedAsNumber(value: bigint): number {
  return value as unknown as number;
}

describe('an Int in a Prisma 6 MongoDB schema', () => {
  it(
    'reads the BSON long Prisma 6 stores as the number the Prisma 6 client presents',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await mongoDb.collection('Counter').insertOne({
          name: 'written by Prisma 6',
          hits: Long.fromNumber(5),
          small: new Int32(3),
          large: Long.fromNumber(2 ** 40),
        });

        const read = await db.Counter.where({ name: 'written by Prisma 6' }).first();

        expect(read).toMatchObject({ hits: 5, small: 3, large: 2 ** 40 });
        expectTypeOf(read?.hits).toEqualTypeOf<number | undefined>();
        expectTypeOf(read?.large).toEqualTypeOf<number | undefined>();
        expectTypeOf(read?.small).toEqualTypeOf<number | undefined>();
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'refuses a long past the safe integer range instead of rounding it, naming the document',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        const { insertedId } = await mongoDb.collection('Counter').insertOne({
          name: 'too large',
          hits: Long.fromString('9007199254740993'),
          small: new Int32(3),
          large: Long.fromNumber(1),
        });

        await expect(db.Counter.where({ name: 'too large' }).first()).rejects.toMatchObject({
          code: 'RUNTIME.DECODE_FAILED',
          message: `Failed to decode field hits of the document with _id ${insertedId.toHexString()} in collection 'Counter' with codec 'mongo/int64Number@1': mongo/int64Number@1 wire value must be a whole number from -9007199254740991 to 9007199254740991; received 9007199254740993`,
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'refuses to write a fraction, or a bigint, to an Int, naming the field',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        await expect(
          db.Counter.create({ name: 'fraction', hits: 2.5, small: 1, large: 1 }),
        ).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
          message:
            "Failed to encode field hits in collection 'Counter' with codec 'mongo/int64Number@1': mongo/int64Number@1 value must be an integer from -9007199254740991 to 9007199254740991; received 2.5",
        });
        await expect(
          db.Tally.create({
            name: 'bigint in a list',
            scores: [1, bigintTypedAsNumber(2n)],
            address: null,
            addresses: [],
          }),
        ).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
          message:
            "Failed to encode field scores.1 in collection 'Tally' with codec 'mongo/int64Number@1': mongo/int64Number@1 value must be an integer from -9007199254740991 to 9007199254740991; received 2n",
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'writes an Int back as the BSON long Prisma 6 writes, and @db.Int as an int, also when incremented',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await db.Counter.create({ name: 'written by Prisma 8', hits: 6, small: 4, large: 7 });
        const counter = db.Counter.where({ name: 'written by Prisma 8' });
        await counter.update((u) => [u.hits.inc(2), u.small.inc(1), u.large.mul(3)]);
        await expect(counter.update((u) => [u.hits.inc(0.5)])).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
          message: expect.stringContaining('received 0.5'),
        });

        expect(await counter.first()).toMatchObject({ hits: 8, small: 5, large: 21 });

        const stored = await mongoDb
          .collection('Counter')
          .aggregate([
            { $match: { name: 'written by Prisma 8' } },
            {
              $project: {
                _id: 0,
                hits: { $type: '$hits' },
                small: { $type: '$small' },
                large: { $type: '$large' },
              },
            },
          ])
          .toArray();

        expect(stored).toEqual([{ hits: 'long', small: 'int', large: 'long' }]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'writes an Int in a list and in composite values as a long, and reads each back as a number',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        const created = await db.Tally.create({
          name: 'written by Prisma 8',
          scores: [1, -2, 2 ** 40],
          address: { zip: 12 },
          addresses: [{ zip: 4 }, { zip: 6 }],
        });
        const read = await db.Tally.where({ name: 'written by Prisma 8' }).first();

        const expected = {
          name: 'written by Prisma 8',
          scores: [1, -2, 2 ** 40],
          address: { zip: 12 },
          addresses: [{ zip: 4 }, { zip: 6 }],
        };
        expect(created).toMatchObject(expected);
        expect(read).toMatchObject(expected);
        expectTypeOf(read?.scores).toEqualTypeOf<ReadonlyArray<number> | undefined>();
        expectTypeOf(read?.addresses).toEqualTypeOf<
          ReadonlyArray<{ readonly zip: number }> | undefined
        >();

        const stored = await mongoDb
          .collection('Tally')
          .aggregate([
            { $match: { name: 'written by Prisma 8' } },
            {
              $project: {
                _id: 0,
                scores: { $map: { input: '$scores', in: { $type: '$$this' } } },
                zip: { $type: '$address.zip' },
                zips: { $map: { input: '$addresses', in: { $type: '$$this.zip' } } },
              },
            },
          ])
          .toArray();
        expect(stored).toEqual([
          { scores: ['long', 'long', 'long'], zip: 'long', zips: ['long', 'long'] },
        ]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'refuses a fractional double, and reads the field once the upgrade guide repairs it',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        const counters = mongoDb.collection('Counter');
        const rest = { small: new Int32(1), large: Long.fromNumber(1) };
        await counters.insertMany([
          { name: 'fractional', hits: new Double(2.5), ...rest },
          { name: 'whole double', hits: new Double(4), ...rest },
          { name: 'long', hits: Long.fromNumber(6), ...rest },
        ]);
        const tallies = mongoDb.collection('Tally');
        await tallies.insertOne({
          name: 'mixed',
          scores: [Long.fromNumber(1), new Double(3.7)],
          address: { zip: new Double(12.2) },
          addresses: [{ zip: new Double(4.5) }, { zip: Long.fromNumber(6) }],
        });

        await expect(db.Counter.all().toArray()).rejects.toMatchObject({
          code: 'RUNTIME.DECODE_FAILED',
          message: expect.stringContaining('fractional double 2.5'),
        });

        const fractional = await counters
          .aggregate([
            {
              $match: {
                hits: { $type: 'double' },
                $expr: { $ne: ['$hits', { $trunc: '$hits' }] },
              },
            },
            { $project: { _id: 0, name: 1 } },
          ])
          .toArray();
        expect(fractional).toEqual([{ name: 'fractional' }]);

        await counters.updateMany({ hits: { $type: 'double' } }, [
          { $set: { hits: { $toLong: { $round: ['$hits', 0] } } } },
        ]);
        await tallies.updateMany({ scores: { $type: 'double' } }, [
          {
            $set: {
              scores: {
                $map: {
                  input: '$scores',
                  in: {
                    $cond: [
                      { $eq: [{ $type: '$$this' }, 'double'] },
                      { $toLong: { $round: ['$$this', 0] } },
                      '$$this',
                    ],
                  },
                },
              },
            },
          },
        ]);

        await tallies.updateMany({ 'address.zip': { $type: 'double' } }, [
          { $set: { 'address.zip': { $toLong: { $round: ['$address.zip', 0] } } } },
        ]);
        const inCompositeLists = await tallies
          .aggregate([
            { $match: { 'addresses.zip': { $type: 'double' } } },
            { $project: { _id: 0, name: 1 } },
          ])
          .toArray();
        expect(inCompositeLists).toEqual([{ name: 'mixed' }]);
        await tallies.updateMany({ 'addresses.zip': { $type: 'double' } }, [
          {
            $set: {
              addresses: {
                $map: {
                  input: '$addresses',
                  in: {
                    $mergeObjects: [
                      '$$this',
                      {
                        zip: {
                          $cond: [
                            { $eq: [{ $type: '$$this.zip' }, 'double'] },
                            { $toLong: { $round: ['$$this.zip', 0] } },
                            '$$this.zip',
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        ]);

        const read = await db.Counter.all().toArray();
        expect(Object.fromEntries(read.map(({ name, hits }) => [name, hits]))).toEqual({
          fractional: 2,
          'whole double': 4,
          long: 6,
        });
        expect(await db.Tally.where({ name: 'mixed' }).first()).toMatchObject({ scores: [1, 4] });
        expect(
          await tallies
            .aggregate([
              { $match: { name: 'mixed' } },
              {
                $project: {
                  _id: 0,
                  zip: '$address.zip',
                  type: { $type: '$address.zip' },
                  zips: '$addresses.zip',
                  types: { $map: { input: '$addresses', in: { $type: '$$this.zip' } } },
                },
              },
            ])
            .toArray(),
        ).toEqual([{ zip: 12, type: 'long', zips: [4, 6], types: ['long', 'long'] }]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
