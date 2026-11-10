import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const threeLevels = [
  {
    label: 'Products',
    children: [{ label: 'Shoes', children: [{ label: 'Boots', children: [] }] }],
  },
];

describe('a MongoDB collection whose value object contains itself', () => {
  it(
    'accepts a menu three levels deep written through the ORM',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await db.menus.create({ name: 'main', items: threeLevels });

        const stored = await mongoDb.collection('menus').findOne({ name: 'main' });
        expect(stored?.['items']).toEqual(threeLevels);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'refuses a document with a field the contract does not declare',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ mongoDb }) => {
        await expect(
          mongoDb.collection('menus').insertOne({ name: 'main', items: threeLevels, extra: 1 }),
        ).rejects.toMatchObject({ code: 121 });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'checks the first level of the value object in full, and accepts any object below it',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ mongoDb }) => {
        await expect(
          mongoDb
            .collection('menus')
            .insertOne({ name: 'top', items: [{ label: 'a', children: [], extra: 1 }] }),
        ).rejects.toMatchObject({ code: 121 });
        await mongoDb
          .collection('menus')
          .insertOne({ name: 'nested', items: [{ label: 'a', children: [{ anything: 1 }] }] });
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
