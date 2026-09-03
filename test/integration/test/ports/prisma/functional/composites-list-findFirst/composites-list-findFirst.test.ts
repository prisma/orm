import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/composites/list/findFirst.ts
// (mongodb matrix entry).
//
// Upstream has 3 tests: `simple`, `select`, `orderBy`.
//   - simple  → PORTED: `.where().first()` returns the full row.
//   - select  → NON-PORTED: upstream projects a subfield of the composite
//               (`contents: { select: { text: true } }`). prisma-next `select()`
//               only projects top-level model fields, not embedded value-object
//               subfields. See _inbox ledger.
//   - orderBy → NON-PORTED: upstream orders by the embedded list count
//               (`orderBy: { contents: { _count } }`). prisma-next `orderBy` only
//               accepts scalar model fields with 1 | -1. See _inbox ledger.

function withComposites(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/composites/list/findFirst', () => {
  it(
    'simple',
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

        const comment = await db.comment_required_list.where({ _id: id }).first();

        expect(comment).toEqual({
          _id: id,
          country: 'France',
          contents: [
            {
              text: 'Hello World',
              upvotes: [{ userId: '10', vote: true }],
            },
          ],
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
