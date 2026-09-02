import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/composites/list/update.ts
// (mongodb matrix entry).
//
// Seed mirrors upstream `commentListDataB`: three contents entries, the third
// with an empty `upvotes` list.
//
// Ported: set, set shorthand, set nested list (whole-list replacement via the
// update data object), push (append an element via the field-op callback), and
// the two null cases.
//
// Non-ported (see _inbox ledger): embedded-list `updateMany`/`deleteMany` (no
// filtered per-element mutation surface), and `unset`/`upsert` on the embedded
// list (upstream asserts Prisma-specific "Unknown argument" errors).

function withComposites(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

const dataB = (id: string) => ({
  _id: id,
  country: 'France',
  contents: [
    {
      text: 'Goodbye World',
      upvotes: [{ vote: false, userId: '11' }],
    },
    {
      text: 'Hello World',
      upvotes: [{ vote: true, userId: '10' }],
    },
    {
      text: 'Hello World',
      upvotes: [],
    },
  ],
});

describe('ports/prisma/functional/composites/list/update', () => {
  let db: Parameters<Parameters<typeof withComposites>[0]>[0]['db'];
  let id: string;

  function run(fn: () => Promise<void>) {
    return () =>
      withComposites(async (ctx) => {
        db = ctx.db;
        id = new ObjectId().toHexString();
        await db.comment_required_list.create(dataB(id));
        await fn();
      });
  }

  it(
    'set',
    run(async () => {
      const comment = await db.comment_required_list.where({ _id: id }).update({
        country: 'Mars',
        contents: [
          {
            text: 'Goodbye World',
            upvotes: [{ vote: false, userId: '42' }],
          },
        ],
      });

      expect(comment).toMatchObject({
        country: 'Mars',
        contents: [
          {
            text: 'Goodbye World',
            upvotes: [{ userId: '42', vote: false }],
          },
        ],
      });
      expect(comment?._id).toEqual(expect.any(String));
    }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'set shorthand (same as set for ORM — no prisma set wrapper)',
    run(async () => {
      const comment = await db.comment_required_list.where({ _id: id }).update({
        country: 'Mars',
        contents: [
          {
            text: 'Goodbye World',
            upvotes: [{ vote: false, userId: '42' }],
          },
        ],
      });

      expect(comment).toMatchObject({
        country: 'Mars',
        contents: [
          {
            text: 'Goodbye World',
            upvotes: [{ userId: '42', vote: false }],
          },
        ],
      });
      expect(comment?._id).toEqual(expect.any(String));
    }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'set null',
    run(async () => {
      // @ts-expect-error required `contents` list cannot be null
      const promise = db.comment_required_list.where({ _id: id }).update({
        country: 'France',
        contents: null,
      });
      await expect(promise).rejects.toThrow();
    }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'set null shorthand',
    run(async () => {
      // @ts-expect-error required `contents` list cannot be null
      const promise = db.comment_required_list.where({ _id: id }).update({
        country: 'France',
        contents: null,
      });
      await expect(promise).rejects.toThrow();
    }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'set nested list',
    run(async () => {
      const comment = await db.comment_required_list.where({ _id: id }).update({
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
      });

      expect(comment).toMatchObject({
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
      });
      expect(comment?._id).toEqual(expect.any(String));
    }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'push',
    run(async () => {
      const comment = await db.comment_required_list
        .where({ _id: id })
        .update((u) => [u.contents.push({ text: 'Goodbye World', upvotes: [] })]);

      expect(comment).toMatchObject({
        country: 'France',
        contents: [
          { text: 'Goodbye World', upvotes: [{ userId: '11', vote: false }] },
          { text: 'Hello World', upvotes: [{ userId: '10', vote: true }] },
          { text: 'Hello World', upvotes: [] },
          { text: 'Goodbye World', upvotes: [] },
        ],
      });
      expect(comment?._id).toEqual(expect.any(String));
    }),
    timeouts.spinUpMongoMemoryServer,
  );
});
