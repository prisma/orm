import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/composites/list/create.ts
// (mongodb matrix entry).
//
// Upstream wraps the composite list in `{ set: [...] }`; prisma-next takes the
// array directly, so "set" and "set shorthand" collapse to the same ORM call.
//
// Upstream `set null` / `set null shorthand` assert BOTH a type error and a
// runtime Prisma "Argument `set`/`contents` must not be null" throw. In
// prisma-next `contents` is a required non-null list: `null` is rejected at the
// type level (the @ts-expect-error holds), and MongoDB rejects it through the
// provisioned collection validator.

function withComposites(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/composites/list/create', () => {
  it(
    'set',
    () =>
      withComposites(async ({ db }) => {
        const comment = await db.comment_required_list.create({
          country: 'France',
          contents: [
            {
              text: 'Hello World',
              upvotes: [{ vote: true, userId: '10' }],
            },
          ],
        });

        expect(comment).toMatchObject({
          country: 'France',
          contents: [
            {
              text: 'Hello World',
              upvotes: [{ userId: '10', vote: true }],
            },
          ],
        });
        expect(comment._id).toEqual(expect.any(String));
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'set shorthand (same as set for ORM — no prisma set wrapper)',
    () =>
      withComposites(async ({ db }) => {
        const comment = await db.comment_required_list.create({
          country: 'France',
          contents: [
            {
              text: 'Hello World',
              upvotes: [{ vote: true, userId: '10' }],
            },
          ],
        });

        expect(comment).toMatchObject({
          country: 'France',
          contents: [
            {
              text: 'Hello World',
              upvotes: [{ userId: '10', vote: true }],
            },
          ],
        });
        expect(comment._id).toEqual(expect.any(String));
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'set null',
    () =>
      withComposites(async ({ db }) => {
        const comment = db.comment_required_list.create({
          country: 'France',
          // @ts-expect-error required `contents` list cannot be null
          contents: null,
        });
        await expect(comment).rejects.toThrow();
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'set null shorthand',
    () =>
      withComposites(async ({ db }) => {
        const comment = db.comment_required_list.create({
          country: 'France',
          // @ts-expect-error required `contents` list cannot be null
          contents: null,
        });
        await expect(comment).rejects.toThrow();
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'set nested list',
    () =>
      withComposites(async ({ db }) => {
        const comment = await db.comment_required_list.create({
          country: 'France',
          contents: [
            {
              text: 'Hello World',
              upvotes: [
                { userId: '10', vote: true },
                { userId: '11', vote: true },
              ],
            },
          ],
        });

        expect(comment).toMatchObject({
          country: 'France',
          contents: [
            {
              text: 'Hello World',
              upvotes: [
                { userId: '10', vote: true },
                { userId: '11', vote: true },
              ],
            },
          ],
        });
        expect(comment._id).toEqual(expect.any(String));
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
