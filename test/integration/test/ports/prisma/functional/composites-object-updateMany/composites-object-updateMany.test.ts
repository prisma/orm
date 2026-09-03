import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/composites/object/updateMany.ts
// (mongodb matrix entry). Upstream is matrix-parameterised on contentProperty (required/optional).
// `updateMany` returns `{ count: N }` in Prisma; in prisma-next the equivalent is
// `.updateAndCount()` returning a number.
//
// Ported (both variants):
//   - set                → updateAndCount with full replacement object
//   - set shorthand      → same (no prisma { set: ... } wrapper in ORM)
//   - set nested list    → updateAndCount with full replacement incl. upvotes array
//
// Ported (optional variant only):
//   - set null           → updateAndCount({ content: null })
//   - set null shorthand → updateAndCount({ content: null })
//   - unset              → updateAndCount((u) => [u.content.unset()])
//
// Ported (required variant):
//   - set null
//   - set null shorthand
//
// Non-ported — see non-ported ledger:
//   - optional/required `update` sub-operator, `update push/set nested list` — no partial
//     composite-field update sub-operator in prisma-next
//   - `unset` required branch — upstream asserts Prisma-specific "Unknown argument `unset`" throw
//   - `upsert set` / `upsert update` — `content: { upsert: {...} }` composite-level upsert

function withComposites(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/composites/object/updateMany', () => {
  describe('required content', () => {
    it(
      'set',
      () =>
        withComposites(async ({ db }) => {
          const id = new ObjectId().toHexString();
          await db.comments_required.create({
            _id: id,
            country: 'France',
            content: { text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] },
          });

          const count = await db.comments_required.where({ _id: id }).updateAndCount({
            country: 'Mars',
            content: { text: 'Goodbye World', upvotes: [{ vote: false, userId: '42' }] },
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
          await db.comments_required.create({
            _id: id,
            country: 'France',
            content: { text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] },
          });

          const count = await db.comments_required.where({ _id: id }).updateAndCount({
            country: 'Mars',
            content: { text: 'Goodbye World', upvotes: [{ vote: false, userId: '42' }] },
          });

          expect(count).toBe(1);
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    // Upstream asserts null on required `content` is both a type error and a runtime throw.
    // Prisma Next rejects it at the type level, and MongoDB rejects it through the
    // provisioned collection validator.
    it(
      'set null',
      () =>
        withComposites(async ({ db }) => {
          const id = new ObjectId().toHexString();
          await db.comments_required.create({
            _id: id,
            country: 'France',
            content: { text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] },
          });

          // @ts-expect-error required `content` cannot be null
          const promise = db.comments_required.where({ _id: id }).updateAndCount({
            country: 'France',
            content: null,
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
          await db.comments_required.create({
            _id: id,
            country: 'France',
            content: { text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] },
          });

          // @ts-expect-error required `content` cannot be null
          const promise = db.comments_required.where({ _id: id }).updateAndCount({
            country: 'France',
            content: null,
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
          await db.comments_required.create({
            _id: id,
            country: 'France',
            content: { text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] },
          });

          const count = await db.comments_required.where({ _id: id }).updateAndCount({
            country: 'Mars',
            content: {
              text: 'Goodbye World',
              upvotes: [
                { userId: '10', vote: false },
                { userId: '11', vote: false },
              ],
            },
          });

          expect(count).toBe(1);
        }),
      timeouts.spinUpMongoMemoryServer,
    );
  });

  describe('optional content', () => {
    it(
      'set',
      () =>
        withComposites(async ({ db }) => {
          const id = new ObjectId().toHexString();
          await db.comments_optional.create({
            _id: id,
            country: 'France',
            content: { text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] },
          });

          const count = await db.comments_optional.where({ _id: id }).updateAndCount({
            country: 'Mars',
            content: { text: 'Goodbye World', upvotes: [{ vote: false, userId: '42' }] },
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
          await db.comments_optional.create({
            _id: id,
            country: 'France',
            content: { text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] },
          });

          const count = await db.comments_optional.where({ _id: id }).updateAndCount({
            country: 'Mars',
            content: { text: 'Goodbye World', upvotes: [{ vote: false, userId: '42' }] },
          });

          expect(count).toBe(1);
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set null',
      () =>
        withComposites(async ({ db }) => {
          const id = new ObjectId().toHexString();
          await db.comments_optional.create({
            _id: id,
            country: 'France',
            content: { text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] },
          });

          const count = await db.comments_optional.where({ _id: id }).updateAndCount({
            country: 'France',
            content: null,
          });

          expect(count).toBe(1);
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set null shorthand',
      () =>
        withComposites(async ({ db }) => {
          const id = new ObjectId().toHexString();
          await db.comments_optional.create({
            _id: id,
            country: 'France',
            content: { text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] },
          });

          const count = await db.comments_optional.where({ _id: id }).updateAndCount({
            country: 'France',
            content: null,
          });

          expect(count).toBe(1);
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set nested list',
      () =>
        withComposites(async ({ db }) => {
          const id = new ObjectId().toHexString();
          await db.comments_optional.create({
            _id: id,
            country: 'France',
            content: { text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] },
          });

          const count = await db.comments_optional.where({ _id: id }).updateAndCount({
            country: 'Mars',
            content: {
              text: 'Goodbye World',
              upvotes: [
                { userId: '10', vote: false },
                { userId: '11', vote: false },
              ],
            },
          });

          expect(count).toBe(1);
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    // updateAndCount with $unset on an optional composite removes the field entirely.
    // updateAndCount returns the number modified, not the document, so `count = 1`
    // should hold regardless. This test verifies the operation succeeds.
    it(
      'unset',
      () =>
        withComposites(async ({ db }) => {
          const id = new ObjectId().toHexString();
          await db.comments_optional.create({
            _id: id,
            country: 'France',
            content: { text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] },
          });

          const count = await db.comments_optional
            .where({ _id: id })
            .updateAndCount((u) => [u.content.unset()]);

          expect(count).toBe(1);
        }),
      timeouts.spinUpMongoMemoryServer,
    );
  });
});
