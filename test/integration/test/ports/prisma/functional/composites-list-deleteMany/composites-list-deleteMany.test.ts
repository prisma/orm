import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/composites/list/deleteMany.ts
// (mongodb matrix entry).
//
// Upstream `deleteMany` maps to prisma-next `deleteCount`. Deletion is verified
// via a follow-up `.where().all()` (prisma-next has no `count` method).

function withComposites(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/composites/list/deleteMany', () => {
  it(
    'delete',
    () =>
      withComposites(async ({ db }) => {
        const id = new ObjectId().toHexString();
        await db.comment_required_list.create({
          _id: id,
          country: 'France',
          contents: [
            {
              text: 'Hello World',
              upvotes: [{ vote: true, userId: '10' }],
            },
          ],
        });

        await db.comment_required_list.where({ _id: id }).deleteAndCount();

        const remaining = await db.comment_required_list.where({ _id: id }).all();
        expect(remaining).toHaveLength(0);
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
