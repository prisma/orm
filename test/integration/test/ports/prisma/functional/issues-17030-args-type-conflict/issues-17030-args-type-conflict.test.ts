import { describe, expectTypeOf, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/issues/17030-args-type-conflict
// (postgres matrix entry; allProviders — porting postgres only per brief).
//
// Upstream: verifies that `include: { details: true }` works correctly when
// the model has a `@@unique([entryLanguage, characterId])` constraint whose
// generated Prisma type name historically conflicted with the `include` args
// type. The test uses `findUnique` by the compound unique key and asserts
// that the result type has the `details` property.
//
// Port:
//   - findUnique({ where: { entryLanguage_characterId: { ... } } }) →
//       db.public.CharacterInfo.where({ entryLanguage: '', characterId: '' }).first()
//   - include: { details: true } → .include('details')
//   - expectTypeOf(info!).toHaveProperty('details') → inline type assertion
//
// Note: prisma-next uses structural types with no codegen naming conflicts,
// so this test verifies the same runtime + type behavior directly.

describe('ports/prisma/functional/issues-17030-args-type-conflict', () => {
  it(
    'include works correctly',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const info = await db.public.CharacterInfo.include('details')
          .where({ entryLanguage: '', characterId: '' })
          .first();

        // Upstream: expectTypeOf(info!).toHaveProperty('details')
        // info is null (no rows), but expectTypeOf is a compile-time assertion.
        expectTypeOf(info!).toHaveProperty('details');
      }),
    timeouts.spinUpPpgDev,
  );
});
