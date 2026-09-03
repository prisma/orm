import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/methods/updateManyAndReturn-supported/tests.ts
// (postgres matrix entry).
//
// Upstream schema (postgres):
//   model User { id String @id @default(cuid()); email String @unique; name String?; posts Post[] }
//   model Post { id String @id @default(cuid()); title String; user User @relation(fields:[userId], references:[id]); userId String }
//
// API mapping:
//   prisma.user.updateManyAndReturn({ data, where }) → db.public.User.where(where).updateAll(data)
//   prisma.user.updateManyAndReturn({ select: {id:true}, data, where })
//       → db.public.User.select('id').where(where).updateAll(data)
//   prisma.post.updateManyAndReturn({ include: {user:true}, data, where })
//       → db.public.Post.include('user').where(where).updateAll(data)
//
// Dispositions:
//   "should update and return many records"                   → ported (passing)
//   "should update and return one record"                     → ported (passing)
//   "should update and return records satisfying the where clause" → ported (passing)
//   "should accept select"                                    → ported (passing)
//   "should accept include on the post side"                  → ported (passing)
//   "should fail include on the user side"  → non-ported: prisma-next's updateAll DOES support
//                                             include('posts') on User; no equivalent restriction
//   "take should fail"                      → non-ported: updateAll takes (data, configure?) not
//                                             an options bag; take is not an option here
//   "orderBy should fail"                   → non-ported: same as above
//   "distinct should fail"                  → non-ported: same as above
//   "select _count should fail"             → ported (passing): inline @ts-expect-error on
//                                             select('_count'); the invalid column rejects at runtime
//   "include _count should fail"            → ported (it.fails): inline @ts-expect-error on
//                                             include('_count'); prisma-next type-rejects but ignores
//                                             the unknown relation at runtime (no throw)

function withUpdateManyAndReturn(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/methods-updateManyAndReturn-supported', () => {
  it(
    'should update and return many records',
    () =>
      withUpdateManyAndReturn(async ({ db }) => {
        const email1 = 'umar-m1@example.com';
        const email2 = 'umar-m2@example.com';
        const email3 = 'umar-m3@example.com';
        const email4 = 'umar-m4@example.com';
        const updatedName = 'Bulk Updated Name';

        await db.public.User.createAll([
          { email: email1 },
          { email: email2 },
          { email: email3 },
          { email: email4 },
        ]);

        const users = await db.public.User.where({}).updateAll({ name: updatedName });

        expect(users).toMatchObject([
          { email: email1, id: expect.any(String), name: updatedName },
          { email: email2, id: expect.any(String), name: updatedName },
          { email: email3, id: expect.any(String), name: updatedName },
          { email: email4, id: expect.any(String), name: updatedName },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'should update and return one record',
    () =>
      withUpdateManyAndReturn(async ({ db }) => {
        const email1 = 'umar-one-before@example.com';
        const email2 = 'umar-one-after@example.com';

        await db.public.User.create({ email: email1 });

        const users = await db.public.User.where({ email: email1 }).updateAll({ email: email2 });

        expect(users).toMatchObject([
          {
            email: email2,
            id: expect.any(String),
            name: null,
          },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'should update and return records satisfying the where clause',
    () =>
      withUpdateManyAndReturn(async ({ db }) => {
        const email1 = 'umar-where1@example.com';
        const email2 = 'umar-where2@example.com';
        const email3 = 'umar-where3@example.com';
        const email4 = 'umar-where4@example.com';
        const updatedName = 'Where Updated Name';

        await db.public.User.createAll([
          { email: email1 },
          { email: email2 },
          { email: email3 },
          { email: email4 },
        ]);

        const users = await db.public.User.where((u) => u.email.in([email1, email2])).updateAll({
          name: updatedName,
        });

        expect(users).toMatchObject([
          { email: email1, id: expect.any(String), name: updatedName },
          { email: email2, id: expect.any(String), name: updatedName },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'should accept select',
    () =>
      withUpdateManyAndReturn(async ({ db }) => {
        const email1 = 'umar-select@example.com';
        const updatedName = 'Select Updated Name';

        await db.public.User.create({ email: email1 });

        const users = await db.public.User.select('id').where({ email: email1 }).updateAll({
          name: updatedName,
        });

        expect(users).toMatchObject([{ id: expect.any(String) }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'should accept include on the post side',
    () =>
      withUpdateManyAndReturn(async ({ db }) => {
        const email1 = 'umar-include-post@example.com';

        const users = await db.public.User.createAll([{ email: email1 }]);
        const userId = users[0]!.id;

        await db.public.Post.create({ userId, title: 'New post' });

        const posts = await db.public.Post.include('user')
          .select('id', 'title', 'userId')
          .where({ userId })
          .updateAll({ title: 'Updated post' });

        expect(posts).toMatchObject([
          {
            id: expect.any(String),
            title: expect.any(String),
            userId: expect.any(String),
            user: {
              id: expect.any(String),
              email: email1,
            },
          },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'select _count should fail',
    () =>
      withUpdateManyAndReturn(async ({ db }) => {
        await db.public.User.create({ email: 'umar-select-count@example.com' });
        await expect(
          // @ts-expect-error `_count` is not a scalar field
          db.public.User.select('_count').where({}).updateAll({ name: 'x' }),
        ).rejects.toThrow();
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'include _count should fail',
    () =>
      withUpdateManyAndReturn(async ({ db }) => {
        await db.public.User.create({ email: 'umar-include-count@example.com' });
        await expect(
          // @ts-expect-error `_count` is not a relation
          db.public.User.include('_count').where({}).updateAll({ name: 'y' }),
        ).rejects.toThrow();
      }),
    timeouts.spinUpPpgDev,
  );
});
