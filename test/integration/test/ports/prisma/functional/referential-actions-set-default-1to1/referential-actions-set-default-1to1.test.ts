import { describe, expect, it } from 'vitest';
import { type PortContext, timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/referentialActions-setDefault/tests_1-to-1.ts
// (postgres matrix entry, without-mysql branch — MySQL-only sub-tests are non-ported below).
//
// Schema:
//   model UserOneToOne { id Int @id; profile ProfileOneToOne? }
//   model ProfileOneToOne {
//     id Int @id
//     user UserOneToOne? @relation(fields:[userId], references:[id], onUpdate:SetDefault, onDelete:SetDefault)
//     userId Int? @default(3) @unique
//   }
//
// defaultUserId = 3
//
// The createTemplate() helper creates:
//   UserOneToOne { id: 1 }, UserOneToOne { id: 3 }
//   ProfileOneToOne { id: 1, userId: 1 }
//
// API mapping:
//   prisma[model].create(...)   → db.public.Model.create(...)
//   prisma[model].findMany({include, orderBy}) → db.public.Model.include().orderBy().all()
//   prisma[model].update({where:{id:X}, data:{id:Y}}) → db.public.Model.where({id:X}).update({id:Y})
//   prisma[model].delete({where:{id:X}}) → db.public.Model.where({id:X}).delete()
//   prisma.$transaction([a.deleteMany(), b.deleteMany()]) → db cleanup via deleteAll()
//
// Dispositions:
//   "[create] creating a table with SetDefault is accepted"   → ported (passing)
//   "[update] changing existing user id to a new one triggers NoAction under the hood" (mysql only)
//       → non-ported: MySQL-only test; prisma-next targets postgres in this batch
//   "[update] changing existing user id to a new one triggers SetDefault" (without mysql)
//       → ported (passing)
//   "[update] removing user with default id and changing existing user id to a new one triggers SetDefault in profile, which throws"
//       → ported (passing — throws FK violation)
//   "[delete] changing existing user id to a new one triggers NoAction under the hood" (mysql only)
//       → non-ported: MySQL-only test
//   "[delete] deleting existing user one triggers SetDefault" (without mysql)
//       → ported (passing)
//   "[delete] removing user with default id and changing existing user id to a new one triggers SetDefault in profile, which throws"
//       → ported (passing — throws FK violation)

const DEFAULT_USER_ID = 3;

function withSetDefault1to1(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

async function createTemplate({ db }: PortContext<Contract>) {
  // creating user id=1
  await db.public.UserOneToOne.create({ id: 1 });
  // creating user id=3 (defaultUserId)
  await db.public.UserOneToOne.create({ id: DEFAULT_USER_ID });
  // creating profile id=1, userId=1
  await db.public.ProfileOneToOne.create({ id: 1, userId: 1 });
}

describe('ports/prisma/functional/referentialActions-setDefault-1to1', () => {
  describe('1:n mandatory (explicit)', () => {
    describe('[create]', () => {
      it(
        '[create] creating a table with SetDefault is accepted',
        () =>
          withSetDefault1to1(async (ctx) => {
            await createTemplate(ctx);

            const usersAndProfile = await ctx.db.public.UserOneToOne.include('profile')
              .orderBy((u) => u.id.asc())
              .all();

            expect(usersAndProfile).toMatchObject([
              {
                id: 1,
                profile: {
                  id: 1,
                  userId: 1,
                },
              },
              {
                id: DEFAULT_USER_ID,
                profile: null,
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
          withSetDefault1to1(async (ctx) => {
            await createTemplate(ctx);

            await ctx.db.public.UserOneToOne.where({ id: 1 }).update({ id: 2 });

            const users = await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all();
            expect(users).toMatchObject([{ id: 2 }, { id: DEFAULT_USER_ID }]);

            const profiles = await ctx.db.public.ProfileOneToOne.orderBy((p) => p.id.asc()).all();
            expect(profiles).toMatchObject([
              {
                id: 1,
                userId: DEFAULT_USER_ID,
              },
            ]);
          }),
        timeouts.spinUpPpgDev,
      );

      it(
        '[update] removing user with default id and changing existing user id to a new one triggers SetDefault in profile, which throws',
        () =>
          withSetDefault1to1(async (ctx) => {
            await createTemplate(ctx);

            await ctx.db.public.UserOneToOne.where({ id: DEFAULT_USER_ID }).delete();

            // profileModel cannot fall back to { userId: defaultUserId }, as no user with that id exists
            await expect(
              ctx.db.public.UserOneToOne.where({ id: 1 }).update({ id: 2 }),
            ).rejects.toThrow();
          }),
        timeouts.spinUpPpgDev,
      );
    });

    describe('[delete]', () => {
      it(
        '[delete] deleting existing user one triggers SetDefault',
        () =>
          withSetDefault1to1(async (ctx) => {
            await createTemplate(ctx);

            await ctx.db.public.UserOneToOne.where({ id: 1 }).delete();

            const users = await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all();
            expect(users).toMatchObject([{ id: DEFAULT_USER_ID }]);

            const profiles = await ctx.db.public.ProfileOneToOne.include('user')
              .orderBy((p) => p.id.asc())
              .all();
            expect(profiles).toMatchObject([
              {
                id: 1,
                userId: DEFAULT_USER_ID,
              },
            ]);
          }),
        timeouts.spinUpPpgDev,
      );

      it(
        '[delete] removing user with default id and changing existing user id to a new one triggers SetDefault in profile, which throws',
        () =>
          withSetDefault1to1(async (ctx) => {
            await createTemplate(ctx);

            await ctx.db.public.UserOneToOne.where({ id: DEFAULT_USER_ID }).delete();

            // profileModel cannot fall back to { userId: defaultUserId }, as no user with that id exists
            await expect(ctx.db.public.UserOneToOne.where({ id: 1 }).delete()).rejects.toThrow();
          }),
        timeouts.spinUpPpgDev,
      );
    });
  });
});
