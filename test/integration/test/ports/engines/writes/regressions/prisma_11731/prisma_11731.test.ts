import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

describe('ports/engines/writes/regressions/prisma_11731', () => {
  it(
    'connectOrCreate on a 1:1 relation from the side without the key does not create a second row (one2one_inlined_child)',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await db.public.Item.create({ id: 1, uniq: 'item 1' });
        await db.public.MyModel.create({
          id: 1,
          name: 'MyModel 1',
          item: (item) => item.connect({ id: 1 }),
        });

        const updated = await db.public.Item.select('id', 'uniq')
          .include('myModel', (myModel) => myModel.select('id', 'name'))
          .where({ id: 1 })
          .update({
            myModel: (myModel) =>
              myModel.create(
                { id: 2, name: 'MyModel 2' },
                { onConflict: 'connect', conflictOn: ['itemId'] },
              ),
          });
        expect(updated).toEqual({ id: 1, uniq: 'item 1', myModel: { id: 1, name: 'MyModel 1' } });

        const myModels = await db.public.MyModel.select('id')
          .include('item', (item) => item.select('id'))
          .all();
        expect(myModels).toEqual([{ id: 1, item: { id: 1 } }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'connectOrCreate on a 1:1 relation from the side with the key does not create a second row (one2one_inlined_parent)',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await db.public.Item.create({ id: 1, uniq: 'item 1' });
        await db.public.MyModel.create({
          id: 1,
          name: 'MyModel 1',
          item: (item) => item.connect({ id: 1 }),
        });

        const updated = await db.public.MyModel.select('id', 'name')
          .include('item', (item) => item.select('id', 'uniq'))
          .where({ id: 1 })
          .update({
            item: (item) =>
              item.create(
                { id: 2, uniq: 'item 1' },
                { onConflict: 'connect', conflictOn: ['uniq'] },
              ),
          });
        expect(updated).toEqual({ id: 1, name: 'MyModel 1', item: { id: 1, uniq: 'item 1' } });

        const items = await db.public.Item.select('id')
          .include('myModel', (myModel) => myModel.select('id'))
          .all();
        expect(items).toEqual([{ id: 1, myModel: { id: 1 } }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
