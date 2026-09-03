import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/0-legacy-ports/optional-relation-filters
// (postgres matrix entry only; mongodb tests are skipped in upstream).
//
// Upstream uses copycat-seeded UUIDs for ids. We seed with the same ids
// (using the copycat.uuid outputs inlined from the upstream snapshot values):
//   user 1: id = '02d25579a73a72373fa4e846', no bio
//   user 2: id = 'a85d5d75a3a886cb61eb3a0e', bio with text=null
//   user 3: id = 'a7fe5dac91ab6b0f529430c5', bio with text='Hello World'
//
// Prisma-next expression of optional-relation filter operators:
//   bio: { isNot: null }    → where(u => u.bio.some())
//   bio: { is: null }       → where(u => u.bio.none())
//   bio: null               → where(u => u.bio.none())
//   bio: { text: null }     → where(u => u.bio.some(b => b.text.isNull()))
//   bio: { text: { not: null } } → where(u => u.bio.some(b => b.text.isNotNull()))

const USER1_ID = '02d25579a73a72373fa4e846';
const USER2_ID = 'a85d5d75a3a886cb61eb3a0e';
const USER3_ID = 'a7fe5dac91ab6b0f529430c5';

function withOptionalRelationFilters(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    // user 1: no bio
    await ctx.db.public.User.create({
      id: USER1_ID,
      email: 'Pete.Kassulke82520@fox-min.com',
    });
    // user 2: bio with no text
    await ctx.db.public.User.create({
      id: USER2_ID,
      email: 'Sam.Dickinson32909@memorableparticular.org',
    });
    await ctx.db.public.Bio.create({ userId: USER2_ID });
    // user 3: bio with text
    await ctx.db.public.User.create({
      id: USER3_ID,
      email: 'Kyla_Crist96556@cancollaboration.biz',
    });
    await ctx.db.public.Bio.create({ userId: USER3_ID, text: 'Hello World' });

    await fn(ctx);
  });
}

describe('ports/prisma/functional/legacy-optional-relation-filters', () => {
  it(
    'filter existing optional relation with `isNot: null`',
    () =>
      withOptionalRelationFilters(async ({ db }) => {
        const result = await db.public.User.where((u) => u.bio.some())
          .orderBy((u) => u.id.asc())
          .select('id', 'email')
          .all();

        expect(result).toHaveLength(2);
        expect(result).toEqual([
          { id: 'a7fe5dac91ab6b0f529430c5', email: 'Kyla_Crist96556@cancollaboration.biz' },
          { id: 'a85d5d75a3a886cb61eb3a0e', email: 'Sam.Dickinson32909@memorableparticular.org' },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'filter empty optional relation with `is: null`',
    () =>
      withOptionalRelationFilters(async ({ db }) => {
        const result = await db.public.User.where((u) => u.bio.none())
          .select('id', 'email')
          .all();

        expect(result).toHaveLength(1);
        expect(result).toEqual([
          { id: '02d25579a73a72373fa4e846', email: 'Pete.Kassulke82520@fox-min.com' },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'filter empty optional relation with `null`',
    () =>
      withOptionalRelationFilters(async ({ db }) => {
        const result = await db.public.User.where((u) => u.bio.none())
          .select('id', 'email')
          .all();

        expect(result).toHaveLength(1);
        expect(result).toEqual([
          { id: '02d25579a73a72373fa4e846', email: 'Pete.Kassulke82520@fox-min.com' },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  // Upstream declares this `bio: null` case twice (tests.ts:98 and tests.ts:117)
  // under different names; both are ported for one-to-one accounting parity.
  it(
    'filter empty optional relation',
    () =>
      withOptionalRelationFilters(async ({ db }) => {
        const result = await db.public.User.where((u) => u.bio.none())
          .select('id', 'email')
          .all();

        expect(result).toHaveLength(1);
        expect(result).toEqual([
          { id: '02d25579a73a72373fa4e846', email: 'Pete.Kassulke82520@fox-min.com' },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'filter existing optional relation with empty field',
    () =>
      withOptionalRelationFilters(async ({ db }) => {
        const result = await db.public.User.where((u) => u.bio.some((b) => b.text.isNull()))
          .select('id', 'email')
          .all();

        expect(result).toHaveLength(1);
        expect(result).toEqual([
          { id: 'a85d5d75a3a886cb61eb3a0e', email: 'Sam.Dickinson32909@memorableparticular.org' },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'filter existing optional relation with existing field',
    () =>
      withOptionalRelationFilters(async ({ db }) => {
        const result = await db.public.User.where((u) => u.bio.some((b) => b.text.isNotNull()))
          .select('id', 'email')
          .all();

        expect(result).toHaveLength(1);
        expect(result).toEqual([
          { id: 'a7fe5dac91ab6b0f529430c5', email: 'Kyla_Crist96556@cancollaboration.biz' },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );
});
