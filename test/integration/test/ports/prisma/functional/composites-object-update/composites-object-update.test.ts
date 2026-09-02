import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/composites/object/update.ts
// (mongodb matrix entry). Upstream is matrix-parameterised on contentProperty (required/optional)
// and tests a range of composite update operators.
//
// This port uses two separate roots (required / optional content) in one contract,
// mirroring the create/upsert-create ports.
//
// Ported (both variants):
//   - set                   → update with full replacement object
//   - set shorthand         → same (no prisma { set: ... } wrapper in ORM)
//   - set nested list       → update with full replacement incl. upvotes array
//
// Ported (optional variant only):
//   - set null              → update({ content: null })
//   - set null shorthand    → update({ content: null })
//   - unset                 → update((u) => [u.content.unset()])
//
// Ported (required variant):
//   - set null
//   - set null shorthand
//
// Non-ported — see non-ported ledger:
//   - optional/required `update` sub-operator (content: { upsert: { update: {...} } } or
//     content: { update: {...} }) — prisma-next has no partial composite-field update sub-operator
//   - `update push nested list` / `update set nested list` (same reason)
//   - `unset` required branch — upstream asserts Prisma-specific "Unknown argument `unset`" throw;
//     prisma-next has no such validation error
//   - `upsert set` / `upsert update` — `content: { upsert: {...} }` composite-level upsert;
//     no equivalent operator in prisma-next's ORM

function withComposites(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/composites/object/update', () => {
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

          const comment = await db.comments_required.where({ _id: id }).update({
            country: 'Mars',
            content: { text: 'Goodbye World', upvotes: [{ vote: false, userId: '42' }] },
          });

          expect(comment).toMatchObject({
            country: 'Mars',
            content: {
              text: 'Goodbye World',
              upvotes: [{ userId: '42', vote: false }],
            },
          });
          expect(comment?._id).toEqual(expect.any(String));
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

          const comment = await db.comments_required.where({ _id: id }).update({
            country: 'Mars',
            content: { text: 'Goodbye World', upvotes: [{ vote: false, userId: '42' }] },
          });

          expect(comment).toMatchObject({
            country: 'Mars',
            content: {
              text: 'Goodbye World',
              upvotes: [{ userId: '42', vote: false }],
            },
          });
          expect(comment?._id).toEqual(expect.any(String));
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    // Upstream asserts null on required `content` is BOTH a type error and a runtime throw.
    // Prisma Next rejects it at the type level (@ts-expect-error holds), and MongoDB
    // rejects it through the provisioned collection validator.
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
          const promise = db.comments_required.where({ _id: id }).update({
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
          const promise = db.comments_required.where({ _id: id }).update({
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

          const comment = await db.comments_required.where({ _id: id }).update({
            country: 'Mars',
            content: {
              text: 'Goodbye World',
              upvotes: [
                { userId: '10', vote: false },
                { userId: '11', vote: false },
              ],
            },
          });

          expect(comment).toMatchObject({
            country: 'Mars',
            content: {
              text: 'Goodbye World',
              upvotes: [
                { userId: '10', vote: false },
                { userId: '11', vote: false },
              ],
            },
          });
          expect(comment?._id).toEqual(expect.any(String));
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

          const comment = await db.comments_optional.where({ _id: id }).update({
            country: 'Mars',
            content: { text: 'Goodbye World', upvotes: [{ vote: false, userId: '42' }] },
          });

          expect(comment).toMatchObject({
            country: 'Mars',
            content: {
              text: 'Goodbye World',
              upvotes: [{ userId: '42', vote: false }],
            },
          });
          expect(comment?._id).toEqual(expect.any(String));
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

          const comment = await db.comments_optional.where({ _id: id }).update({
            country: 'Mars',
            content: { text: 'Goodbye World', upvotes: [{ vote: false, userId: '42' }] },
          });

          expect(comment).toMatchObject({
            country: 'Mars',
            content: {
              text: 'Goodbye World',
              upvotes: [{ userId: '42', vote: false }],
            },
          });
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

          const comment = await db.comments_optional.where({ _id: id }).update({
            country: 'France',
            content: null,
          });

          expect(comment).toMatchObject({
            content: null,
            country: 'France',
          });
          expect(comment?._id).toEqual(expect.any(String));
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

          const comment = await db.comments_optional.where({ _id: id }).update({
            country: 'France',
            content: null,
          });

          expect(comment).toMatchObject({
            content: null,
            country: 'France',
          });
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

          const comment = await db.comments_optional.where({ _id: id }).update({
            country: 'Mars',
            content: {
              text: 'Goodbye World',
              upvotes: [
                { userId: '10', vote: false },
                { userId: '11', vote: false },
              ],
            },
          });

          expect(comment).toMatchObject({
            country: 'Mars',
            content: {
              text: 'Goodbye World',
              upvotes: [
                { userId: '10', vote: false },
                { userId: '11', vote: false },
              ],
            },
          });
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    // Upstream: `content: { unset: true }` removes the optional composite and returns
    // `{ content: null, ... }`. prisma-next's `$unset` removes the field from the
    // document entirely rather than writing `null`, so the returned document lacks
    // the `content` key — faithful port, it.fails.
    it.fails(
      'unset',
      () =>
        withComposites(async ({ db }) => {
          const id = new ObjectId().toHexString();
          await db.comments_optional.create({
            _id: id,
            country: 'France',
            content: { text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] },
          });

          const comment = await db.comments_optional
            .where({ _id: id })
            .update((u) => [u.content.unset()]);

          expect(comment).toMatchObject({
            content: null,
            country: 'France',
          });
          expect(comment?._id).toEqual(expect.any(String));
        }),
      timeouts.spinUpMongoMemoryServer,
    );
  });
});
