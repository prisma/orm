import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/composites/object/upsert-create.ts
// (mongodb matrix entry). Upstream generates a fresh id per test and upserts a
// non-existent row → the create branch runs. `update: {}` is a no-op.
//
// This port uses two separate roots (required / optional content), mirroring the
// create port, because upstream is matrix-parameterised on contentProperty.
//
// prisma-next: `.where({ _id }).upsert({ create, update: {} })`.
//
// Like create(), upsert() returns the input merged with the server-assigned
// `_id` and does NOT re-read the stored document — so the shape is asserted via
// toMatchObject (content/country) plus `_id`, exactly as the create port does.
// Upstream asserts `id: expect.any(String)`; prisma-next decodes write results
// through the same codecs as reads (#29879), so `_id` is a hex string here too.
//
// Upstream "set null" for the required variant throws at runtime; in prisma-next the
// required constraint is enforced at the type level (@ts-expect-error holds) and
// MongoDB rejects it through the provisioned collection validator.

function withComposites(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/composites/object/upsert-create', () => {
  describe('required content', () => {
    it(
      'set',
      () =>
        withComposites(async ({ db }) => {
          const id = new ObjectId().toHexString();
          const comment = await db.comments_required.where({ _id: id }).upsert({
            update: {},
            create: {
              _id: id,
              country: 'France',
              content: {
                text: 'Hello World',
                upvotes: [{ vote: true, userId: '10' }],
              },
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
          const id = new ObjectId().toHexString();
          const comment = await db.comments_required.where({ _id: id }).upsert({
            update: {},
            create: {
              _id: id,
              country: 'France',
              content: {
                text: 'Hello World',
                upvotes: [{ vote: true, userId: '10' }],
              },
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

    // Upstream: null on required `content` throws at runtime. prisma-next rejects it
    // at the type level (@ts-expect-error holds), and MongoDB rejects it through the
    // provisioned collection validator.
    it(
      'set null',
      () =>
        withComposites(async ({ db }) => {
          const id = new ObjectId().toHexString();
          const comment = db.comments_required.where({ _id: id }).upsert({
            update: {},
            create: {
              _id: id,
              country: 'France',
              // @ts-expect-error required `content` cannot be null
              content: null,
            },
          });
          await expect(comment).rejects.toThrow();
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set null shorthand',
      () =>
        withComposites(async ({ db }) => {
          const id = new ObjectId().toHexString();
          const comment = db.comments_required.where({ _id: id }).upsert({
            update: {},
            create: {
              _id: id,
              country: 'France',
              // @ts-expect-error required `content` cannot be null
              content: null,
            },
          });
          await expect(comment).rejects.toThrow();
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set nested list',
      () =>
        withComposites(async ({ db }) => {
          const id = new ObjectId().toHexString();
          const comment = await db.comments_required.where({ _id: id }).upsert({
            update: {},
            create: {
              _id: id,
              country: 'France',
              content: {
                text: 'Hello World',
                upvotes: [
                  { userId: '10', vote: true },
                  { userId: '11', vote: true },
                ],
              },
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

  describe('optional content', () => {
    it(
      'set null',
      () =>
        withComposites(async ({ db }) => {
          const id = new ObjectId().toHexString();
          const comment = await db.comments_optional.where({ _id: id }).upsert({
            update: {},
            create: {
              _id: id,
              country: 'France',
              content: null,
            },
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
          const id = new ObjectId().toHexString();
          const comment = await db.comments_optional.where({ _id: id }).upsert({
            update: {},
            create: {
              _id: id,
              country: 'France',
              content: null,
            },
          });

          expect(comment).toMatchObject({
            country: 'France',
            content: null,
          });
        }),
      timeouts.spinUpMongoMemoryServer,
    );
  });
});
