import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/composites/list/updateMany.ts
// (mongodb matrix entry). Upstream uses `prisma.commentRequiredList.updateMany(...)` which
// returns `{ count: N }`. In prisma-next the equivalent is `.updateAndCount()`.
//
// The upstream seed (commentListDataA) creates one entry with:
//   contents: [{ text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] }]
//
// Ported:
//   - set                → updateAndCount with full replacement list
//   - set shorthand      → updateAndCount with whole-list replacement (no prisma { set: } wrapper)
//   - set nested list    → updateAndCount with full replacement incl. upvotes array
//   - push               → updateAndCount((u) => [u.contents.push({...})])
//
// Ported:
//   - set null
//   - set null shorthand
//
// Non-ported — see non-ported ledger:
//   - updateMany (embedded-list per-element filtered update) — no prisma-next surface
//   - deleteMany (embedded-list per-element filtered delete) — no prisma-next surface
//   - unset — asserts Prisma-specific "Unknown argument `unset`" on required list field
//   - upsert set / upsert update — asserts Prisma-specific "Unknown argument `upsert`"

function withComposites(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

const seedA = (id: string) => ({
  _id: id,
  country: null,
  contents: [{ text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] }],
});

describe('ports/prisma/functional/composites/list/updateMany', () => {
  it(
    'set',
    () =>
      withComposites(async ({ db }) => {
        const id = new ObjectId().toHexString();
        await db.comment_required_list.create(seedA(id));

        const count = await db.comment_required_list.where({ _id: id }).updateAndCount({
          country: 'Mars',
          contents: [{ text: 'Goodbye World', upvotes: [{ vote: false, userId: '42' }] }],
        });

        expect(count).toBe(1);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'set shorthand (same as set for ORM — no prisma set wrapper)',
    () =>
      withComposites(async ({ db }) => {
        const id = new ObjectId().toHexString();
        await db.comment_required_list.create(seedA(id));

        const count = await db.comment_required_list.where({ _id: id }).updateAndCount({
          country: 'Mars',
          contents: [{ text: 'Goodbye World', upvotes: [{ vote: false, userId: '42' }] }],
        });

        expect(count).toBe(1);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  // Upstream asserts null on required `contents` is a type error and a runtime throw.
  // Prisma Next rejects it at the type level (@ts-expect-error holds), and MongoDB
  // rejects it through the provisioned collection validator.
  it(
    'set null',
    () =>
      withComposites(async ({ db }) => {
        const id = new ObjectId().toHexString();
        await db.comment_required_list.create(seedA(id));

        // @ts-expect-error required `contents` list cannot be null
        const promise = db.comment_required_list.where({ _id: id }).updateAndCount({
          country: 'France',
          contents: null,
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
        await db.comment_required_list.create(seedA(id));

        // @ts-expect-error required `contents` list cannot be null
        const promise = db.comment_required_list.where({ _id: id }).updateAndCount({
          country: 'France',
          contents: null,
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
        await db.comment_required_list.create(seedA(id));

        const count = await db.comment_required_list.where({ _id: id }).updateAndCount({
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

        expect(count).toBe(1);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'push',
    () =>
      withComposites(async ({ db }) => {
        const id = new ObjectId().toHexString();
        await db.comment_required_list.create(seedA(id));

        const count = await db.comment_required_list
          .where({ _id: id })
          .updateAndCount((u) => [u.contents.push({ text: 'Goodbye World', upvotes: [] })]);

        expect(count).toBe(1);
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
