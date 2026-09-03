import type { Numeric } from '@internal/target-postgres/codec-types';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract as DecimalContract } from './_fixture/decimal/generated/contract';
import decimalContractJson from './_fixture/decimal/generated/contract.json' with { type: 'json' };
import type { Contract as NumericContract } from './_fixture/numeric/generated/contract';
import numericContractJson from './_fixture/numeric/generated/contract.json' with { type: 'json' };

describe('ports/engines/queries/aggregation/avg', () => {
  it(
    'returns null numeric averages with no records',
    () =>
      withPostgresPort<NumericContract>({ contractJson: numericContractJson }, async ({ db }) => {
        const result = await db.public.TestModel.aggregate((aggregate) => ({
          int: aggregate.avg('int'),
          bInt: aggregate.avg('bInt'),
          float: aggregate.avg('float'),
        }));

        expect(result).toEqual({ int: null, bInt: null, float: null });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'computes numeric averages across two rows',
    () =>
      withPostgresPort<NumericContract>({ contractJson: numericContractJson }, async ({ db }) => {
        await db.public.TestModel.createAll([
          { id: 1, float: 5.5, int: 5, bInt: 5n },
          { id: 2, float: 4.5, int: 10, bInt: 10n },
        ]);

        const result = await db.public.TestModel.aggregate((aggregate) => ({
          int: aggregate.avg('int'),
          bInt: aggregate.avg('bInt'),
          float: aggregate.avg('float'),
        }));

        expect(result).toEqual({ int: 7.5, bInt: 7.5, float: 5 });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'returns null decimal average with no records',
    () =>
      withPostgresPort<DecimalContract>({ contractJson: decimalContractJson }, async ({ db }) => {
        const result = await db.public.TestModel.aggregate((aggregate) => ({
          decimal: aggregate.avg('decimal'),
        }));

        expect(result).toEqual({ decimal: null });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'computes decimal average across two rows',
    () =>
      withPostgresPort<DecimalContract>({ contractJson: decimalContractJson }, async ({ db }) => {
        await db.public.TestModel.createAll([
          { id: 1, decimal: '5.5' as Numeric<65, 30> },
          { id: 2, decimal: '4.5' as Numeric<65, 30> },
        ]);

        const result = await db.public.TestModel.aggregate((aggregate) => ({
          decimal: aggregate.avg('decimal'),
        }));

        expect(result).toEqual({ decimal: '5.0000000000000000' });
      }),
    timeouts.spinUpPpgDev,
  );
});
