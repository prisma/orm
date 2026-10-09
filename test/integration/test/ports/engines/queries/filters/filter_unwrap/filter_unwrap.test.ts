import { describe, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

describe('ports/engines/queries/filters/filter_unwrap', () => {
  it(
    'nested deleteMany with an in filter on the child rows succeeds (many_filter)',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await db.public.Item.select('name')
          .include('subItems', (subItems) => subItems.select('name'))
          .create({
            name: 'Top',
            subItems: (subItems) => subItems.create([{ name: 'TEST1' }, { name: 'TEST2' }]),
          });

        await db.public.Item.where({ name: 'Top' })
          .select('name')
          .include('subItems', (subItems) => subItems.select('name'))
          .update({
            subItems: (subItems) =>
              subItems.where((subItem) => subItem.name.in(['TEST1', 'TEST2'])).deleteAll(),
          });
      }),
    timeouts.spinUpPpgDev,
  );
});
