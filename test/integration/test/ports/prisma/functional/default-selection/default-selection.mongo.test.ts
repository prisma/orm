import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/mongo/generated/contract';
import contractJson from './_fixture/mongo/generated/contract.json' with { type: 'json' };

function withMongoDefaultSelection(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/default-selection (mongo)', () => {
  it(
    'includes composites',
    () =>
      withMongoDefaultSelection(async ({ db }) => {
        const otherId = '02d25579a73a72373fa4e846';
        await db.Other.create({ _id: otherId });
        await db.Model.create({
          _id: 'a85d5d75a3a886cb61eb3a0e',
          value: 'Foo',
          otherId,
          list: ['Hello', 'world'],
          enum: 'A',
          enumList: ['A', 'B'],
          composite: { value: 'I am composite' },
        });

        const model = await db.Model.all().firstOrThrow();

        expect(model.composite).toBeDefined();
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
