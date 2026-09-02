import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/5952-decimal-batch
// (postgres matrix entry; mongodb opted out — no Decimal support).
//
// Upstream seeds two Resource rows (decimal @unique) with decimals '1.2' and '2.4'
// and reads them back concurrently, asserting each round-trips as `new Prisma.Decimal(...)`.
// In prisma-next Decimal (pg/numeric@1) is stored/returned as a plain string; the
// faithful equivalent asserts the returned string equals the seeded decimal string.
//
// Dispositions (per upstream test):
//   - 'findUnique decimal with Promise.all'      → PORTED: two concurrent `.first({decimal})`.
//   - 'findFirst  decimal with Promise.all'      → PORTED: two concurrent `.where({decimal}).first()`.
//   - 'findUnique decimal with $transaction([])' → NON-PORTED: array/batch `$transaction([...])`
//     is absent; prisma-next only has the interactive `transaction(cb)` facade, a different
//     execution path that does not exercise the batch request pipeline this regression depends on.
//   - 'findFirst  decimal with $transaction([])' → NON-PORTED (same reason).

const decimal1 = '1.2';
const decimal2 = '2.4';

function withDecimalBatch(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.Resource.create({ decimal: decimal1 });
    await ctx.db.public.Resource.create({ decimal: decimal2 });
    await fn(ctx);
  });
}

describe('ports/prisma/functional/issues-5952-decimal-batch', () => {
  it(
    'findUnique decimal with Promise.all',
    () =>
      withDecimalBatch(async ({ db }) => {
        const result = await Promise.all([
          db.public.Resource.select('decimal').first({ decimal: decimal1 }),
          db.public.Resource.select('decimal').first({ decimal: decimal2 }),
        ]);
        expect(result.map((r) => String(r?.decimal))).toEqual([decimal1, decimal2]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'findFirst decimal with Promise.all',
    () =>
      withDecimalBatch(async ({ db }) => {
        const result = await Promise.all([
          db.public.Resource.select('decimal').where({ decimal: decimal1 }).first(),
          db.public.Resource.select('decimal').where({ decimal: decimal2 }).first(),
        ]);
        expect(result.map((r) => String(r?.decimal))).toEqual([decimal1, decimal2]);
      }),
    timeouts.spinUpPpgDev,
  );
});
