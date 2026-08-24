import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/methods/count
// (postgres matrix entry).
//
// Upstream seeds three users with email, age, name and counts rows under
// various conditions. Per-field count (count({ select: { _all, email, age, name } }))
// is not expressible via the ORM aggregate builder — those two tests are
// non-ported.
//
// "bad prop": upstream asserts `count({ select: { posts: true } })` is rejected
// at compile time because `posts` (a relation) is not a valid count target.
// Ported as an inline @ts-expect-error on `a.sum('posts')` — the aggregate
// builder constrains sum/avg/min/max to NumericFieldNames, which excludes
// relations, so the type-rejection is faithful. At runtime the invalid column
// also causes the query to throw, so the test asserts rejects.toThrow().

const SEED = [
  { email: 'user-1@email.com', age: 111, name: 'some-name-1' },
  { email: 'user-2@email.com', age: 222, name: 'some-name-2' },
  { email: 'user-3@email.com', age: 333, name: 'some-name-3' },
];

function withCount(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.User.createAll(SEED);
    await fn(ctx);
  });
}

describe('ports/prisma/functional/methods-count', () => {
  it(
    'simple',
    () =>
      withCount(async ({ db }) => {
        const { count } = await db.public.User.aggregate((agg) => ({ count: agg.count() }));
        expect(count).toBe(3);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'limit',
    () =>
      withCount(async ({ db }) => {
        const rows = await db.public.User.limit(2).all();
        expect(rows.length).toBe(2);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'where',
    () =>
      withCount(async ({ db }) => {
        const { count } = await db.public.User.where({ age: 111 }).aggregate((agg) => ({
          count: agg.count(),
        }));
        expect(count).toBe(1);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'select where (select: true is a pass-through to count)',
    () =>
      withCount(async ({ db }) => {
        const { count } = await db.public.User.where({ age: 111 }).aggregate((agg) => ({
          count: agg.count(),
        }));
        expect(count).toBe(1);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'select all true (select: true is a pass-through to count)',
    () =>
      withCount(async ({ db }) => {
        const { count } = await db.public.User.aggregate((agg) => ({ count: agg.count() }));
        expect(count).toBe(3);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'select all false (same result as count)',
    () =>
      withCount(async ({ db }) => {
        const { count } = await db.public.User.aggregate((agg) => ({ count: agg.count() }));
        expect(count).toBe(3);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'bad prop',
    () =>
      withCount(async ({ db }) => {
        // Upstream: `count({ select: { posts: true } })` rejects at compile time
        // because `posts` (a relation) is not a valid count target.
        // Port: `a.sum('posts')` is type-rejected because `posts` is not in
        // NumericFieldNames (relations are excluded from the aggregate field constraint).
        // At runtime the invalid column also causes the query to throw.
        const result = db.public.User.aggregate((agg) => ({
          // @ts-expect-error `posts` is a relation, not a numeric field
          _invalid: agg.sum('posts'),
        }));
        await expect(result).rejects.toThrow();
      }),
    timeouts.spinUpPpgDev,
  );
});
