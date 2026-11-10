import type { FieldAccessor } from '@internal/mongo-orm';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

describe('Mongo Double and Int32 fields', () => {
  it(
    'store a whole number written to a Double field as a BSON double the validator accepts',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await db.readings.create({ ratio: 2, count: 3 });

        const [stored] = await mongoDb
          .collection('readings')
          .aggregate([
            { $project: { _id: 0, ratio: { $type: '$ratio' }, count: { $type: '$count' } } },
          ])
          .toArray();
        expect(stored).toEqual({ ratio: 'double', count: 'int' });
        expect(await db.readings.all()).toMatchObject([{ ratio: 2, count: 3 }]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('Mongo Int32 fields', () => {
  it(
    'refuse a fraction or an out-of-range number on write, naming the field',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        await expect(db.readings.create({ ratio: 1, count: 1.5 })).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
          message:
            "Failed to encode field count in collection 'readings' with codec 'mongo/int32@1': mongo/int32@1 value must be an integer from -2147483648 to 2147483647; received 1.5",
        });
        await expect(db.readings.create({ ratio: 1, count: 2 ** 40 })).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
          details: { label: 'count', collection: 'readings' },
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('Mongo Int64 and Decimal128 fields', () => {
  it('take numeric update operands of the type their codec accepts', () => {
    type AuthorFields = FieldAccessor<Contract, 'Author'>;
    expectTypeOf<Parameters<AuthorFields['karma']['inc']>>().toEqualTypeOf<[value: bigint]>();
    expectTypeOf<Parameters<AuthorFields['karma']['mul']>>().toEqualTypeOf<[value: bigint]>();
    expectTypeOf<Parameters<AuthorFields['balance']['inc']>>().toEqualTypeOf<[value: string]>();
    expectTypeOf<AuthorFields['role']>().not.toHaveProperty('inc');
    expectTypeOf<FieldAccessor<Contract, 'Reading'>['count']['inc']>().parameters.toEqualTypeOf<
      [value: number]
    >();
  });

  it(
    'increment and multiply an Int64 field by a bigint and a Decimal128 field by decimal text',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await db.authors.create({ karma: 2n ** 60n, balance: '1.25', role: 'USER' });

        await db.authors
          .where({ role: 'USER' })
          .update((u) => [u.karma.inc(3n), u.balance.mul('2')]);
        await db.authors
          .where({ role: 'USER' })
          .update((u) => [u.karma.mul(2n), u.balance.inc('0.5')]);

        expect(await db.authors.where({ role: 'USER' }).first()).toMatchObject({
          karma: (2n ** 60n + 3n) * 2n,
          balance: '3.00',
        });
        const [stored] = await mongoDb
          .collection('authors')
          .aggregate([
            { $project: { _id: 0, karma: { $type: '$karma' }, balance: { $type: '$balance' } } },
          ])
          .toArray();
        expect(stored).toEqual({ karma: 'long', balance: 'decimal' });
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
