import { describe, expect, expectTypeOf, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/methods/findFirstOrThrow
// (postgres matrix entry).
//
// Upstream uses prisma.user.findFirstOrThrow({ where: { email } }).
// prisma-next equivalent: db.public.User.where({ email }).all().firstOrThrow()
// which throws RUNTIME.NO_ROWS when no row is found (maps to upstream P2025).
//
// Dispositions:
//   - 'works with interactive transactions' — ported via the facade's high-level
//     `transaction(async (tx) => …)`: the failing firstOrThrow rejects the
//     transaction and rolls back the create (RUNTIME.NO_ROWS maps to upstream P2025).
//   - 'works with transactions' — NON-PORTED: the array/batch `$transaction([...])`
//     form has no prisma-next equivalent (interactive transactions do).
//   - 'reports correct method name in case of validation error' — NON-PORTED:
//     upstream asserts the error message contains the client method name
//     ('findFirstOrThrow'); prisma-next errors carry structured codes, not the
//     invoking method name.

const existingEmail = 'existing@example.com';
const nonExistingEmail = 'nonexisting@example.com';

function withFindFirstOrThrow(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.User.create({
      email: existingEmail,
      posts: (posts) => posts.create([{ title: 'How to exist?' }]),
    });
    await fn(ctx);
  });
}

describe('ports/prisma/functional/methods-findFirstOrThrow', () => {
  it(
    'finds existing record',
    () =>
      withFindFirstOrThrow(async ({ db }) => {
        const record = await db.public.User.where({ email: existingEmail }).all().firstOrThrow();
        expect(record).toMatchObject({ email: existingEmail });
        expect(typeof record.id).toBe('string');
        expectTypeOf(record).not.toBeNullable();
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'throws if record was not found',
    () =>
      withFindFirstOrThrow(async ({ db }) => {
        const query = db.public.User.where({ email: nonExistingEmail }).all().firstOrThrow();
        await expect(query).rejects.toMatchObject({
          code: 'RUNTIME.NO_ROWS',
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'works with interactive transactions',
    () =>
      withFindFirstOrThrow(async ({ db, transaction }) => {
        const newEmail = 'tx-new@example.com';
        const result = transaction(async (tx) => {
          await tx.orm.public.User.create({ email: newEmail });
          await tx.orm.public.User.where({ email: nonExistingEmail }).all().firstOrThrow();
        });
        await expect(result).rejects.toMatchObject({ code: 'RUNTIME.NO_ROWS' });

        // The failing firstOrThrow rolled the whole transaction back.
        const record = await db.public.User.where({ email: newEmail }).all();
        expect(record).toEqual([]);
      }),
    timeouts.spinUpPpgDev,
  );
});
