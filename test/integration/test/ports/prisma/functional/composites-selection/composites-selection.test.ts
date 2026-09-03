import { describe, expect, expectTypeOf, it } from 'vitest';
import { timeouts, withMongoPort } from '../../../../_harness/mongo';
import type { Contract, FieldOutputTypes, ProfileOutput } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/composites/selection/tests.ts
// (mongodb matrix entry only — no SQL providers).
//
// Upstream tests four behaviours:
//   1. composites are selected by default    → ported
//   2. composites can be selected explicitly → ported (select('profile') returns whole profile)
//   3. composites can be selected on multiple nesting levels (profile sub-field select) → non-ported
//      — prisma-next's mongo ORM has no nested sub-field select for composite value objects.
//   4. composites are included on default types → ported via contract.d.ts exported types
//      (FieldOutputTypes['__unbound__']['User'] ≈ upstream `User`; ProfileOutput ≈ upstream `Profile`)
//
// Upstream test 4 uses Prisma-generated `User` and `Profile` types; prisma-next's equivalents
// are `FieldOutputTypes['__unbound__']['User']` and `ProfileOutput` from the emitted contract.d.ts.

function withComposites(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

const seedUser = {
  profile: {
    name: { firstName: 'Horsey', lastName: 'McHorseFace' },
    url: 'https://horsey.example.com',
    favoriteThings: [{ name: 'Horsing around at the speed of sound' }],
    alternateName: null,
  },
};

describe('ports/prisma/functional/composites/selection', () => {
  it(
    'composites are selected by default',
    () =>
      withComposites(async ({ db }) => {
        await db.user.create(seedUser);

        const user = await db.user.all().firstOrThrow();

        expect(user).toHaveProperty('profile');
        expect(user.profile).toHaveProperty('url');
        expect(user.profile).toHaveProperty('name');
        expect(user.profile).toHaveProperty('favoriteThings');

        expectTypeOf(user).toHaveProperty('profile');
        expectTypeOf(user.profile).toHaveProperty('url');
        expectTypeOf(user.profile).toHaveProperty('name');
        expectTypeOf(user.profile.name).not.toBeNullable();
        expectTypeOf(user.profile).toHaveProperty('alternateName');
        expectTypeOf(user.profile.alternateName).toMatchTypeOf<{
          firstName: string;
          lastName: string;
        } | null>();
        expectTypeOf(user.profile).toHaveProperty('favoriteThings');
        expectTypeOf(user.profile.favoriteThings).toMatchTypeOf<ReadonlyArray<{ name: string }>>();
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'composites can be selected explicitly',
    () =>
      withComposites(async ({ db }) => {
        await db.user.create(seedUser);

        const user = await db.user.select('profile').all().firstOrThrow();

        expect(user).toHaveProperty('profile');
        expect(user.profile).toHaveProperty('url');
        expect(user.profile).toHaveProperty('name');
        expect(user.profile).toHaveProperty('favoriteThings');

        expectTypeOf(user).toHaveProperty('profile');
        expectTypeOf(user.profile).toHaveProperty('url');
        expectTypeOf(user.profile).toHaveProperty('name');
        expectTypeOf(user.profile.name).not.toBeNullable();
        expectTypeOf(user.profile).toHaveProperty('alternateName');
        expectTypeOf(user.profile.alternateName).toMatchTypeOf<{
          firstName: string;
          lastName: string;
        } | null>();
        expectTypeOf(user.profile).toHaveProperty('favoriteThings');
        expectTypeOf(user.profile.favoriteThings).toMatchTypeOf<ReadonlyArray<{ name: string }>>();
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  // Upstream test 4: `composites are included on default types`
  // Uses Prisma-generated `User` and `Profile` type-level assertions.
  // In prisma-next, FieldOutputTypes['__unbound__']['User'] ≈ upstream `User`,
  // and ProfileOutput ≈ upstream `Profile`.
  it('composites are included on default types', () => {
    type UserRow = FieldOutputTypes['__unbound__']['User'];

    expectTypeOf<UserRow>().toHaveProperty('profile');
    expectTypeOf<ProfileOutput>().toHaveProperty('name');
    expectTypeOf<ProfileOutput>().toHaveProperty('alternateName');
    expectTypeOf<ProfileOutput['alternateName']>().toMatchTypeOf<{
      firstName: string;
      lastName: string;
    } | null>();
    expectTypeOf<ProfileOutput>().toHaveProperty('favoriteThings');
    expectTypeOf<ProfileOutput['favoriteThings']>().toMatchTypeOf<
      ReadonlyArray<{ name: string }>
    >();
  });
});
