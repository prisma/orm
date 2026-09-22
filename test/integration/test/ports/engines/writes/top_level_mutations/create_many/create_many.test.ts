import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

describe('ports/engines/writes/top_level_mutations/create_many', () => {
  it(
    'skipping duplicates dedupes the batch and counts one row',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ client }) => {
        const count = await client.orm.public.Test.createAndCount(
          [
            { id: 1, str1: '1' },
            { id: 1, str1: '2' },
          ],
          { onConflict: 'skip' },
        );

        expect(count).toBe(1);

        const rows = await client.orm.public.Test.select('id', 'str1').all();
        expect(rows).toEqual([{ id: 1, str1: '1' }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'duplicate ids error when duplicates are not skipped',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ client }) => {
        await expect(
          client.orm.public.Test.createAndCount([
            { id: 1, str1: '1' },
            { id: 1, str1: '2' },
          ]),
        ).rejects.toThrow(/Test_pkey/);
      }),
    timeouts.spinUpPpgDev,
  );
});
