import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/composites/object/findFirst.ts
// (mongodb matrix entry). Upstream seeds one Comment via commentDataA (required
// content, no country → null) and exercises four reads.
//
// This suite is not matrix-parameterised upstream (content is always set), so this
// port uses the required-content root.
//
// Ported here:
//   - simple  → `.where({ _id }).first()` returns the row incl. the composite content.
//
// Upstream omits `country` in its seed (Prisma stores it absent and reads it back
// as `null`). prisma-next's mongo create input requires the optional `country` key
// (typed `string | null`), and an absent field reads back as `undefined`, so this
// port seeds `country: null` explicitly. The observable read result — `country:
// null` — is identical to upstream's asserted value.
//
// Non-ported (see _inbox): `select` (nested composite sub-selection),
// `orderBy` (nested `content.upvotes._count` ordering), and `filter isSet`
// (`country: { isSet: true }` operator) — none expressible in prisma-next's mongo ORM.

function withComposites(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/composites/object/findFirst', () => {
  it(
    'simple',
    () =>
      withComposites(async ({ db }) => {
        const id = new ObjectId().toHexString();
        await db.comments_required.create({
          _id: id,
          country: null,
          content: {
            text: 'Hello World',
            upvotes: [{ vote: true, userId: '10' }],
          },
        });

        const comment = await db.comments_required.where({ _id: id }).first();

        expect(comment).toEqual({
          _id: id,
          content: {
            text: 'Hello World',
            upvotes: [{ userId: '10', vote: true }],
          },
          country: null,
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
