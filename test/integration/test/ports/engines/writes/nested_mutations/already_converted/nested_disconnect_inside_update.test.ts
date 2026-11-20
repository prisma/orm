import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from '../_fixture/parent_to_many_child_to_one_required/generated/contract';
import contractJson from '../_fixture/parent_to_many_child_to_one_required/generated/contract.json' with {
  type: 'json',
};

describe('ports/engines/writes/nested_mutations/already_converted/nested_disconnect_inside_update', () => {
  it(
    'a disconnect of a child whose key to the parent is required is refused and changes nothing (p1_c1_req_child_par_inrel_error)',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await db.public.Parent.create({
          p: 'p1',
          p_1: 'p',
          p_2: '1',
          childrenOpt: (children) => children.create([{ c: 'c1', c_1: 'c', c_2: '1' }]),
        });

        await expect(
          db.public.Parent.where({ p: 'p1' }).update({
            p: 'p2',
            // @ts-expect-error
            childrenOpt: (children) => children.disconnect(),
          }),
        ).rejects.toMatchObject({
          code: 'ORM.OPERATION_UNSUPPORTED',
          meta: {
            kind: 'disconnect',
            relation: 'childrenOpt',
            reason: 'required-foreign-key',
            model: 'Child',
            fields: ['parentId'],
          },
        });
        expect(
          await db.public.Parent.select('p')
            .include('childrenOpt', (children) => children.select('c'))
            .all(),
        ).toEqual([{ p: 'p1', childrenOpt: [{ c: 'c1' }] }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
