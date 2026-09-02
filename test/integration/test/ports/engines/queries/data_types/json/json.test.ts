import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract as ScalarContract } from './_fixture/scalar/generated/contract';
import scalarContractJson from './_fixture/scalar/generated/contract.json' with { type: 'json' };

async function seedScalar(
  db: Parameters<Parameters<typeof withPostgresPort<ScalarContract>>[1]>[0]['db'],
) {
  await db.public.TestModel.create({ id: 1, json: {} });
  await db.public.TestModel.create({ id: 2, json: { a: 'b' } });
  await db.public.TestModel.create({ id: 3, json: 1 });
  await db.public.TestModel.create({ id: 4, json: 1.5 });
  await db.public.TestModel.create({ id: 5, json: 'hello' });
  await db.public.TestModel.create({ id: 6, json: [1, 'a', { b: true }] });
  await db.public.TestModel.create({ id: 7, json: true });
}

describe('ports/engines/queries/data_types/json', () => {
  it.fails(
    'read_one',
    () =>
      withPostgresPort<ScalarContract>({ contractJson: scalarContractJson }, async ({ db }) => {
        await seedScalar(db);
        expect(await db.public.TestModel.select('json').first({ id: 1 })).toEqual({ json: {} });
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'read_many',
    () =>
      withPostgresPort<ScalarContract>({ contractJson: scalarContractJson }, async ({ db }) => {
        await seedScalar(db);
        expect(await db.public.TestModel.select('json').all()).toEqual([
          { json: {} },
          { json: { a: 'b' } },
          { json: 1 },
          { json: 1.5 },
          { json: 'hello' },
          { json: [1, 'a', { b: true }] },
          { json: true },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  for (const [name, id, value] of [
    ['read_plain_float', 4, 1.5],
    ['read_plain_int', 3, 1],
    ['read_plain_bool', 7, true],
  ] as const) {
    it.fails(
      name,
      () =>
        withPostgresPort<ScalarContract>({ contractJson: scalarContractJson }, async ({ db }) => {
          await seedScalar(db);
          expect(await db.public.TestModel.select('json').first({ id })).toEqual({ json: value });
        }),
      timeouts.spinUpPpgDev,
    );
  }

  it.fails(
    'json_null_must_not_be_confused_with_literal_string',
    () =>
      withPostgresPort<ScalarContract>({ contractJson: scalarContractJson }, async ({ db }) => {
        await db.public.TestModel.create({ id: 1, json: 'null' });
        expect(await db.public.TestModel.select('json').all()).toEqual([{ json: 'null' }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
