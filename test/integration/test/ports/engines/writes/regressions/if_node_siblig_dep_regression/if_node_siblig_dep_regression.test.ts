import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

describe('ports/engines/writes/regressions/if_node_siblig_dep_regression', () => {
  it(
    'a create with connects and two connectOrCreates on sibling relations succeeds (test)',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await db.public.RecordConfig.create({ id: 1 });
        await db.public.Container.create({ id: 1 });

        const created = await db.public.Record.select('id').create({
          id: 1,
          container: (container) => container.connect({ id: 1 }),
          config: (config) => config.connect({ id: 1 }),
          location: (location) =>
            location.create(
              { id: 1, location: 'something' },
              { onConflict: 'connect', conflictOn: ['location'] },
            ),
          type: (type) =>
            type.create({ id: 1, type: 'test' }, { onConflict: 'connect', conflictOn: ['type'] }),
        });

        expect(created).toEqual({ id: 1 });
      }),
    timeouts.spinUpPpgDev,
  );
});
