import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/composites/list/createMany.ts
// (mongodb matrix entry).
//
// Upstream `createMany({ data })` accepts a single object; prisma-next's
// `createCount` takes an array and returns the inserted count.
//
// `set null` / `set null shorthand` assert BOTH a type error and a runtime
// "must not be null" throw. Prisma Next rejects null at the type level, and
// MongoDB rejects it through the provisioned collection validator.

function withComposites(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/composites/list/createMany', () => {
  it(
    'set',
    () =>
      withComposites(async ({ db }) => {
        const count = await db.comment_required_list.createAndCount([
          {
            country: 'France',
            contents: [
              {
                text: 'Hello World',
                upvotes: [{ vote: true, userId: '10' }],
              },
            ],
          },
        ]);

        expect(count).toBe(1);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'set shorthand (same as set for ORM — no prisma set wrapper)',
    () =>
      withComposites(async ({ db }) => {
        const count = await db.comment_required_list.createAndCount([
          {
            country: 'France',
            contents: [
              {
                text: 'Hello World',
                upvotes: [{ vote: true, userId: '10' }],
              },
            ],
          },
        ]);

        expect(count).toBe(1);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'set null',
    () =>
      withComposites(async ({ db }) => {
        const promise = db.comment_required_list.createAndCount([
          {
            country: 'France',
            // @ts-expect-error required `contents` list cannot be null
            contents: null,
          },
        ]);
        await expect(promise).rejects.toThrow();
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'set null shorthand',
    () =>
      withComposites(async ({ db }) => {
        const promise = db.comment_required_list.createAndCount([
          {
            country: 'France',
            // @ts-expect-error required `contents` list cannot be null
            contents: null,
          },
        ]);
        await expect(promise).rejects.toThrow();
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'set nested list',
    () =>
      withComposites(async ({ db }) => {
        const count = await db.comment_required_list.createAndCount([
          {
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
          },
        ]);

        expect(count).toBe(1);
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
