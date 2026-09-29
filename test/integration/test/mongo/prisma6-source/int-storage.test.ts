import { Int32, Long } from 'mongodb';
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
});
