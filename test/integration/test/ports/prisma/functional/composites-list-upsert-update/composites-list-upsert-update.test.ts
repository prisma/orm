import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/composites/list/upsert-update.ts
// (mongodb matrix entry). Upstream seeds a row (commentListDataB — three contents), then calls
// `upsert` so the update branch runs (record already exists). The `create: {}` arg is
// present but unused (becomes $setOnInsert with no fields in prisma-next).
//
// commentListDataB:
//   contents: [
//     { text: 'Goodbye World', upvotes: [{ vote: false, userId: '11' }] },
//     { text: 'Hello World',   upvotes: [{ vote: true,  userId: '10' }] },
//     { text: 'Hello World',   upvotes: [] },
//   ]
//
// Ported:
//   - set               → upsert update with full replacement list
//   - set shorthand     → upsert update with whole-list replacement
//   - set nested list   → upsert update with full replacement incl. upvotes
//   - push              → upsert update((u) => [u.contents.push({...})])
//
// Ported:
//   - set null
//   - set null shorthand
//
// Non-ported — see non-ported ledger:
//   - unset — asserts Prisma-specific "Unknown argument `unset`" on required embedded list
//   - upsert set / upsert update — asserts Prisma-specific "Unknown argument `upsert`"
//   - updateMany / deleteMany — embedded-list sub-operators
//     (contents: { updateMany: { data, where } } / { deleteMany: { where } }),
//     which prisma-next's mongo ORM cannot express (no per-element embedded mutation).

function withComposites(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

const seedB = (id: string) => ({
  _id: id,
  country: 'France',
  contents: [
    { text: 'Goodbye World', upvotes: [{ vote: false, userId: '11' }] },
    { text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] },
    { text: 'Hello World', upvotes: [] },
  ],
});

describe('ports/prisma/functional/composites/list/upsert-update', () => {
  it(
    'set',
    () =>
      withComposites(async ({ db }) => {
        const id = new ObjectId().toHexString();
        await db.comment_required_list.create(seedB(id));

        const comment = await db.comment_required_list.where({ _id: id }).upsert({
          create: { _id: id, country: null, contents: [] },
          update: {
            country: 'Mars',
            contents: [{ text: 'Goodbye World', upvotes: [{ vote: false, userId: '42' }] }],
          },
        });

        expect(comment).toMatchObject({
          contents: [{ text: 'Goodbye World', upvotes: [{ userId: '42', vote: false }] }],
          country: 'Mars',
        });
        expect(comment._id).toEqual(expect.any(String));
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'set shorthand (same as set for ORM — no prisma set wrapper)',
    () =>
      withComposites(async ({ db }) => {
        const id = new ObjectId().toHexString();
        await db.comment_required_list.create(seedB(id));

        const comment = await db.comment_required_list.where({ _id: id }).upsert({
          create: { _id: id, country: null, contents: [] },
          update: {
            country: 'Mars',
            contents: [{ text: 'Goodbye World', upvotes: [{ vote: false, userId: '42' }] }],
          },
        });

        expect(comment).toMatchObject({
          contents: [{ text: 'Goodbye World', upvotes: [{ userId: '42', vote: false }] }],
          country: 'Mars',
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  // Upstream asserts null on required `contents` is a type error and a runtime throw.
  // Prisma Next rejects it at the type level, and MongoDB rejects it through the
  // provisioned collection validator.
  it(
    'set null',
    () =>
      withComposites(async ({ db }) => {
        const id = new ObjectId().toHexString();
        await db.comment_required_list.create(seedB(id));

        // @ts-expect-error required `contents` list cannot be null
        const promise = db.comment_required_list.where({ _id: id }).upsert({
          create: { _id: id, country: null, contents: [] },
          update: {
            country: 'France',
            contents: null,
          },
        });
        await expect(promise).rejects.toThrow();
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'set null shorthand',
    () =>
      withComposites(async ({ db }) => {
        const id = new ObjectId().toHexString();
        await db.comment_required_list.create(seedB(id));

        // @ts-expect-error required `contents` list cannot be null
        const promise = db.comment_required_list.where({ _id: id }).upsert({
          create: { _id: id, country: null, contents: [] },
          update: {
            country: 'France',
            contents: null,
          },
        });
        await expect(promise).rejects.toThrow();
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'set nested list',
    () =>
      withComposites(async ({ db }) => {
        const id = new ObjectId().toHexString();
        await db.comment_required_list.create(seedB(id));

        const comment = await db.comment_required_list.where({ _id: id }).upsert({
          create: { _id: id, country: null, contents: [] },
          update: {
            country: 'Mars',
            contents: [
              {
                text: 'Goodbye World',
                upvotes: [
                  { userId: '10', vote: false },
                  { userId: '11', vote: false },
                ],
              },
            ],
          },
        });

        expect(comment).toMatchObject({
          contents: [
            {
              text: 'Goodbye World',
              upvotes: [
                { userId: '10', vote: false },
                { userId: '11', vote: false },
              ],
            },
          ],
          country: 'Mars',
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'push',
    () =>
      withComposites(async ({ db }) => {
        const id = new ObjectId().toHexString();
        await db.comment_required_list.create(seedB(id));

        const comment = await db.comment_required_list.where({ _id: id }).upsert({
          create: { _id: id, country: null, contents: [] },
          update: (u) => [u.contents.push({ text: 'Goodbye World', upvotes: [] })],
        });

        expect(comment).toMatchObject({
          contents: [
            { text: 'Goodbye World', upvotes: [{ userId: '11', vote: false }] },
            { text: 'Hello World', upvotes: [{ userId: '10', vote: true }] },
            { text: 'Hello World', upvotes: [] },
            { text: 'Goodbye World', upvotes: [] },
          ],
          country: 'France',
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
