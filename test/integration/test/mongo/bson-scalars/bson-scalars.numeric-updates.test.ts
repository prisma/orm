import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

describe('Mongo nullable Int32 and Double fields', () => {
  it(
    'increment and multiply through the update accessor',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        const tally = await db.tallies.create({ hits: 2, ratio: 1.5 });

        await db.tallies.where({ _id: tally._id }).update((t) => [t.hits.inc(3), t.ratio.mul(2)]);
        const updated = await db.tallies
          .where({ _id: tally._id })
          .update((t) => [t.hits.mul(2), t.ratio.inc(0.5)]);

        expect(updated).toMatchObject({ hits: 10, ratio: 3.5 });
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
