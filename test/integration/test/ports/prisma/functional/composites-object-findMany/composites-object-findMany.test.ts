import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/composites/object/findMany.ts
// (mongodb matrix entry). Upstream seeds two Comments (commentDataA/B) with fixed
// hex ids and exercises reads/filters.
//
// This suite is not matrix-parameterised upstream (content is always set), so this
// port uses the required-content root.
//
// Ported here:
//   - simple                 → `.where({ _id }).all()`.
//   - filter equals shorthand → `.where({ content: <value> })` — prisma-next's
//     plain-object where does composite equality, the exact subject of the shorthand.
//
// Upstream omits `country` in commentDataA (Prisma stores it absent, reads it back
// as `null`). prisma-next's mongo create input requires the optional `country` key,
// so this port seeds `country: null` explicitly for id1. The observable read result
// (`country: null`) is identical to upstream's asserted value.
//
// Non-ported (see _inbox): `select` (nested composite sub-selection),
// `orderBy` (nested `content.upvotes._count` ordering), `filter equals` ({ equals }
// wrapper operator), `filter is` / `filter isNot` (relation operators on the
// composite), and `filter isSet` — none expressible in prisma-next's mongo ORM.

// Fixed hex ids (upstream uses these exact values so ordering is deterministic).
const id1 = '8aaaaaaaaaaaaaaaaaaaaaaa';
const id2 = '1ddddddddddddddddddddddd';

const contentA = {
  text: 'Hello World',
  upvotes: [{ vote: true, userId: '10' }],
};

const contentB = {
  text: 'Goodbye World',
  upvotes: [
    { vote: false, userId: '11' },
    { vote: true, userId: '12' },
  ],
};

function withComposites(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

async function seed(db: Parameters<Parameters<typeof withComposites>[0]>[0]['db']) {
  await db.comments_required.create({ _id: id1, country: null, content: contentA });
  await db.comments_required.create({ _id: id2, country: 'France', content: contentB });
}

describe('ports/prisma/functional/composites/object/findMany', () => {
  it(
    'simple',
    () =>
      withComposites(async ({ db }) => {
        await seed(db);

        const comments = await db.comments_required.where({ _id: id1 }).all();

        expect(comments).toEqual([
          {
            _id: id1,
            content: contentA,
            country: null,
          },
        ]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'filter equals shorthand',
    () =>
      withComposites(async ({ db }) => {
        await seed(db);

        const comments = await db.comments_required.where({ content: contentA }).all();

        expect(comments).toEqual([
          {
            _id: id1,
            content: contentA,
            country: null,
          },
        ]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
