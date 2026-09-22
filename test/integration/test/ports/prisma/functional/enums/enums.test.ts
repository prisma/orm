import mongo from '@internal/mongo/runtime';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

describe('ports/prisma/functional/enums (mongo)', () => {
  it.fails(
    'fails at runtime when an invalid entry is entered manually in Mongo',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ client, contract, db }) => {
        const raw = mongo<Contract>({ contract, mongoClient: client, dbName: 'test' });
        await (await raw.runtime())
          .query(raw.raw.collection('User').insertOne({ _id: '2', plan: 'NONFREE' }).build())
          .toArray();

        const result = await Promise.resolve(db.User.all()).catch((error: unknown) => error);

        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toMatch(/Value 'NONFREE' not found in enum 'Plan'/);
        await raw.close();
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
