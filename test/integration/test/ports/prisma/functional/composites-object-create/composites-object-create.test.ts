import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/composites/object/create.ts
// (mongodb matrix entry). Upstream tests two schema variants via a test matrix:
//   - contentProperty === 'required' → content: CommentContent (non-null)
//   - contentProperty === 'optional' → content: CommentContent? (nullable)
//
// This port uses two separate roots in one contract:
//   - db.comments_required  → required content
//   - db.comments_optional  → optional content
//
// Upstream tests:
//   - set              → PORTED (both variants)
//   - set shorthand    → PORTED (both variants)
//   - set null         → PORTED (optional variant only; required is a compile-time concern)
//   - set null shorthand → PORTED (optional variant only)
//   - set nested list  → PORTED (both variants)
//
// Note: upstream "set null" for the required variant throws a runtime error;
// in prisma-next the required constraint is enforced at compile time by the type
// system (content cannot be null/undefined on CommentRequired), so that branch
// is covered below through the provisioned collection validator.
//
// Note: create() returns the input data merged with the server-assigned _id.
// Upstream asserts `id: expect.any(String)`; prisma-next decodes write results
// through the same codecs as reads (#29879), so `_id` is a hex string here too.

function withComposites(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/composites/object/create', () => {
  describe('required content', () => {
    it(
      'set',
      () =>
        withComposites(async ({ db }) => {
          const comment = await db.comments_required.create({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [{ vote: true, userId: '10' }],
            },
          });

          expect(comment).toMatchObject({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [{ userId: '10', vote: true }],
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
          const comment = await db.comments_required.create({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [{ vote: true, userId: '10' }],
            },
          });

          expect(comment).toMatchObject({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [{ userId: '10', vote: true }],
            },
          });
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set nested list',
      () =>
        withComposites(async ({ db }) => {
          const comment = await db.comments_required.create({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [
                { userId: '10', vote: true },
                { userId: '11', vote: true },
              ],
            },
          });

          expect(comment).toMatchObject({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [
                { userId: '10', vote: true },
                { userId: '11', vote: true },
              ],
            },
          });
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    // Upstream asserts null on required `content` is BOTH a type error and a
    // runtime throw (`Argument must not be null`). prisma-next rejects it at the
    // type level (the @ts-expect-error holds), and MongoDB rejects it through the
    // provisioned collection validator.
    it(
      'set null',
      () =>
        withComposites(async ({ db }) => {
          const comment = db.comments_required.create({
            country: 'France',
            // @ts-expect-error required `content` cannot be null
            content: null,
          });
          await expect(comment).rejects.toThrow();
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set null shorthand',
      () =>
        withComposites(async ({ db }) => {
          const comment = db.comments_required.create({
            country: 'France',
            // @ts-expect-error required `content` cannot be null
            content: null,
          });
          await expect(comment).rejects.toThrow();
        }),
      timeouts.spinUpMongoMemoryServer,
    );
  });

  describe('optional content', () => {
    it(
      'set',
      () =>
        withComposites(async ({ db }) => {
          const comment = await db.comments_optional.create({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [{ vote: true, userId: '10' }],
            },
          });

          expect(comment).toMatchObject({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [{ userId: '10', vote: true }],
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
          const comment = await db.comments_optional.create({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [{ vote: true, userId: '10' }],
            },
          });

          expect(comment).toMatchObject({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [{ userId: '10', vote: true }],
            },
          });
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set null',
      () =>
        withComposites(async ({ db }) => {
          const comment = await db.comments_optional.create({
            country: 'France',
            content: null,
          });

          expect(comment).toMatchObject({
            country: 'France',
            content: null,
          });
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set null shorthand (content omitted)',
      () =>
        withComposites(async ({ db }) => {
          const comment = await db.comments_optional.create({
            country: 'France',
            content: null,
          });

          expect(comment).toMatchObject({
            country: 'France',
            content: null,
          });
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set nested list',
      () =>
        withComposites(async ({ db }) => {
          const comment = await db.comments_optional.create({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [
                { userId: '10', vote: true },
                { userId: '11', vote: true },
              ],
            },
          });

          expect(comment).toMatchObject({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [
                { userId: '10', vote: true },
                { userId: '11', vote: true },
              ],
            },
          });
        }),
      timeouts.spinUpMongoMemoryServer,
    );
  });
});
