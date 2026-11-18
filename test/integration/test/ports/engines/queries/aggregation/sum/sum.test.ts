import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type {
  Contract as DecimalContract,
  FieldInputTypes as DecimalFieldInputTypes,
} from './_fixture/decimal/generated/contract';
import decimalContractJson from './_fixture/decimal/generated/contract.json' with { type: 'json' };
import type { Contract as NumericContract } from './_fixture/numeric/generated/contract';
import numericContractJson from './_fixture/numeric/generated/contract.json' with { type: 'json' };

type DecimalInput = DecimalFieldInputTypes['public']['TestModel']['decimal'];

describe('ports/engines/queries/aggregation/sum', () => {
  it(
    'returns null sums for numeric columns with no records',
    () =>
      withPostgresPort<NumericContract>({ contractJson: numericContractJson }, async ({ db }) => {
        const result = await db.public.TestModel.aggregate((aggregate) => ({
          int: aggregate.sum('int'),
          bInt: aggregate.sum('bInt'),
          float: aggregate.sum('float'),
        }));

        expect(result).toEqual({ int: null, bInt: null, float: null });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'sums numeric columns over records',
    () =>
      withPostgresPort<NumericContract>({ contractJson: numericContractJson }, async ({ db }) => {
        await db.public.TestModel.create({ id: 1, float: 5.5, int: 5, bInt: 5n });
        await db.public.TestModel.create({ id: 2, float: 4.5, int: 10, bInt: 10n });

        const result = await db.public.TestModel.aggregate((aggregate) => ({
          int: aggregate.sum('int'),
          bInt: aggregate.sum('bInt'),
          float: aggregate.sum('float'),
        }));

        expect(result).toEqual({ int: 15, bInt: 15, float: 10 });
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'honors query arguments when summing numeric columns',
    () =>
      withPostgresPort<NumericContract>({ contractJson: numericContractJson }, async ({ db }) => {
        await db.public.TestModel.create({ id: 1, float: 5.5, int: 5, bInt: 5n });
        await db.public.TestModel.create({ id: 2, float: 4.5, int: 10, bInt: 10n });
        await db.public.TestModel.create({ id: 3, float: 1.5, int: 2, bInt: 2n });
        await db.public.TestModel.create({ id: 4, float: 0, int: 1, bInt: 1n });

        const takeTwo = await db.public.TestModel.limit(2).aggregate((aggregate) => ({
          int: aggregate.sum('int'),
          bInt: aggregate.sum('bInt'),
          float: aggregate.sum('float'),
        }));
        const takeFive = await db.public.TestModel.limit(5).aggregate((aggregate) => ({
          int: aggregate.sum('int'),
          bInt: aggregate.sum('bInt'),
          float: aggregate.sum('float'),
        }));
        const takeNegativeFive = await db.public.TestModel.limit(-5).aggregate((aggregate) => ({
          int: aggregate.sum('int'),
          bInt: aggregate.sum('bInt'),
          float: aggregate.sum('float'),
        }));
        const whereIdGreaterThanTwo = await db.public.TestModel.where((row) =>
          row.id.gt(2),
        ).aggregate((aggregate) => ({
          int: aggregate.sum('int'),
          bInt: aggregate.sum('bInt'),
          float: aggregate.sum('float'),
        }));
        const skipTwo = await db.public.TestModel.offset(2).aggregate((aggregate) => ({
          int: aggregate.sum('int'),
          bInt: aggregate.sum('bInt'),
          float: aggregate.sum('float'),
        }));
        const cursorAtThree = await db.public.TestModel.orderBy((row) => row.id.asc())
          .cursor({ id: 3 })
          .aggregate((aggregate) => ({
            int: aggregate.sum('int'),
            bInt: aggregate.sum('bInt'),
            float: aggregate.sum('float'),
          }));

        expect(takeTwo).toEqual({ int: 15, bInt: 15, float: 10 });
        expect(takeFive).toEqual({ int: 18, bInt: 18, float: 11.5 });
        expect(takeNegativeFive).toEqual({ int: 18, bInt: 18, float: 11.5 });
        expect(whereIdGreaterThanTwo).toEqual({ int: 3, bInt: 3, float: 1.5 });
        expect(skipTwo).toEqual({ int: 3, bInt: 3, float: 1.5 });
        expect(cursorAtThree).toEqual({ int: 3, bInt: 3, float: 1.5 });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'returns a null decimal sum with no records',
    () =>
      withPostgresPort<DecimalContract>({ contractJson: decimalContractJson }, async ({ db }) => {
        const result = await db.public.TestModel.aggregate((aggregate) => ({
          decimal: aggregate.sum('decimal'),
        }));

        expect(result).toEqual({ decimal: null });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'sums decimal values over records',
    () =>
      withPostgresPort<DecimalContract>({ contractJson: decimalContractJson }, async ({ db }) => {
        await db.public.TestModel.create({ id: 1, decimal: '5.5' as DecimalInput });
        await db.public.TestModel.create({ id: 2, decimal: '4.5' as DecimalInput });

        const result = await db.public.TestModel.aggregate((aggregate) => ({
          decimal: aggregate.sum('decimal'),
        }));

        expect(result).toEqual({ decimal: '10.0' });
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'honors query arguments when summing decimal values',
    () =>
      withPostgresPort<DecimalContract>({ contractJson: decimalContractJson }, async ({ db }) => {
        await db.public.TestModel.create({ id: 1, decimal: '5.5' as DecimalInput });
        await db.public.TestModel.create({ id: 2, decimal: '4.5' as DecimalInput });
        await db.public.TestModel.create({ id: 3, decimal: '1.5' as DecimalInput });
        await db.public.TestModel.create({ id: 4, decimal: '0.0' as DecimalInput });

        const takeTwo = await db.public.TestModel.limit(2).aggregate((aggregate) => ({
          decimal: aggregate.sum('decimal'),
        }));
        const takeFive = await db.public.TestModel.limit(5).aggregate((aggregate) => ({
          decimal: aggregate.sum('decimal'),
        }));
        const takeNegativeFive = await db.public.TestModel.limit(-5).aggregate((aggregate) => ({
          decimal: aggregate.sum('decimal'),
        }));
        const whereIdGreaterThanTwo = await db.public.TestModel.where((row) =>
          row.id.gt(2),
        ).aggregate((aggregate) => ({
          decimal: aggregate.sum('decimal'),
        }));
        const skipTwo = await db.public.TestModel.offset(2).aggregate((aggregate) => ({
          decimal: aggregate.sum('decimal'),
        }));
        const cursorAtThree = await db.public.TestModel.orderBy((row) => row.id.asc())
          .cursor({ id: 3 })
          .aggregate((aggregate) => ({
            decimal: aggregate.sum('decimal'),
          }));

        expect(takeTwo).toEqual({ decimal: '10.0' });
        expect(takeFive).toEqual({ decimal: '11.5' });
        expect(takeNegativeFive).toEqual({ decimal: '11.5' });
        expect(whereIdGreaterThanTwo).toEqual({ decimal: '1.5' });
        expect(skipTwo).toEqual({ decimal: '1.5' });
        expect(cursorAtThree).toEqual({ decimal: '1.5' });
      }),
    timeouts.spinUpPpgDev,
  );
});
