import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/composites/object/upsert-update.ts
// (mongodb matrix entry). Upstream seeds a row and then calls `upsert` so the
// update branch runs (the record already exists). The `create` arg is present but
// unused. Upstream is matrix-parameterised on contentProperty (required/optional).
//
// prisma-next: `.where({ _id }).upsert({ update: {...}, create: { _id, content: {...} } })`.
// `upsert()` returns the post-update document.
//
// Ported (both variants):
//   - set                → upsert update with full replacement object
//   - set shorthand      → same (no prisma { set: ... } wrapper)
//   - set nested list    → upsert update with full replacement incl. upvotes array
//
// Ported (optional variant only):
//   - set null           → upsert update({ content: null })
//   - set null shorthand → upsert update({ content: null })
//   - unset              → upsert update((u) => [u.content.unset()])
//
// Ported (required variant):
//   - set null
//   - set null shorthand
//
// Non-ported — see non-ported ledger:
//   - optional/required `update` sub-operator inside upsert update, `update push/set nested list`
//     — no partial composite-field update sub-operator in prisma-next
//   - `unset` required branch — upstream asserts Prisma-specific "Unknown argument `unset`" throw
//   - `upsert set` / `upsert update` (nested composite `content: { upsert: {...} }` operator)

function withComposites(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/composites/object/upsert-update', () => {
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

          const comment = await db.comments_required.where({ _id: id }).upsert({
            create: { _id: id, country: null, content: { text: 'Hello World', upvotes: [] } },
            update: {
              country: 'Mars',
              content: { text: 'Goodbye World', upvotes: [{ vote: false, userId: '42' }] },
            },
          });

          expect(comment).toMatchObject({
            country: 'Mars',
            content: {
              text: 'Goodbye World',
              upvotes: [{ userId: '42', vote: false }],
            },
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
          await db.comments_required.create({
            _id: id,
            country: 'France',
            content: { text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] },
          });

          const comment = await db.comments_required.where({ _id: id }).upsert({
            create: { _id: id, country: null, content: { text: 'Hello World', upvotes: [] } },
            update: {
              country: 'Mars',
              content: { text: 'Goodbye World', upvotes: [{ vote: false, userId: '42' }] },
            },
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
          const promise = db.comments_required.where({ _id: id }).upsert({
            create: { _id: id, country: null, content: { text: 'Hello World', upvotes: [] } },
            update: {
              country: 'France',
              content: null,
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
          await db.comments_required.create({
            _id: id,
            country: 'France',
            content: { text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] },
          });

          // @ts-expect-error required `content` cannot be null
          const promise = db.comments_required.where({ _id: id }).upsert({
            create: { _id: id, country: null, content: { text: 'Hello World', upvotes: [] } },
            update: {
              country: 'France',
              content: null,
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
          await db.comments_required.create({
            _id: id,
            country: 'France',
            content: { text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] },
          });

          const comment = await db.comments_required.where({ _id: id }).upsert({
            create: { _id: id, country: null, content: { text: 'Hello World', upvotes: [] } },
            update: {
              country: 'Mars',
              content: {
                text: 'Goodbye World',
                upvotes: [
                  { userId: '10', vote: false },
                  { userId: '11', vote: false },
                ],
              },
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

          const comment = await db.comments_optional.where({ _id: id }).upsert({
            create: { _id: id, country: null, content: null },
            update: {
              country: 'Mars',
              content: { text: 'Goodbye World', upvotes: [{ vote: false, userId: '42' }] },
            },
          });

          expect(comment).toMatchObject({
            country: 'Mars',
            content: {
              text: 'Goodbye World',
              upvotes: [{ userId: '42', vote: false }],
            },
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
          await db.comments_optional.create({
            _id: id,
            country: 'France',
            content: { text: 'Hello World', upvotes: [{ vote: true, userId: '10' }] },
          });

          const comment = await db.comments_optional.where({ _id: id }).upsert({
            create: { _id: id, country: null, content: null },
            update: {
              country: 'Mars',
              content: { text: 'Goodbye World', upvotes: [{ vote: false, userId: '42' }] },
            },
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

          const comment = await db.comments_optional.where({ _id: id }).upsert({
            create: { _id: id, country: null, content: null },
            update: {
              country: 'France',
              content: null,
            },
          });

          expect(comment).toMatchObject({
            content: null,
            country: 'France',
          });
          expect(comment._id).toEqual(expect.any(String));
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

          const comment = await db.comments_optional.where({ _id: id }).upsert({
            create: { _id: id, country: null, content: null },
            update: {
              country: 'France',
              content: null,
            },
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

          const comment = await db.comments_optional.where({ _id: id }).upsert({
            create: { _id: id, country: null, content: null },
            update: {
              country: 'Mars',
              content: {
                text: 'Goodbye World',
                upvotes: [
                  { userId: '10', vote: false },
                  { userId: '11', vote: false },
                ],
              },
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

    // Upstream: `update: { content: { unset: true } }` removes the optional composite and
    // returns `{ content: null, ... }`. prisma-next's `$unset` removes the field entirely
    // rather than writing `null`, so the document lacks the `content` key — it.fails.
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

          const comment = await db.comments_optional.where({ _id: id }).upsert({
            create: { _id: id, country: null, content: null },
            update: (u) => [u.content.unset()],
          });

          expect(comment).toMatchObject({
            content: null,
            country: 'France',
          });
          expect(comment._id).toEqual(expect.any(String));
        }),
      timeouts.spinUpMongoMemoryServer,
    );
  });
});
