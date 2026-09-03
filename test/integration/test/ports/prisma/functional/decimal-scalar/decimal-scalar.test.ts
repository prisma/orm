import { and } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/decimal/scalar
// (postgres matrix entry only; mongodb opted out as it does not support Decimal).
//
// Upstream seeds a User with money = 12.5 and reads it back through four
// `where` input forms. In prisma-next, Decimal is stored/returned as a Numeric
// branded string:
//   - 'decimal as string'  — string equality filter → portable.
//   - 'decimal as number'  — `{ gt, lt }` range → portable via the callback
//     filter `u.money.gt(...)/.lt(...)` (PgNumeric carries the `order` trait).
//   - 'decimal as Decimal.js instance' / 'decimal as decimal.js-like object' —
//     non-portable: prisma-next has no Decimal.js input interop.
// The two non-portable cases are recorded in the ledger.

function withDecimalScalar(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.User.create({ money: '12.5' });
    await fn(ctx);
  });
}

describe('ports/prisma/functional/decimal-scalar', () => {
  it(
    'decimal as string',
    () =>
      withDecimalScalar(async ({ db }) => {
        const result = await db.public.User.first({ money: '12.5' });
        expect(String(result?.money)).toBe('12.5');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'decimal as number (gt/lt range)',
    () =>
      withDecimalScalar(async ({ db }) => {
        const result = await db.public.User.where((u) =>
          and(u.money.gt('12.4'), u.money.lt('12.6')),
        ).first();
        expect(String(result?.money)).toBe('12.5');
      }),
    timeouts.spinUpPpgDev,
  );
});
