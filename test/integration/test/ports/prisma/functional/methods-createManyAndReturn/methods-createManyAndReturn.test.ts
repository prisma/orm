import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/methods/createManyAndReturn-supported/tests.ts
// (postgres matrix entry).
//
// Upstream schema (postgres):
//   model User { id String @id @default(cuid()); email String @unique; name String?; posts Post[] }
//   model Post { id String @id @default(cuid()); title String; user User @relation(fields:[userId], references:[id]); userId String }
//
// API mapping:
//   prisma.user.createManyAndReturn({ data }) → db.public.User.createAll(data)
//   prisma.post.createManyAndReturn({ include: { user: true }, data }) → db.public.Post.include('user').createAll(data)
//   prisma.user.createManyAndReturn({ select: { id: true }, data }) → db.public.User.select('id').createAll(data)
//
// Dispositions:
//   "should create one record"              → ported (passing)
//   "should create many records"            → ported (passing)
//   "should accept select"                  → ported (passing)
//   "should accept include on the post side" → ported (passing)
//   "should fail include on the user side"  → non-ported: prisma-next's createAll DOES support
//                                             include('posts') on User (to-many is valid); there
//                                             is no equivalent restriction
//   "take should fail"                      → non-ported: createAll takes (data[], configure?)
//                                             not an options bag; take/orderBy/distinct are not
//                                             options on this API at all — no equivalent rejection
//                                             to assert
//   "orderBy should fail"                   → non-ported: same as above
//   "distinct should fail"                  → non-ported: same as above
//   "select _count should fail"             → ported (passing): inline @ts-expect-error on
//                                             select('_count') (not a scalar field); the invalid
//                                             column also makes the SQL reject at runtime
//   "include _count should fail"            → ported (it.fails): inline @ts-expect-error on
//                                             include('_count') (not a relation); prisma-next
//                                             type-rejects but ignores it at runtime (no throw)

function withCreateManyAndReturn(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/methods-createManyAndReturn-supported', () => {
  it(
    'should create one record',
    () =>
      withCreateManyAndReturn(async ({ db }) => {
        const email = 'user1@cmar.example.com';

        const users = await db.public.User.createAll([{ email }]);

        expect(users).toMatchObject([
          {
            email,
            id: expect.any(String),
            name: null,
          },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'should create many records',
    () =>
      withCreateManyAndReturn(async ({ db }) => {
        const email1 = 'cmar-bulk1@example.com';
        const email2 = 'cmar-bulk2@example.com';
        const email3 = 'cmar-bulk3@example.com';
        const email4 = 'cmar-bulk4@example.com';

        const users = await db.public.User.createAll([
          { email: email1 },
          { email: email2 },
          { email: email3 },
          { email: email4 },
        ]);

        expect(users).toMatchObject([
          { email: email1, id: expect.any(String), name: null },
          { email: email2, id: expect.any(String), name: null },
          { email: email3, id: expect.any(String), name: null },
          { email: email4, id: expect.any(String), name: null },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'should accept select',
    () =>
      withCreateManyAndReturn(async ({ db }) => {
        const email = 'cmar-select@example.com';

        const users = await db.public.User.select('id').createAll([{ email }]);

        expect(users).toMatchObject([{ id: expect.any(String) }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'should accept include on the post side',
    () =>
      withCreateManyAndReturn(async ({ db }) => {
        const email = 'cmar-include-post-side@example.com';

        const users = await db.public.User.select('id').createAll([{ email }]);
        const userId = users[0]!.id;

        const posts = await db.public.Post.include('user')
          .select('id', 'title', 'userId')
          .createAll([{ userId, title: 'Include my user please!' }]);

        expect(posts).toMatchObject([
          {
            id: expect.any(String),
            title: expect.any(String),
            userId: expect.any(String),
            user: {
              id: expect.any(String),
              email,
            },
          },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'select _count should fail',
    () =>
      withCreateManyAndReturn(async ({ db }) => {
        await expect(
          // @ts-expect-error `_count` is not a scalar field
          db.public.User.select('_count').createAll([{ email: 'cmar-select-count@example.com' }]),
        ).rejects.toThrow();
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'include _count should fail',
    () =>
      withCreateManyAndReturn(async ({ db }) => {
        await expect(
          // @ts-expect-error `_count` is not a relation
          db.public.User.include('_count').createAll([{ email: 'cmar-include-count@example.com' }]),
        ).rejects.toThrow();
      }),
    timeouts.spinUpPpgDev,
  );
});
