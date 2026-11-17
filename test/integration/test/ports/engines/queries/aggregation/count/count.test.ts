import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

describe('ports/engines/queries/aggregation/count', () => {
  it(
    'returns zero count with no records',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const result = await db.public.TestModel.aggregate((aggregate) => ({
          count: aggregate.count(),
        }));

        expect(result).toEqual({ count: 0 });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'counts non-null values in nullable fields',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ client }) => {
        await client.orm.public.TestModel.createAll([
          { id: 1, string: 'test1' },
          { id: 2, int: 1 },
        ]);

        const result = await client
          .runtime()
          .query(
            client.sql.public.testModel
              .select('_all', (_fields, functions) => functions.count())
              .select('string', (fields, functions) => functions.count(fields.testModel.string))
              .select('int', (fields, functions) => functions.count(fields.testModel.int))
              .build(),
          )
          .toArray();

        expect(result).toEqual([{ _all: 2, string: 1, int: 1 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'preserves requested field order for empty counts',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ client }) => {
        const allStringInt = await client
          .runtime()
          .query(
            client.sql.public.testModel
              .select('_all', (_fields, functions) => functions.count())
              .select('string', (fields, functions) => functions.count(fields.testModel.string))
              .select('int', (fields, functions) => functions.count(fields.testModel.int))
              .build(),
          )
          .toArray();
        const stringAllInt = await client
          .runtime()
          .query(
            client.sql.public.testModel
              .select('string', (fields, functions) => functions.count(fields.testModel.string))
              .select('_all', (_fields, functions) => functions.count())
              .select('int', (fields, functions) => functions.count(fields.testModel.int))
              .build(),
          )
          .toArray();

        expect(allStringInt).toEqual([{ _all: 0, string: 0, int: 0 }]);
        expect(Object.keys(allStringInt[0]!)).toEqual(['_all', 'string', 'int']);
        expect(stringAllInt).toEqual([{ string: 0, _all: 0, int: 0 }]);
        expect(Object.keys(stringAllInt[0]!)).toEqual(['string', '_all', 'int']);
      }),
    timeouts.spinUpPpgDev,
  );
});
