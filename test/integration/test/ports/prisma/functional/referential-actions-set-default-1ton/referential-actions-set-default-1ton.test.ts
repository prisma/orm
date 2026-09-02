import { describe, expect, it } from 'vitest';
import { type PortContext, timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/referentialActions-setDefault/tests_1-to-n.ts
// (postgres matrix entry, without-mysql branch — MySQL-only sub-tests are non-ported below).
//
// Schema:
//   model UserOneToMany { id Int @id; posts PostOneToMany[] }
//   model PostOneToMany {
//     id Int @id
//     user UserOneToMany? @relation(fields:[userId], references:[id], onUpdate:SetDefault, onDelete:SetDefault)
//     userId Int? @default(3)
//   }
//
// defaultUserId = 3
//
// The createTemplate() helper creates:
//   UserOneToMany { id: 1 }, UserOneToMany { id: 3 }
//   PostOneToMany { id: 1, userId: 1 }
//
// API mapping:
//   prisma[model].create(...) → db.public.Model.create(...)
//   prisma[model].findMany({include, orderBy}) → db.public.Model.include().orderBy().all()
//   prisma[model].update({where:{id:X}, data:{id:Y}}) → db.public.Model.where({id:X}).update({id:Y})
//   prisma[model].delete({where:{id:X}}) → db.public.Model.where({id:X}).delete()
//
// Dispositions:
//   "[create] creating a table with SetDefault is accepted"   → ported (passing)
//   "[update] changing existing user id to a new one triggers NoAction under the hood" (mysql only)
//       → non-ported: MySQL-only test; prisma-next targets postgres in this batch
//   "[update] changing existing user id to a new one triggers SetDefault" (without mysql)
//       → ported (passing)
//   "[update] removing user with default id and changing existing user id to a new one triggers SetDefault in post, which throws"
//       → ported (passing — throws FK violation)
//   "[delete] changing existing user id to a new one triggers NoAction under the hood" (mysql only)
//       → non-ported: MySQL-only test
//   "[delete] deleting existing user one triggers SetDefault" (without mysql)
//       → ported (passing)
//   "[delete] removing user with default id and changing existing user id to a new one triggers SetDefault in post, which throws"
//       → ported (passing — throws FK violation)

const DEFAULT_USER_ID = 3;

function withSetDefault1ton(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

async function createTemplate({ db }: PortContext<Contract>) {
  // creating user id=1
  await db.public.UserOneToMany.create({ id: 1 });
  // creating user id=3 (defaultUserId)
  await db.public.UserOneToMany.create({ id: DEFAULT_USER_ID });
  // creating post id=1, userId=1
  await db.public.PostOneToMany.create({ id: 1, userId: 1 });
}

describe('ports/prisma/functional/referentialActions-setDefault-1ton', () => {
  describe('1:n mandatory (explicit)', () => {
    describe('[create]', () => {
      it(
        '[create] creating a table with SetDefault is accepted',
        () =>
          withSetDefault1ton(async (ctx) => {
            await createTemplate(ctx);

            const usersAndPosts = await ctx.db.public.UserOneToMany.include('posts')
              .orderBy((u) => u.id.asc())
              .all();

            expect(usersAndPosts).toMatchObject([
              {
                id: 1,
                posts: [
                  {
                    id: 1,
                    userId: 1,
                  },
                ],
              },
              {
                id: DEFAULT_USER_ID,
                posts: [],
              },
            ]);
          }),
        timeouts.spinUpPpgDev,
      );
    });

    describe('[update]', () => {
      it(
        '[update] changing existing user id to a new one triggers SetDefault',
        () =>
          withSetDefault1ton(async (ctx) => {
            await createTemplate(ctx);

            await ctx.db.public.UserOneToMany.where({ id: 1 }).update({ id: 2 });

            const users = await ctx.db.public.UserOneToMany.orderBy((u) => u.id.asc()).all();
            expect(users).toMatchObject([{ id: 2 }, { id: DEFAULT_USER_ID }]);

            const posts = await ctx.db.public.PostOneToMany.orderBy((p) => p.id.asc()).all();
            expect(posts).toMatchObject([
              {
                id: 1,
                userId: DEFAULT_USER_ID,
              },
            ]);
          }),
        timeouts.spinUpPpgDev,
      );

      it(
        '[update] removing user with default id and changing existing user id to a new one triggers SetDefault in post, which throws',
        () =>
          withSetDefault1ton(async (ctx) => {
            await createTemplate(ctx);

            await ctx.db.public.UserOneToMany.where({ id: DEFAULT_USER_ID }).delete();

            // postModel cannot fall back to { userId: defaultUserId }, as no user with that id exists
            await expect(
              ctx.db.public.UserOneToMany.where({ id: 1 }).update({ id: 2 }),
            ).rejects.toThrow();
          }),
        timeouts.spinUpPpgDev,
      );
    });

    describe('[delete]', () => {
      it(
        '[delete] deleting existing user one triggers SetDefault',
        () =>
          withSetDefault1ton(async (ctx) => {
            await createTemplate(ctx);

            await ctx.db.public.UserOneToMany.where({ id: 1 }).delete();

            const users = await ctx.db.public.UserOneToMany.orderBy((u) => u.id.asc()).all();
            expect(users).toMatchObject([{ id: DEFAULT_USER_ID }]);

            const posts = await ctx.db.public.PostOneToMany.include('user')
              .orderBy((p) => p.id.asc())
              .all();
            expect(posts).toMatchObject([
              {
                id: 1,
                userId: DEFAULT_USER_ID,
              },
            ]);
          }),
        timeouts.spinUpPpgDev,
      );

      it(
        '[delete] removing user with default id and changing existing user id to a new one triggers SetDefault in post, which throws',
        () =>
          withSetDefault1ton(async (ctx) => {
            await createTemplate(ctx);

            await ctx.db.public.UserOneToMany.where({ id: DEFAULT_USER_ID }).delete();

            // postModel cannot fall back to { userId: defaultUserId }, as no user with that id exists
            await expect(ctx.db.public.UserOneToMany.where({ id: 1 }).delete()).rejects.toThrow();
          }),
        timeouts.spinUpPpgDev,
      );
    });
  });
});
