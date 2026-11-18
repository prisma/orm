import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

function withBigInt(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/engines/queries/data_types/bigint', () => {
  it(
    'read_one',
    () =>
      withBigInt(async ({ db }) => {
        await db.public.TestModel.create({ id: 1, bInt: 10000000000n });
        await db.public.TestModel.create({ id: 2, bInt: -10000000000n });
        await db.public.TestModel.create({ id: 3 });
        const result = await db.public.TestModel.select('bInt').first({ id: 1 });
        expect(result).toEqual({ bInt: 10000000000n });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'read_many',
    () =>
      withBigInt(async ({ db }) => {
        await db.public.TestModel.create({ id: 1, bInt: 10000000000n });
        await db.public.TestModel.create({ id: 2, bInt: -10000000000n });
        await db.public.TestModel.create({ id: 3 });
        const result = await db.public.TestModel.select('bInt').all();
        expect(result).toEqual([{ bInt: 10000000000n }, { bInt: -10000000000n }, { bInt: null }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
