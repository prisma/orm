import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract as CommonContract } from './_fixture/common/generated/contract';
import commonContractJson from './_fixture/common/generated/contract.json' with { type: 'json' };
import type { Contract as DecimalContract } from './_fixture/decimal/generated/contract';
import decimalContractJson from './_fixture/decimal/generated/contract.json' with { type: 'json' };

function withCommonMin(fn: Parameters<typeof withPostgresPort<CommonContract>>[1]) {
  return withPostgresPort<CommonContract>({ contractJson: commonContractJson }, fn);
}

function withDecimalMin(fn: Parameters<typeof withPostgresPort<DecimalContract>>[1]) {
  return withPostgresPort<DecimalContract>({ contractJson: decimalContractJson }, fn);
}

describe('ports/engines/queries/aggregation/min', () => {
  it(
    'min_no_records',
    () =>
      withCommonMin(async ({ db }) => {
        const result = await db.public.TestModel.aggregate((aggregate) => ({
          string: aggregate.min('string'),
          int: aggregate.min('int'),
          bInt: aggregate.min('bInt'),
          float: aggregate.min('float'),
        }));

        expect(result).toEqual({ string: null, int: null, bInt: null, float: null });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'min_some_records',
    () =>
      withCommonMin(async ({ db }) => {
        await db.public.TestModel.createAll([
          { id: 1, float: 5.5, int: 5, bInt: 5n, string: 'a' },
          { id: 2, float: 4.5, int: 10, bInt: 10n, string: 'b' },
        ]);

        const result = await db.public.TestModel.aggregate((aggregate) => ({
          int: aggregate.min('int'),
          bInt: aggregate.min('bInt'),
          float: aggregate.min('float'),
          string: aggregate.min('string'),
        }));

        expect(result).toEqual({ int: 5, bInt: 5n, float: 4.5, string: 'a' });
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'min_with_all_sorts_of_query_args',
    () =>
      withCommonMin(async ({ db }) => {
        await db.public.TestModel.createAll([
          { id: 1, float: 5.5, int: 5, bInt: 5n, string: '2' },
          { id: 2, float: 4.5, int: 10, bInt: 10n, string: 'f' },
          { id: 3, float: 1.5, int: 2, bInt: 2n, string: 'z' },
          { id: 4, float: 0, int: 1, bInt: 1n, string: 'g' },
        ]);

        const takeTwo = await db.public.TestModel.limit(2).aggregate((aggregate) => ({
          int: aggregate.min('int'),
          bInt: aggregate.min('bInt'),
          float: aggregate.min('float'),
          string: aggregate.min('string'),
        }));
        const takeFive = await db.public.TestModel.limit(5).aggregate((aggregate) => ({
          int: aggregate.min('int'),
          bInt: aggregate.min('bInt'),
          float: aggregate.min('float'),
          string: aggregate.min('string'),
        }));
        const takeNegativeFive = await db.public.TestModel.limit(-5).aggregate((aggregate) => ({
          int: aggregate.min('int'),
          bInt: aggregate.min('bInt'),
          float: aggregate.min('float'),
          string: aggregate.min('string'),
        }));
        const whereIdGreaterThanTwo = await db.public.TestModel.where((row) =>
          row.id.gt(2),
        ).aggregate((aggregate) => ({
          int: aggregate.min('int'),
          bInt: aggregate.min('bInt'),
          float: aggregate.min('float'),
          string: aggregate.min('string'),
        }));
        const skipTwo = await db.public.TestModel.offset(2).aggregate((aggregate) => ({
          int: aggregate.min('int'),
          bInt: aggregate.min('bInt'),
          float: aggregate.min('float'),
          string: aggregate.min('string'),
        }));
        const cursorAtThree = await db.public.TestModel.cursor({ id: 3 } as never).aggregate(
          (aggregate) => ({
            int: aggregate.min('int'),
            bInt: aggregate.min('bInt'),
            float: aggregate.min('float'),
            string: aggregate.min('string'),
          }),
        );

        expect(takeTwo).toEqual({ int: 5, bInt: 5n, float: 4.5, string: '2' });
        expect(takeFive).toEqual({ int: 1, bInt: 1n, float: 0, string: '2' });
        expect(takeNegativeFive).toEqual({ int: 1, bInt: 1n, float: 0, string: '2' });
        expect(whereIdGreaterThanTwo).toEqual({ int: 1, bInt: 1n, float: 0, string: 'g' });
        expect(skipTwo).toEqual({ int: 1, bInt: 1n, float: 0, string: 'g' });
        expect(cursorAtThree).toEqual({ int: 1, bInt: 1n, float: 0, string: 'g' });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'decimal min_no_records',
    () =>
      withDecimalMin(async ({ db }) => {
        const result = await db.public.TestModel.aggregate((aggregate) => ({
          decimal: aggregate.min('decimal'),
        }));

        expect(result).toEqual({ decimal: null });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'decimal min_some_records',
    () =>
      withDecimalMin(async ({ db }) => {
        await db.public.TestModel.createAll([
          { id: 1, decimal: '5.5' },
          { id: 2, decimal: '4.5' },
        ]);

        const result = await db.public.TestModel.aggregate((aggregate) => ({
          decimal: aggregate.min('decimal'),
        }));

        expect(result).toEqual({ decimal: '4.5' });
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'decimal min_with_all_sorts_of_query_args',
    () =>
      withDecimalMin(async ({ db }) => {
        await db.public.TestModel.createAll([
          { id: 1, decimal: '5.5' },
          { id: 2, decimal: '4.5' },
          { id: 3, decimal: '1.5' },
          { id: 4, decimal: '0.0' },
        ]);

        const takeTwo = await db.public.TestModel.limit(2).aggregate((aggregate) => ({
          decimal: aggregate.min('decimal'),
        }));
        const takeFive = await db.public.TestModel.limit(5).aggregate((aggregate) => ({
          decimal: aggregate.min('decimal'),
        }));
        const takeNegativeFive = await db.public.TestModel.limit(-5).aggregate((aggregate) => ({
          decimal: aggregate.min('decimal'),
        }));
        const whereIdGreaterThanTwo = await db.public.TestModel.where((row) =>
          row.id.gt(2),
        ).aggregate((aggregate) => ({
          decimal: aggregate.min('decimal'),
        }));
        const skipTwo = await db.public.TestModel.offset(2).aggregate((aggregate) => ({
          decimal: aggregate.min('decimal'),
        }));
        const cursorAtThree = await db.public.TestModel.cursor({ id: 3 } as never).aggregate(
          (aggregate) => ({ decimal: aggregate.min('decimal') }),
        );

        expect(takeTwo).toEqual({ decimal: '4.5' });
        expect(takeFive).toEqual({ decimal: '0' });
        expect(takeNegativeFive).toEqual({ decimal: '0' });
        expect(whereIdGreaterThanTwo).toEqual({ decimal: '0' });
        expect(skipTwo).toEqual({ decimal: '0' });
        expect(cursorAtThree).toEqual({ decimal: '0' });
      }),
    timeouts.spinUpPpgDev,
  );
});
