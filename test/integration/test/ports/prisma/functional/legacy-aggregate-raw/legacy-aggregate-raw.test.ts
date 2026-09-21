import mongo from '@internal/mongo/runtime';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const users = [
  { _id: '02d25579a73a72373fa4e846', email: 'Pete.Kassulke82520@fox-min.com', age: 20 },
  { _id: 'a85d5d75a3a886cb61eb3a0e', email: 'Sam.Dickinson32909@memorableparticular.org', age: 45 },
  { _id: 'a7fe5dac91ab6b0f529430c5', email: 'Kyla_Crist96556@cancollaboration.biz', age: 60 },
  {
    _id: '40b15492abe23e6fce736dad',
    email: 'Arielle.Oberbrunner94321@fulljuggernaut.org',
    age: 60,
  },
];

async function withLegacyAggregateRaw(
  fn: Parameters<typeof withMongoPort<Contract>>[1],
): Promise<void> {
  await withMongoPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/0-legacy-ports/aggregate-raw', () => {
  it(
    'group',
    () =>
      withLegacyAggregateRaw(async ({ client, db, contract }) => {
        await db.User.createAll(users as unknown as Parameters<typeof db.User.createAll>[0]);
        const raw = mongo<Contract>({ contract, mongoClient: client, dbName: 'test' });
        const result = await (await raw.runtime())
          .query(
            raw.raw
              .collection('User')
              .aggregate([{ $group: { _id: '$age', total: { $sum: 1 } } }, { $sort: { _id: -1 } }])
              .build(),
          )
          .toArray();

        expect(result).toEqual([
          { _id: 60, total: 2 },
          { _id: 45, total: 1 },
          { _id: 20, total: 1 },
        ]);
        await raw.close();
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'match',
    () =>
      withLegacyAggregateRaw(async ({ client, db, contract }) => {
        await db.User.createAll(users as unknown as Parameters<typeof db.User.createAll>[0]);
        const raw = mongo<Contract>({ contract, mongoClient: client, dbName: 'test' });
        const result = await (await raw.runtime())
          .query(
            raw.raw
              .collection('User')
              .aggregate([{ $match: { age: 60 } }, { $project: { email: true, _id: false } }])
              .build(),
          )
          .toArray();

        expect(result).toEqual([
          { email: 'Kyla_Crist96556@cancollaboration.biz' },
          { email: 'Arielle.Oberbrunner94321@fulljuggernaut.org' },
        ]);
        await raw.close();
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
