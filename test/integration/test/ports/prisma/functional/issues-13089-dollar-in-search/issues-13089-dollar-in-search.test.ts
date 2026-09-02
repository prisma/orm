import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/13089
// (mongodb-only matrix entry).
//
// Subject: a leading `$` in a queried/updated string value must be treated as a
// literal, not as a MongoDB operator. Upstream seeds two users in `beforeAll`
// (firstName 'foo' and '$foo') and shares that database across three tests, which
// find → update → delete the same `$`-prefixed row in order.
//
// Each `withMongoPort` runs against a fresh database, so `withDollarSearch` re-seeds
// the shared starting state ('foo' + '$foo') before every test; the update test then
// produces '$$foo' locally and the delete test re-creates it, mirroring the state each
// upstream test observes from the shared fixture.
//
// API translation: `findMany({ where: { firstName } })` → `.where({ firstName }).all()`;
// `update({ where, data, select })` → `.select(...).where(...).update(...)`;
// `delete({ where })` → `.where(...).delete()`.

function withDollarSearch(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.users.create({ _id: new ObjectId().toHexString(), firstName: 'foo' });
    await ctx.db.users.create({ _id: new ObjectId().toHexString(), firstName: '$foo' });
    await fn(ctx);
  });
}

describe('ports/prisma/functional/issues-13089-dollar-in-search', () => {
  it(
    'returns records when using a `$` in the search string',
    () =>
      withDollarSearch(async ({ db }) => {
        const records = await db.users.where({ firstName: '$foo' }).all();
        expect(records).toHaveLength(1);
        expect(records[0]?.firstName).toEqual('$foo');
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'updates records when using a `$` in the search string',
    () =>
      withDollarSearch(async ({ db }) => {
        const record = await db.users
          .select('firstName')
          .where({ firstName: '$foo' })
          .update({ firstName: '$$foo' });
        expect(record?.firstName).toEqual('$$foo');
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'deletes records when using a `$` in the search string',
    () =>
      withDollarSearch(async ({ db }) => {
        await db.users.where({ firstName: '$foo' }).update({ firstName: '$$foo' });
        await db.users.where({ firstName: '$$foo' }).delete();
        const remaining = await db.users.where({ firstName: '$$foo' }).all();
        expect(remaining).toHaveLength(0);
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
