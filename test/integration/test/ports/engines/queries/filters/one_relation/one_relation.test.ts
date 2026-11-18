import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract as Contract21356 } from './_fixture/21356/generated/contract';
import contract21356Json from './_fixture/21356/generated/contract.json' with { type: 'json' };
import type { Contract as Contract21366 } from './_fixture/21366/generated/contract';
import contract21366Json from './_fixture/21366/generated/contract.json' with { type: 'json' };

describe('ports/engines/queries/filters/one_relation', () => {
  it(
    'repro_21356',
    () =>
      withPostgresPort<Contract21356>({ contractJson: contract21356Json }, async ({ db }) => {
        await db.public.User.create({ id: 1, name: 'Bob', userId: 1, userId2: 1 });
        await db.public.Post.create({ id: 1, title: 'Hello', userId: 1, userId_2: 1 });
        const result = await db.public.User.where((u) =>
          u.posts.some((p) => p.author.some((author) => author.name.eq('Bob'))),
        )
          .select('id')
          .all();
        expect(result).toEqual([{ id: 1 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'repro_21366',
    () =>
      withPostgresPort<Contract21366>({ contractJson: contract21366Json }, async ({ db }) => {
        await db.public.device_state.create({ id: 1, device_id: '1' });
        await db.public.device.create({ id: 1, device_id: '1' });
        const result = await db.public.device_state
          .where((state) => state.device.some((device) => device.device_id.eq('1')))
          .select('id')
          .all();
        expect(result).toEqual([{ id: 1 }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
