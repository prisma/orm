import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

function withDecimal(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/engines/queries/data_types/decimal', () => {
  it(
    'read_one',
    () =>
      withDecimal(async ({ db }) => {
        await db.public.TestModel.create({ id: 1, decimal: '12.3456' });
        await db.public.TestModel.create({ id: 2, decimal: '-1.2345678' });
        await db.public.TestModel.create({ id: 3 });
        const result = await db.public.TestModel.select('decimal').first({ id: 1 });
        expect(result).toEqual({ decimal: '12.3456' });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'read_many',
    () =>
      withDecimal(async ({ db }) => {
        await db.public.TestModel.create({ id: 1, decimal: '12.3456' });
        await db.public.TestModel.create({ id: 2, decimal: '-1.2345678' });
        await db.public.TestModel.create({ id: 3 });
        const result = await db.public.TestModel.select('decimal').all();
        expect(result).toEqual([
          { decimal: '12.3456' },
          { decimal: '-1.2345678' },
          { decimal: null },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );
});
