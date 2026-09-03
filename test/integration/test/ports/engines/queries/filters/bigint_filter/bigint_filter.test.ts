import { and, not } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

function withBigIntFilter(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.TestModel.createAll([
      { id: 1, bInt: 5n, bytes: new Uint8Array(Buffer.from('test')) },
      { id: 2, bInt: 1n, bytes: new Uint8Array(Buffer.from('t')) },
      { id: 3 },
    ]);
    await fn(ctx);
  });
}

describe('ports/engines/queries/filters/bigint_filter', () => {
  it(
    'basic_where',
    () =>
      withBigIntFilter(async ({ db }) => {
        expect(
          await db.public.TestModel.select('id')
            .where((m) => m.bInt.eq(5n))
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => and(m.bInt.neq(1n), m.bInt.isNotNull()))
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => m.bInt.isNotNull())
            .all(),
        ).toEqual([{ id: 1 }, { id: 2 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'where_shorthands',
    () =>
      withBigIntFilter(async ({ db }) => {
        expect(await db.public.TestModel.select('id').where({ bInt: 5n }).all()).toEqual([
          { id: 1 },
        ]);
        expect(await db.public.TestModel.select('id').where({ bInt: null }).all()).toEqual([
          { id: 3 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'inclusion_filter',
    () =>
      withBigIntFilter(async ({ db }) => {
        expect(
          await db.public.TestModel.select('id')
            .where((m) => m.bInt.in([5n, 1n]))
            .all(),
        ).toEqual([{ id: 1 }, { id: 2 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => and(m.bInt.notIn([1n]), m.bInt.isNotNull()))
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => and(not(m.bInt.in([1n])), m.bInt.isNotNull()))
            .all(),
        ).toEqual([{ id: 1 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'numeric_comparison_filters',
    () =>
      withBigIntFilter(async ({ db }) => {
        expect(
          await db.public.TestModel.select('id')
            .where((m) => m.bInt.gt(1n))
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => not(m.bInt.gt(1n)))
            .all(),
        ).toEqual([{ id: 2 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => m.bInt.gte(1n))
            .all(),
        ).toEqual([{ id: 1 }, { id: 2 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => not(m.bInt.gte(5n)))
            .all(),
        ).toEqual([{ id: 2 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => m.bInt.lt(6n))
            .all(),
        ).toEqual([{ id: 1 }, { id: 2 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => not(m.bInt.lt(5n)))
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => m.bInt.lte(5n))
            .all(),
        ).toEqual([{ id: 1 }, { id: 2 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((m) => not(m.bInt.lte(1n)))
            .all(),
        ).toEqual([{ id: 1 }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
