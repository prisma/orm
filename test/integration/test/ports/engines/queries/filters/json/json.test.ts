import { and } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/optional/generated/contract';
import contractJson from './_fixture/optional/generated/contract.json' with { type: 'json' };

describe('ports/engines/queries/filters/json', () => {
  it(
    'basic',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await db.public.TestModel.createAll([
          { id: 1, json: {} },
          { id: 2, json: { a: 'b' } },
          { id: 3, json: null },
        ]);

        expect(
          await db.public.TestModel.select('id')
            .where((row) => row.json.eq({}))
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((row) => and(row.json.neq({}), row.json.isNotNull()))
            .all(),
        ).toEqual([{ id: 2 }]);
        expect(
          await db.public.TestModel.select('id')
            .where((row) => row.json.isNotNull())
            .all(),
        ).toEqual([{ id: 1 }, { id: 2 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'no_shorthands',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const attempts = [
          () => db.public.TestModel.where({ json: {} }),
          () => db.public.TestModel.where({ json: null }),
        ];
        const rejected = attempts.map((attempt) => {
          try {
            attempt();
            return false;
          } catch {
            return true;
          }
        });
        expect(rejected).toEqual([true, true]);
      }),
    timeouts.spinUpPpgDev,
  );
});
