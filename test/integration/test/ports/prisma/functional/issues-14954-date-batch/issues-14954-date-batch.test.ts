import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/14954-date-batch
// (postgres matrix entry; allProviders — mongo excluded here as this is the postgres port).
//
// Upstream seeds two Resource rows (date @unique) at 2011-01-01 and 2022-02-02 and
// reads them back concurrently, asserting each round-trips to the matching `Date`.
// prisma-next DateTime is `pg/timestamptz-temporal@1`, whose application value is a
// `Temporal.Instant` rather than a `Date`.
//
// Dispositions (per upstream test):
//   - 'findUnique date with Promise.all'      → PORTED: two concurrent `.first({date})`.
//   - 'findFirst  date with Promise.all'      → PORTED: two concurrent `.where({date}).first()`.
//   - 'findUnique date with $transaction([])' → NON-PORTED: array/batch `$transaction([...])`
//     is absent; prisma-next only has the interactive `transaction(cb)` facade, a different
//     execution path that does not exercise the batch request pipeline this regression depends on.
//   - 'findFirst  date with $transaction([])' → NON-PORTED (same reason).

const dateInput1 = '2011-01-01T00:00:00Z';
const dateInput2 = '2022-02-02T00:00:00Z';
const dateOutput1 = Temporal.Instant.from(dateInput1);
const dateOutput2 = Temporal.Instant.from(dateInput2);

function withDateBatch(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.Resource.create({ date: dateOutput1 });
    await ctx.db.public.Resource.create({ date: dateOutput2 });
    await fn(ctx);
  });
}

describe('ports/prisma/functional/issues-14954-date-batch', () => {
  it(
    'findUnique date with Promise.all',
    () =>
      withDateBatch(async ({ db }) => {
        const result = await Promise.all([
          db.public.Resource.select('date').first({ date: dateOutput1 }),
          db.public.Resource.select('date').first({ date: dateOutput2 }),
        ]);
        expect(result).toMatchObject([{ date: dateOutput1 }, { date: dateOutput2 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'findFirst date with Promise.all',
    () =>
      withDateBatch(async ({ db }) => {
        const result = await Promise.all([
          db.public.Resource.select('date').where({ date: dateOutput1 }).first(),
          db.public.Resource.select('date').where({ date: dateOutput2 }).first(),
        ]);
        expect(result).toMatchObject([{ date: dateOutput1 }, { date: dateOutput2 }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
