import { and, not } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

function withDecimalFilter(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.TestModel.createAll([
      { id: 1, decimal: '5.5' },
      { id: 2, decimal: '1' },
      { id: 3 },
    ]);
    await fn(ctx);
  });
}

describe('ports/engines/queries/filters/decimal_filter', () => {
  it(
    'basic_where',
    () =>
      withDecimalFilter(async ({ db }) => {
        const equals = await db.public.TestModel.where((row) => row.decimal.eq('5.5'))
          .select('id')
          .all();
        expect(equals).toEqual([{ id: 1 }]);

        const notOneAndNotNull = await db.public.TestModel.where((row) =>
          and(row.decimal.neq('1.0'), row.decimal.isNotNull()),
        )
          .select('id')
          .all();
        expect(notOneAndNotNull).toEqual([{ id: 1 }]);

        const notNull = await db.public.TestModel.where((row) => row.decimal.isNotNull())
          .select('id')
          .all();
        expect(notNull).toEqual([{ id: 1 }, { id: 2 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'where_shorthands',
    () =>
      withDecimalFilter(async ({ db }) => {
        const equals = await db.public.TestModel.where({ decimal: '5.5' }).select('id').all();
        expect(equals).toEqual([{ id: 1 }]);

        const nulls = await db.public.TestModel.where({ decimal: null }).select('id').all();
        expect(nulls).toEqual([{ id: 3 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'inclusion_filter',
    () =>
      withDecimalFilter(async ({ db }) => {
        const included = await db.public.TestModel.where((row) => row.decimal.in(['5.5', '1.0']))
          .select('id')
          .all();
        expect(included).toEqual([{ id: 1 }, { id: 2 }]);

        const notInAndNotNull = await db.public.TestModel.where((row) =>
          and(row.decimal.notIn(['1.0']), row.decimal.isNotNull()),
        )
          .select('id')
          .all();
        expect(notInAndNotNull).toEqual([{ id: 1 }]);

        const negatedInAndNotNull = await db.public.TestModel.where((row) =>
          and(not(row.decimal.in(['1.0'])), row.decimal.isNotNull()),
        )
          .select('id')
          .all();
        expect(negatedInAndNotNull).toEqual([{ id: 1 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'numeric_comparison_filters',
    () =>
      withDecimalFilter(async ({ db }) => {
        expect(
          await db.public.TestModel.where((row) => row.decimal.gt('1.0'))
            .select('id')
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.where((row) => not(row.decimal.gt('1.0')))
            .select('id')
            .all(),
        ).toEqual([{ id: 2 }]);
        expect(
          await db.public.TestModel.where((row) => row.decimal.gte('1.0'))
            .select('id')
            .all(),
        ).toEqual([{ id: 1 }, { id: 2 }]);
        expect(
          await db.public.TestModel.where((row) => not(row.decimal.gte('5.5')))
            .select('id')
            .all(),
        ).toEqual([{ id: 2 }]);
        expect(
          await db.public.TestModel.where((row) => row.decimal.lt('6'))
            .select('id')
            .all(),
        ).toEqual([{ id: 1 }, { id: 2 }]);
        expect(
          await db.public.TestModel.where((row) => not(row.decimal.lt('5.5')))
            .select('id')
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.where((row) => row.decimal.lte('5.5'))
            .select('id')
            .all(),
        ).toEqual([{ id: 1 }, { id: 2 }]);
        expect(
          await db.public.TestModel.where((row) => not(row.decimal.lte('1')))
            .select('id')
            .all(),
        ).toEqual([{ id: 1 }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
