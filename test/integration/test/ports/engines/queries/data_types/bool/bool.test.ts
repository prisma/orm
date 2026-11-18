import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

function withBoolean(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/engines/queries/data_types/bool', () => {
  it(
    'read_one',
    () =>
      withBoolean(async ({ db }) => {
        await db.public.TestModel.create({ id: 1, bool: true });
        await db.public.TestModel.create({ id: 2, bool: false });
        await db.public.TestModel.create({ id: 3 });
        const result = await db.public.TestModel.select('bool').first({ id: 1 });
        expect(result).toEqual({ bool: true });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'read_many',
    () =>
      withBoolean(async ({ db }) => {
        await db.public.TestModel.create({ id: 1, bool: true });
        await db.public.TestModel.create({ id: 2, bool: false });
        await db.public.TestModel.create({ id: 3 });
        const result = await db.public.TestModel.select('bool').all();
        expect(result).toEqual([{ bool: true }, { bool: false }, { bool: null }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
