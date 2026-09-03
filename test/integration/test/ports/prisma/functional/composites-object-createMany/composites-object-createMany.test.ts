import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/composites/object/createMany.ts
// (mongodb matrix entry). Upstream tests two schema variants via a test matrix:
//   - contentProperty === 'required' → content: CommentContent (non-null)
//   - contentProperty === 'optional' → content: CommentContent? (nullable)
//
// This port uses two separate roots in one contract:
//   - db.comments_required  → required content
//   - db.comments_optional  → optional content
//
// Upstream `createMany({ data })` takes a single object (or array). prisma-next's
// equivalent is `createCount([...])`, which returns the inserted count directly
// (upstream asserts `{ count: 1 }`).
//
// Upstream "set null" for the required variant throws at runtime
// ('Argument `set` must not be null'); in prisma-next the required constraint is
// enforced at the type level (content cannot be null on the required root), and
// MongoDB rejects it through the provisioned collection validator.

function withComposites(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/composites/object/createMany', () => {
  describe('required content', () => {
    it(
      'set',
      () =>
        withComposites(async ({ db }) => {
          const count = await db.comments_required.createAndCount([
            {
              country: 'France',
              content: {
                text: 'Hello World',
                upvotes: [{ vote: true, userId: '10' }],
              },
            },
          ]);

          expect(count).toEqual(1);
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set shorthand (same as set for ORM — no prisma set wrapper)',
      () =>
        withComposites(async ({ db }) => {
          const count = await db.comments_required.createAndCount([
            {
              country: 'France',
              content: {
                text: 'Hello World',
                upvotes: [{ vote: true, userId: '10' }],
              },
            },
          ]);

          expect(count).toEqual(1);
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    // Upstream asserts null on required `content` is BOTH a type error and a
    // runtime throw. prisma-next rejects it at the type level (@ts-expect-error
    // holds), and MongoDB rejects it through the provisioned collection validator.
    it(
      'set null',
      () =>
        withComposites(async ({ db }) => {
          const result = db.comments_required.createAndCount([
            {
              country: 'France',
              // @ts-expect-error required `content` cannot be null
              content: null,
            },
          ]);
          await expect(result).rejects.toThrow();
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set null shorthand',
      () =>
        withComposites(async ({ db }) => {
          const result = db.comments_required.createAndCount([
            {
              country: 'France',
              // @ts-expect-error required `content` cannot be null
              content: null,
            },
          ]);
          await expect(result).rejects.toThrow();
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set nested list',
      () =>
        withComposites(async ({ db }) => {
          const count = await db.comments_required.createAndCount([
            {
              country: 'France',
              content: {
                text: 'Hello World',
                upvotes: [
                  { userId: '10', vote: true },
                  { userId: '11', vote: true },
                ],
              },
            },
          ]);

          expect(count).toEqual(1);
        }),
      timeouts.spinUpMongoMemoryServer,
    );
  });

  describe('optional content', () => {
    it(
      'set null',
      () =>
        withComposites(async ({ db }) => {
          const count = await db.comments_optional.createAndCount([
            {
              country: 'France',
              content: null,
            },
          ]);

          expect(count).toEqual(1);
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set null shorthand (content omitted)',
      () =>
        withComposites(async ({ db }) => {
          const count = await db.comments_optional.createAndCount([
            {
              country: 'France',
              content: null,
            },
          ]);

          expect(count).toEqual(1);
        }),
      timeouts.spinUpMongoMemoryServer,
    );
  });
});
