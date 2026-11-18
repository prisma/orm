import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

describe('ports/engines/queries/filters/filter_unwrap', () => {
  it(
    'a nested deleteMany with an in filter on the child rows succeeds (many_filter)',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await db.public.Item.create({
          name: 'Top',
          subItems: (subItems) => subItems.create([{ name: 'TEST1' }, { name: 'TEST2' }]),
        });

        const updated = await db.public.Item.where({ name: 'Top' })
          .select('name')
          .include('subItems', (subItems) => subItems.select('name'))
          .update({
            subItems: (subItems) =>
              subItems.where((subItem) => subItem.name.in(['TEST1', 'TEST2'])).deleteAll(),
          });

        expect(updated).toEqual({ name: 'Top', subItems: [] });
      }),
    timeouts.spinUpPpgDev,
  );
});
