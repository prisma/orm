import { Double, Int32, Long } from 'mongodb';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

describe('an Int in a Prisma 6 MongoDB schema', () => {
  it(
    'reads the BSON long Prisma 6 stores as a bigint, and @db.Int as a number',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await mongoDb.collection('Counter').insertOne({
          name: 'written by Prisma 6',
          hits: Long.fromNumber(5),
          small: new Int32(3),
          large: Long.fromString('9007199254740993'),
        });

        const read = await db.Counter.where({ name: 'written by Prisma 6' }).first();

        expect(read).toMatchObject({ hits: 5n, small: 3, large: 9007199254740993n });
        expectTypeOf(read?.hits).toEqualTypeOf<bigint | undefined>();
        expectTypeOf(read?.small).toEqualTypeOf<number | undefined>();
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'writes an Int back as the BSON long Prisma 6 reads, and @db.Int as an int',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await db.Counter.create({ name: 'written by Prisma 8', hits: 6n, small: 4, large: 7n });

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
          fractional: 2n,
          'whole double': 4n,
          long: 6n,
        });
        expect(await db.Tally.where({ name: 'mixed' }).first()).toMatchObject({ scores: [1n, 4n] });
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
