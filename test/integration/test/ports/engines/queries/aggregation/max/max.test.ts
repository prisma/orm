import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract as CommonContract } from './_fixture/common/generated/contract';
import commonContractJson from './_fixture/common/generated/contract.json' with { type: 'json' };
import type { Contract as DecimalContract } from './_fixture/decimal/generated/contract';
import decimalContractJson from './_fixture/decimal/generated/contract.json' with { type: 'json' };

function withCommonMax(fn: Parameters<typeof withPostgresPort<CommonContract>>[1]) {
  return withPostgresPort<CommonContract>({ contractJson: commonContractJson }, fn);
}

function withDecimalMax(fn: Parameters<typeof withPostgresPort<DecimalContract>>[1]) {
  return withPostgresPort<DecimalContract>({ contractJson: decimalContractJson }, fn);
}

describe('ports/engines/queries/aggregation/max', () => {
  it(
    'max_no_records',
    () =>
      withCommonMax(async ({ db }) => {
        const result = await db.public.TestModel.aggregate((aggregate) => ({
          string: aggregate.max('string'),
          int: aggregate.max('int'),
          bInt: aggregate.max('bInt'),
          float: aggregate.max('float'),
        }));

        expect(result).toEqual({ string: null, int: null, bInt: null, float: null });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'max_some_records',
    () =>
      withCommonMax(async ({ db }) => {
        await db.public.TestModel.createAll([
          { id: 1, float: 5.5, int: 5, bInt: 5n, string: 'a' },
          { id: 2, float: 4.5, int: 10, bInt: 10n, string: 'b' },
        ]);

        const result = await db.public.TestModel.aggregate((aggregate) => ({
          int: aggregate.max('int'),
          bInt: aggregate.max('bInt'),
          float: aggregate.max('float'),
          string: aggregate.max('string'),
        }));

        expect(result).toEqual({ int: 10, bInt: 10n, float: 5.5, string: 'b' });
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'max_with_all_sorts_of_query_args',
    () =>
      withCommonMax(async ({ db }) => {
        await db.public.TestModel.createAll([
          { id: 1, float: 5.5, int: 5, bInt: 5n, string: '2' },
          { id: 2, float: 4.5, int: 10, bInt: 10n, string: 'f' },
          { id: 3, float: 1.5, int: 2, bInt: 2n, string: 'z' },
          { id: 4, float: 0, int: 1, bInt: 1n, string: 'g' },
        ]);

        const takeTwo = await db.public.TestModel.limit(2).aggregate((aggregate) => ({
          int: aggregate.max('int'),
          bInt: aggregate.max('bInt'),
          float: aggregate.max('float'),
          string: aggregate.max('string'),
        }));
        const takeFive = await db.public.TestModel.limit(5).aggregate((aggregate) => ({
          int: aggregate.max('int'),
          bInt: aggregate.max('bInt'),
          float: aggregate.max('float'),
          string: aggregate.max('string'),
        }));
        const takeNegativeFive = await db.public.TestModel.limit(-5).aggregate((aggregate) => ({
          int: aggregate.max('int'),
          bInt: aggregate.max('bInt'),
          float: aggregate.max('float'),
          string: aggregate.max('string'),
        }));
        const whereIdGreaterThanTwo = await db.public.TestModel.where((row) =>
          row.id.gt(2),
        ).aggregate((aggregate) => ({
          int: aggregate.max('int'),
          bInt: aggregate.max('bInt'),
          float: aggregate.max('float'),
          string: aggregate.max('string'),
        }));
        const skipTwo = await db.public.TestModel.offset(2).aggregate((aggregate) => ({
          int: aggregate.max('int'),
          bInt: aggregate.max('bInt'),
          float: aggregate.max('float'),
          string: aggregate.max('string'),
        }));
        const cursorAtThree = await db.public.TestModel.cursor({ id: 3 } as never).aggregate(
          (aggregate) => ({
            int: aggregate.max('int'),
            bInt: aggregate.max('bInt'),
            float: aggregate.max('float'),
            string: aggregate.max('string'),
          }),
        );

        expect(takeTwo).toEqual({ int: 10, bInt: 10n, float: 5.5, string: 'f' });
        expect(takeFive).toEqual({ int: 10, bInt: 10n, float: 5.5, string: 'z' });
        expect(takeNegativeFive).toEqual({ int: 10, bInt: 10n, float: 5.5, string: 'z' });
        expect(whereIdGreaterThanTwo).toEqual({ int: 2, bInt: 2n, float: 1.5, string: 'z' });
        expect(skipTwo).toEqual({ int: 2, bInt: 2n, float: 1.5, string: 'z' });
        expect(cursorAtThree).toEqual({ int: 2, bInt: 2n, float: 1.5, string: 'z' });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'decimal max_no_records',
    () =>
      withDecimalMax(async ({ db }) => {
        const result = await db.public.TestModel.aggregate((aggregate) => ({
          decimal: aggregate.max('decimal'),
        }));

        expect(result).toEqual({ decimal: null });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'decimal max_some_records',
    () =>
      withDecimalMax(async ({ db }) => {
        await db.public.TestModel.createAll([
          { id: 1, decimal: '5.5' },
          { id: 2, decimal: '4.5' },
        ]);

        const result = await db.public.TestModel.aggregate((aggregate) => ({
          decimal: aggregate.max('decimal'),
        }));

        expect(result).toEqual({ decimal: '5.5' });
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'decimal max_with_all_sorts_of_query_args',
    () =>
      withDecimalMax(async ({ db }) => {
        await db.public.TestModel.createAll([
          { id: 1, decimal: '5.5' },
          { id: 2, decimal: '4.5' },
          { id: 3, decimal: '1.5' },
          { id: 4, decimal: '0.0' },
        ]);

        const takeTwo = await db.public.TestModel.limit(2).aggregate((aggregate) => ({
          decimal: aggregate.max('decimal'),
        }));
        const takeFive = await db.public.TestModel.limit(5).aggregate((aggregate) => ({
          decimal: aggregate.max('decimal'),
        }));
        const takeNegativeFive = await db.public.TestModel.limit(-5).aggregate((aggregate) => ({
          decimal: aggregate.max('decimal'),
        }));
        const whereIdGreaterThanTwo = await db.public.TestModel.where((row) =>
          row.id.gt(2),
        ).aggregate((aggregate) => ({
          decimal: aggregate.max('decimal'),
        }));
        const skipTwo = await db.public.TestModel.offset(2).aggregate((aggregate) => ({
          decimal: aggregate.max('decimal'),
        }));
        const cursorAtThree = await db.public.TestModel.cursor({ id: 3 } as never).aggregate(
          (aggregate) => ({ decimal: aggregate.max('decimal') }),
        );

        expect(takeTwo).toEqual({ decimal: '5.5' });
        expect(takeFive).toEqual({ decimal: '5.5' });
        expect(takeNegativeFive).toEqual({ decimal: '5.5' });
        expect(whereIdGreaterThanTwo).toEqual({ decimal: '1.5' });
        expect(skipTwo).toEqual({ decimal: '1.5' });
        expect(cursorAtThree).toEqual({ decimal: '1.5' });
      }),
    timeouts.spinUpPpgDev,
  );
});
