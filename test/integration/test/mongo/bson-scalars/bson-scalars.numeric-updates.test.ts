import type { FieldAccessor } from '@internal/mongo-orm';
import { ObjectId } from 'mongodb';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

describe('Mongo nullable Int32, Double and Int64 fields', () => {
  it('take numeric update operands of the type their codec accepts', () => {
    type TallyFields = FieldAccessor<Contract, 'Tally'>;
    expectTypeOf<Parameters<TallyFields['hits']['inc']>>().toEqualTypeOf<[value: number]>();
    expectTypeOf<Parameters<TallyFields['ratio']['mul']>>().toEqualTypeOf<[value: number]>();
    expectTypeOf<Parameters<TallyFields['total']['inc']>>().toEqualTypeOf<[value: bigint]>();
  });

  it(
    'increment and multiply through the update accessor',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        const tally = await db.tallies.create({ hits: 2, ratio: 1.5, total: 4n });

        await db.tallies
          .where({ id: tally.id })
          .update((t) => [t.hits.inc(3), t.ratio.mul(2), t.total.inc(1n)]);
        const updated = await db.tallies
          .where({ id: tally.id })
          .update((t) => [t.hits.mul(2), t.ratio.inc(0.5), t.total.mul(3n)]);

        expect(updated).toEqual({ id: tally.id, hits: 10, ratio: 3.5, total: 15n });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'set a field missing from the document to the increment, or to zero when multiplied',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        const _id = new ObjectId();
        await mongoDb.collection('tallies').insertOne({ _id });

        const updated = await db.tallies
          .where({ id: _id.toHexString() })
          .update((t) => [t.hits.inc(3), t.ratio.mul(2)]);

        expect(updated).toEqual({ id: _id.toHexString(), hits: 3, ratio: 0, total: null });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'are refused by MongoDB when the field holds null',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        const tally = await db.tallies.create({ hits: null, ratio: null, total: null });

        await expect(
          db.tallies.where({ id: tally.id }).update((t) => [t.hits.inc(1)]),
        ).rejects.toThrow(/non-numeric type null/);
        await expect(
          db.tallies.where({ id: tally.id }).update((t) => [t.ratio.mul(2)]),
        ).rejects.toThrow(/non-numeric type null/);
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
