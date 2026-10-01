import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

describe('ports/engines/writes/top_level_mutations/create_many_and_return', () => {
  it(
    'skipping duplicates returns the single row the database inserted',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ client }) => {
        const rows = await client.orm.public.Test.select('id', 'str1').createAll(
          [
            { id: 1, str1: '1' },
            { id: 1, str1: '2' },
          ],
          { onConflict: 'skip' },
        );

        expect(rows).toEqual([{ id: 1, str1: '1' }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'duplicate ids error when duplicates are not skipped',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ client }) => {
        await expect(
          client.orm.public.Test.createAll([
            { id: 1, str1: '1' },
            { id: 1, str1: '2' },
          ]),
        ).rejects.toThrow(/Test_pkey/);
      }),
    timeouts.spinUpPpgDev,
  );
});
