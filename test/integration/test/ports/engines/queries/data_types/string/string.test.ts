import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

async function seed(db: Parameters<Parameters<typeof withPostgresPort<Contract>>[1]>[0]['db']) {
  await db.public.TestModel.create({ id: 1, string: 'abc' });
  await db.public.TestModel.create({ id: 2, string: 'defg' });
  await db.public.TestModel.create({ id: 3 });
}

describe('ports/engines/queries/data_types/string', () => {
  it(
    'read_one',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await seed(db);
        const result = await db.public.TestModel.select('string').first({ id: 1 });
        expect(result).toEqual({ string: 'abc' });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'read_many',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await seed(db);
        const result = await db.public.TestModel.select('string').all();
        expect(result).toEqual([{ string: 'abc' }, { string: 'defg' }, { string: null }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
