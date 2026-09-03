import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/composites/object/delete.ts
// (mongodb matrix entry). Upstream seeds one Comment (required content, always set),
// deletes it by id, then asserts `count === 0` via a follow-up count().
//
// prisma-next has no read-side count(), so the "row is gone" post-condition is
// verified faithfully by re-reading the row: `.where({ _id }).first()` returns null.
// The subject under test is delete(), not count().
//
// This suite is not matrix-parameterised upstream (content is always set), so this
// port uses the required-content root.

function withComposites(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/composites/object/delete', () => {
  it(
    'delete',
    () =>
      withComposites(async ({ db }) => {
        const id = new ObjectId().toHexString();
        await db.comments_required.create({
          _id: id,
          country: 'France',
          content: {
            text: 'Hello World',
            upvotes: [{ vote: true, userId: '10' }],
          },
        });

        await db.comments_required.where({ _id: id }).delete();

        const stillThere = await db.comments_required.where({ _id: id }).first();
        expect(stillThere).toBeNull();
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
