import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

async function seed(db: Parameters<Parameters<typeof withPostgresPort<Contract>>[1]>[0]['db']) {
  await db.public.TestModel.create({ id: 1, int: -42 });
  await db.public.TestModel.create({ id: 2, int: 1337 });
  await db.public.TestModel.create({ id: 3 });
}

describe('ports/engines/queries/data_types/int', () => {
  it(
    'read_one',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await seed(db);
        const result = await db.public.TestModel.select('int').first({ id: 1 });
        expect(result).toEqual({ int: -42 });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'read_many',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await seed(db);
        const result = await db.public.TestModel.select('int').all();
        expect(result).toEqual([{ int: -42 }, { int: 1337 }, { int: null }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
