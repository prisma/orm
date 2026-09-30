import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

describe('Mongo object-form where()', () => {
  it(
    'matches null on a nullable field',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        await db.users.create({ name: 'Alice', tags: [] });
        await db.users.create({ name: null, tags: [] });

        const rows = await db.users.where({ name: null }).all();

        expect(rows.map(({ name }) => name)).toEqual([null]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'matches a whole list or one element on a list field',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        await db.users.create({ name: 'Alice', tags: ['a', 'b'] });
        await db.users.create({ name: 'Bob', tags: ['b'] });

        const whole = await db.users.where({ tags: ['a', 'b'] }).all();
        const element = await db.users.where({ tags: 'b' }).orderBy({ name: 1 }).all();

        expect(whole.map(({ name }) => name)).toEqual(['Alice']);
        expect(element.map(({ name }) => name)).toEqual(['Alice', 'Bob']);
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
