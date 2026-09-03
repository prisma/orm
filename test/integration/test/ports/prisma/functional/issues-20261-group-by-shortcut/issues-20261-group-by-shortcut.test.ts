import { describe, expect, expectTypeOf, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/20261-group-by-shortcut
// (postgres matrix entry).
//
// Subject: Prisma `groupBy` accepts a scalar string in `by` (not just an array).
//
// API-shape translation:
//   `groupBy({ by: 'teamName', _sum: { points: true }, orderBy: { teamName: 'asc' } })`
//   → `.groupBy('teamName').aggregate(agg => ({ _sum: agg.sum('points') }))`
//
// The scalar-`by` shorthand and _sum aggregation are expressible; ordering is not
// (GroupedCollection has no .orderBy()). The assertion is order-independent: we check
// length and use toContainEqual for each expected group.
//
// Non-ported tests:
//   'works with a scalar in "by" and no other selection'
//     — groupBy with no aggregation cannot be expressed in prisma-next's
//       public API: groupBy().aggregate() requires at least one selector.
//   'works with extended client'
//     — `prisma.$extends({})` has no equivalent in prisma-next.

const SEED = [
  { teamName: 'Red', points: 5 },
  { teamName: 'Blue', points: 7 },
  { teamName: 'Red', points: 4 },
  { teamName: 'Blue', points: 3 },
];

function withIssue20261(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.Round.createAll(SEED);
    await fn(ctx);
  });
}

describe('ports/prisma/functional/issues-20261-group-by-shortcut', () => {
  it(
    'works with a scalar in "by"',
    () =>
      withIssue20261(async ({ db }) => {
        const result = await db.public.Round.groupBy('teamName').aggregate((agg) => ({
          _sum: agg.sum('points'),
        }));

        expect(result).toHaveLength(2);
        expect(result).toContainEqual({ _sum: 10, teamName: 'Blue' });
        expect(result).toContainEqual({ _sum: 9, teamName: 'Red' });

        expectTypeOf(result).toMatchTypeOf<
          Array<{
            _sum: number | null;
            teamName: string;
          }>
        >();
      }),
    timeouts.spinUpPpgDev,
  );
});
