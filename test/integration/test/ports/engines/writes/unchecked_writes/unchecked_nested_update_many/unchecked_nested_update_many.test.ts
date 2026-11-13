import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

describe('ports/engines/writes/unchecked_writes/unchecked_nested_update_many', () => {
  it(
    'a nested updateMany that sets the foreign key to the parent is rejected (disallow_write_parent_inline_rel_sclrs)',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await expect(
          db.public.ModelB.where({ id: 1 })
            .select('id')
            .update({
              // @ts-expect-error
              a: (a) => a.where({ id: 1 }).updateAll({ b_id: 123 }),
            }),
        ).rejects.toMatchObject({
          code: 'ORM.RELATION_MUTATION_INVALID',
          meta: {
            kind: 'updateAll',
            relation: 'a',
            problem: 'parent-link-column',
            fields: ['b_id'],
          },
        });
      }),
    timeouts.spinUpPpgDev,
  );
});
