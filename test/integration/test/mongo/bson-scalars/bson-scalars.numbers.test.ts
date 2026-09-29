import { describe, expect, it } from 'vitest';
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
