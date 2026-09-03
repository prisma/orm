import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/composites/list/findMany.ts
// (mongodb matrix entry).
//
// Seed mirrors upstream `commentListDataA` (one content) and `commentListDataB`
// (three contents, the last with empty upvotes).
//
// Ported:
//   - simple                 → `.where().all()`.
//   - filter equals          → `.where({ contents: <array> })` (whole-list
//                              equality, the same predicate upstream's
//                              `contents: { equals: ... }` compiles to).
//   - filter equals shorthand→ identical (upstream passes the array directly).
//
// Non-ported (see _inbox ledger):
//   - select   → embedded value-object subfield projection (no prisma-next surface).
//   - orderBy  → order by embedded list count (`orderBy: { contents: { _count } }`).
//   - every / some / none / empty → composite list quantified filters
//     (`every`/`some`/`none`/`isEmpty`); prisma-next `where` is equality-only.

function withComposites(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

const contentsA = [
  {
    text: 'Hello World',
    upvotes: [{ vote: true, userId: '10' }],
  },
];

const dataA = (id: string) => ({ _id: id, contents: contentsA, country: null });

const dataB = (id: string) => ({
  _id: id,
  country: 'France',
  contents: [
    { text: 'Goodbye World', upvotes: [{ vote: false, userId: '11' }] },
    { text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] },
    { text: 'Hello World', upvotes: [] },
  ],
});

describe('ports/prisma/functional/composites/list/findMany', () => {
  it(
    'simple',
    () =>
      withComposites(async ({ db }) => {
        const id1 = new ObjectId().toHexString();
        const id2 = new ObjectId().toHexString();
        await db.comment_required_list.createAndCount([dataA(id1), dataB(id2)]);

        const comment = await db.comment_required_list.where({ _id: id1 }).all();

        expect(comment).toHaveLength(1);
        expect(comment[0]).toEqual({
          _id: id1,
          country: null,
          contents: contentsA.map((c) => ({
            text: c.text,
            upvotes: c.upvotes.map((u) => ({ userId: u.userId, vote: u.vote })),
          })),
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'filter equals',
    () =>
      withComposites(async ({ db }) => {
        const id1 = new ObjectId().toHexString();
        const id2 = new ObjectId().toHexString();
        await db.comment_required_list.createAndCount([dataA(id1), dataB(id2)]);

        const comment = await db.comment_required_list.where({ contents: contentsA }).all();

        expect(comment).toHaveLength(1);
        expect(comment[0]).toEqual({
          _id: id1,
          country: null,
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

  it(
    'filter equals shorthand (same as filter equals for ORM)',
    () =>
      withComposites(async ({ db }) => {
        const id1 = new ObjectId().toHexString();
        const id2 = new ObjectId().toHexString();
        await db.comment_required_list.createAndCount([dataA(id1), dataB(id2)]);

        const comment = await db.comment_required_list.where({ contents: contentsA }).all();

        expect(comment).toHaveLength(1);
        expect(comment[0]).toEqual({
          _id: id1,
          country: null,
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
