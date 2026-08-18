import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/18970-invalid-date
// (postgres matrix entry).
//
// Subject: querying with an invalid Date object (`new Date('Invalid Date')`)
// should throw rather than silently pass or produce garbage.
//
// API-shape translation:
//   `prisma.user.findMany({ where: { date: new Date('I am not a date') } })`
//   → `db.public.User.where((u) => u.date.eq(Temporal.Instant.from('…'))).all()`
//
// Upstream asserts a Prisma-specific error snapshot (P2009 / "Invalid value for
// argument `date`"). prisma-next does not emit Prisma error codes; the faithful
// assertion is that unparseable input is rejected rather than reaching the database.
//
// A `timestamptz` column carries `Temporal.Instant`, which has no invalid state — the
// rejection an invalid `Date` used to produce at query time now happens at the point the
// value is built. Both halves are asserted: the constructor refuses the text, and a well
// formed instant still queries.

function withIssue18970(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/issues-18970-invalid-date', () => {
  it('rejects an unparseable instant before it can reach a query', () => {
    expect(() => Temporal.Instant.from('I am not a date')).toThrow();
  });

  it(
    'accepts a well formed instant on the same filter',
    () =>
      withIssue18970(async ({ db }) => {
        const rows = await db.public.User.where((u) =>
          u.date.eq(Temporal.Instant.from('2024-01-01T00:00:00Z')),
        ).all();
        expect(rows).toEqual([]);
      }),
    timeouts.spinUpPpgDev,
  );
});
