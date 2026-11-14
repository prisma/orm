import { describe, expect, it } from 'vitest';
import { type PortContext, timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import manyToManyJson from '../_fixture/many_to_many/generated/contract.json' with { type: 'json' };
import type { Contract as OneToOneContract } from '../_fixture/one_to_one_optional/generated/contract';
import oneToOneJson from '../_fixture/one_to_one_optional/generated/contract.json' with {
  type: 'json',
};
import type { Contract } from '../_fixture/parent_to_many_child_to_one_required/generated/contract';
import requiredChildJson from '../_fixture/parent_to_many_child_to_one_required/generated/contract.json' with {
  type: 'json',
};

type Db = PortContext<Contract>['db'];
type ChildrenUpdate = NonNullable<Parameters<Db['public']['Parent']['update']>[0]['childrenOpt']>;

async function updateFirstParent(db: Db, childrenOpt: ChildrenUpdate) {
  const parent = await db.public.Parent.select('id').create({
    p: 'p1',
    p_1: 'p',
    p_2: '1',
    childrenOpt: (children) =>
      children.create([
        { c: 'c1', c_1: 'dear', c_2: 'god' },
        { c: 'c2', c_1: 'why', c_2: 'me' },
      ]),
  });
  await db.public.Parent.create({
    p: 'p2',
    p_1: 'p',
    p_2: '2',
    childrenOpt: (children) =>
      children.create([
        { c: 'c3', c_1: 'buu', c_2: 'huu' },
        { c: 'c4', c_1: 'meow', c_2: 'miau' },
      ]),
  });

  await db.public.Parent.where(parent).update({ childrenOpt });

  return db.public.Parent.select('p')
    .include('childrenOpt', (children) => children.select('c').orderBy((child) => child.c.asc()))
    .orderBy((row) => row.p.asc())
    .all();
}

const secondParent = { p: 'p2', childrenOpt: [{ c: 'c3' }, { c: 'c4' }] };

describe('ports/engines/writes/nested_mutations/already_converted/nested_delete_many_inside_update', () => {
  it(
    'a nested deleteMany on a 1-1 relation is rejected (o2n_rel_fail)',
    () =>
      withPostgresPort<OneToOneContract>({ contractJson: oneToOneJson }, async ({ db }) => {
        const parent = await db.public.Parent.select('id').create({ p: 'p1', p_1: 'p', p_2: '1' });

        await expect(
          db.public.Parent.where(parent).update({
            p: 'p2',
            // @ts-expect-error
            childOpt: (child) => child.where({ c: 'c' }).deleteAll(),
          }),
        ).rejects.toMatchObject({
          code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
          meta: { kind: 'deleteAll', relation: 'childOpt', reason: 'to-one-relation' },
        });
        expect(await db.public.Parent.select('p').all()).toEqual([{ p: 'p1' }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it.each([
    ['PM to C1! (pm_c1_req)', requiredChildJson],
    ['PM to CM (pm_cm_should_work)', manyToManyJson],
  ])(
    'a nested deleteMany with a filter deletes the matching children of the parent, %s',
    (_, contractJson) =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        expect(
          await updateFirstParent(db, (children) =>
            children.where((child) => child.c.like('%c%')).deleteAll(),
          ),
        ).toEqual([{ p: 'p1', childrenOpt: [] }, secondParent]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'several nested deleteManys apply in one update (pm_c1_req_many_delete_manys)',
    () =>
      withPostgresPort<Contract>({ contractJson: requiredChildJson }, async ({ db }) => {
        expect(
          await updateFirstParent(db, (children) => [
            children.where((child) => child.c.like('%1%')).deleteAll(),
            children.where((child) => child.c.like('%2%')).deleteAll(),
          ]),
        ).toEqual([{ p: 'p1', childrenOpt: [] }, secondParent]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested deleteMany with an empty filter deletes every child of the parent (pm_c1_req_work_empty_filter)',
    () =>
      withPostgresPort<Contract>({ contractJson: requiredChildJson }, async ({ db }) => {
        expect(await updateFirstParent(db, (children) => [children.deleteAll()])).toEqual([
          { p: 'p1', childrenOpt: [] },
          secondParent,
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'nested deleteManys whose filters hit no child of the parent change nothing (pm_c1_req_no_change_if_no_hit)',
    () =>
      withPostgresPort<Contract>({ contractJson: requiredChildJson }, async ({ db }) => {
        expect(
          await updateFirstParent(db, (children) => [
            children.where((child) => child.c.like('%3%')).deleteAll(),
            children.where((child) => child.c.like('%4%')).deleteAll(),
          ]),
        ).toEqual([{ p: 'p1', childrenOpt: [{ c: 'c1' }, { c: 'c2' }] }, secondParent]);
      }),
    timeouts.spinUpPpgDev,
  );
});
