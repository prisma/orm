import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/0-legacy-ports/aggregations
// (postgres matrix entry).
//
// Upstream seeds four users with explicit ages [20, 45, 60, 63] (sum=188, avg=47).
// prisma-next aggregate builder: agg.count(), agg.min('age'), agg.max('age'),
// agg.sum('age'), agg.avg('age').
//
// The `invalid *` tests assert BOTH a compile-time rejection (`@ts-expect-error`
// on a field the target declares no such aggregate over) AND a runtime
// rejection. Ported faithfully with both assertions inline.
//
// 'multiple aggregations with where' in upstream uses _count: { email: true }
// (count of non-null email values). prisma-next agg.count() counts all rows —
// all 3 rows with age > 20 have non-null email, so the assertion still holds.

const SEED = [
  { email: 'user-1@example.com', age: 20 },
  { email: 'user-2@example.com', age: 45 },
  { email: 'user-3@example.com', age: 60 },
  { email: 'user-4@example.com', age: 63 },
];

function withAggregations(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.User.createAll(SEED);
    await fn(ctx);
  });
}

describe('ports/prisma/functional/legacy-aggregations', () => {
  it(
    'min',
    () =>
      withAggregations(async ({ db }) => {
        const result = await db.public.User.aggregate((agg) => ({ _min: agg.min('age') }));
        expect(result).toEqual({ _min: 20 });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'max',
    () =>
      withAggregations(async ({ db }) => {
        const result = await db.public.User.aggregate((agg) => ({ _max: agg.max('age') }));
        expect(result).toEqual({ _max: 63 });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'sum',
    () =>
      withAggregations(async ({ db }) => {
        const result = await db.public.User.aggregate((agg) => ({ _sum: agg.sum('age') }));
        expect(result).toEqual({ _sum: 188 });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'count inline boolean',
    () =>
      withAggregations(async ({ db }) => {
        const result = await db.public.User.aggregate((agg) => ({ _count: agg.count() }));
        expect(result).toEqual({ _count: 4 });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'count with _all',
    () =>
      withAggregations(async ({ db }) => {
        const result = await db.public.User.aggregate((agg) => ({ _count: agg.count() }));
        expect(result).toEqual({ _count: 4 });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'avg',
    () =>
      withAggregations(async ({ db }) => {
        const result = await db.public.User.aggregate((agg) => ({ _avg: agg.avg('age') }));
        expect(result).toEqual({ _avg: 47 });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'multiple aggregations',
    () =>
      withAggregations(async ({ db }) => {
        const result = await db.public.User.aggregate((agg) => ({
          _avg: agg.avg('age'),
          _count: agg.count(),
          _max: agg.max('age'),
          _min: agg.min('age'),
          _sum: agg.sum('age'),
        }));
        expect(result).toEqual({
          _avg: 47,
          _count: 4,
          _max: 63,
          _min: 20,
          _sum: 188,
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'multiple aggregations with where',
    () =>
      withAggregations(async ({ db }) => {
        const result = await db.public.User.where((u) => u.age.gt(20)).aggregate((agg) => ({
          _avg: agg.avg('age'),
          _count: agg.count(),
          _max: agg.max('age'),
          _min: agg.min('age'),
          _sum: agg.sum('age'),
        }));
        expect(result).toEqual({
          _avg: 56,
          _count: 3,
          _max: 63,
          _min: 45,
          _sum: 168,
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'invalid min',
    () =>
      withAggregations(async ({ db }) => {
        // @ts-expect-error `posts` is a relation, not a numeric field
        const result = db.public.User.aggregate((agg) => ({ _min: agg.min('posts') }));
        await expect(result).rejects.toThrow();
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'invalid max',
    () =>
      withAggregations(async ({ db }) => {
        // @ts-expect-error `posts` is a relation, not a numeric field
        const result = db.public.User.aggregate((agg) => ({ _max: agg.max('posts') }));
        await expect(result).rejects.toThrow();
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'invalid sum',
    () =>
      withAggregations(async ({ db }) => {
        // @ts-expect-error `email` is text, not a numeric field
        const result = db.public.User.aggregate((agg) => ({ _sum: agg.sum('email') }));
        await expect(result).rejects.toThrow();
      }),
    timeouts.spinUpPpgDev,
  );

  // `count` admits a field argument — the target declares it over any input —
  // but only a field the contract declares; a relation name is neither.
  it(
    'invalid count',
    () =>
      withAggregations(async ({ db }) => {
        // @ts-expect-error `posts` is a relation, not an aggregatable field
        const result = db.public.User.aggregate((agg) => ({ _count: agg.count('posts') }));
        await expect(result).rejects.toThrow();
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'invalid avg',
    () =>
      withAggregations(async ({ db }) => {
        // @ts-expect-error `email` is text, not a numeric field
        const result = db.public.User.aggregate((agg) => ({ _avg: agg.avg('email') }));
        await expect(result).rejects.toThrow();
      }),
    timeouts.spinUpPpgDev,
  );
});
