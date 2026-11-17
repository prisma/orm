import { describe, expect, it } from 'vitest';
import { type PortContext, timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import manyToManyJson from '../_fixture/many_to_many/generated/contract.json' with { type: 'json' };
import type { Contract as OneToOneContract } from '../_fixture/one_to_one_optional/generated/contract';
import oneToOneJson from '../_fixture/one_to_one_optional/generated/contract.json' with {
  type: 'json',
};
import optionalChildJson from '../_fixture/parent_to_many_child_to_one_optional/generated/contract.json' with {
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
        { c: 'c1', c_1: 'foo', c_2: 'bar' },
        { c: 'c2', c_1: 'fo', c_2: 'lo' },
      ]),
  });
  await db.public.Parent.create({
    p: 'p2',
    p_1: 'p',
    p_2: '2',
    childrenOpt: (children) =>
      children.create([
        { c: 'c3', c_1: 'ao', c_2: 'bo' },
        { c: 'c4', c_1: 'go', c_2: 'zo' },
      ]),
  });

  await db.public.Parent.where(parent).update({ childrenOpt });

  return db.public.Parent.select('p')
    .include('childrenOpt', (children) =>
      children.select('c', 'non_unique').orderBy((child) => child.c.asc()),
    )
    .orderBy((row) => row.p.asc())
    .all();
}

function parentsWithFirstChildren(first: string | null, second: string | null) {
  return [
    {
      p: 'p1',
      childrenOpt: [
        { c: 'c1', non_unique: first },
        { c: 'c2', non_unique: second },
      ],
    },
    {
      p: 'p2',
      childrenOpt: [
        { c: 'c3', non_unique: null },
        { c: 'c4', non_unique: null },
      ],
    },
  ];
}

describe('ports/engines/writes/nested_mutations/already_converted/nested_update_many_inside_update', () => {
  it(
    'a nested updateMany on a 1-1 relation is rejected (one2n_rel_error_nested_um)',
    () =>
      withPostgresPort<OneToOneContract>({ contractJson: oneToOneJson }, async ({ db }) => {
        const parent = await db.public.Parent.select('id').create({ p: 'p1', p_1: 'p', p_2: '1' });

        await expect(
          db.public.Parent.where(parent).update({
            p: 'p2',
            // @ts-expect-error
            childOpt: (child) => child.where({ c: 'c' }).updateAll({ c: 'newC' }),
          }),
        ).rejects.toMatchObject({
          code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
          meta: { kind: 'updateAll', relation: 'childOpt', reason: 'to-one-relation' },
        });
        expect(await db.public.Parent.select('p').all()).toEqual([{ p: 'p1' }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it.each([
    ['PM to C1! (pm_c1_req_should_work)', requiredChildJson],
    ['PM to C1 (pm_c1_should_work)', optionalChildJson],
    ['PM to CM (pm_cm_should_work)', manyToManyJson],
  ])(
    'a nested updateMany with a filter updates the matching children of the parent, %s',
    (_, contractJson) =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        expect(
          await updateFirstParent(db, (children) =>
            children.where((child) => child.c.like('%c%')).updateAll({ non_unique: 'updated' }),
          ),
        ).toEqual(parentsWithFirstChildren('updated', 'updated'));
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'several nested updateManys apply in one update (pm_c1_req_many_ums)',
    () =>
      withPostgresPort<Contract>({ contractJson: requiredChildJson }, async ({ db }) => {
        expect(
          await updateFirstParent(db, (children) => [
            children.where((child) => child.c.like('%1%')).updateAll({ non_unique: 'updated1' }),
            children.where((child) => child.c.like('%2%')).updateAll({ non_unique: 'updated2' }),
          ]),
        ).toEqual(parentsWithFirstChildren('updated1', 'updated2'));
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested updateMany with an empty filter updates every child of the parent (pm_c1_req_empty_filter)',
    () =>
      withPostgresPort<Contract>({ contractJson: requiredChildJson }, async ({ db }) => {
        expect(
          await updateFirstParent(db, (children) => [
            children.updateAll({ non_unique: 'updated1' }),
          ]),
        ).toEqual(parentsWithFirstChildren('updated1', 'updated1'));
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'nested updateManys whose filters hit no child of the parent change nothing (pm_c1_req_noop_no_hit)',
    () =>
      withPostgresPort<Contract>({ contractJson: requiredChildJson }, async ({ db }) => {
        expect(
          await updateFirstParent(db, (children) => [
            children.where((child) => child.c.like('%3%')).updateAll({ non_unique: 'updated3' }),
            children.where((child) => child.c.like('%4%')).updateAll({ non_unique: 'updated4' }),
          ]),
        ).toEqual(parentsWithFirstChildren(null, null));
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'nested updateManys with overlapping filters apply in order, the last write winning (pm_c1_req_many_filters)',
    () =>
      withPostgresPort<Contract>({ contractJson: requiredChildJson }, async ({ db }) => {
        expect(
          await updateFirstParent(db, (children) => [
            children.where((child) => child.c.like('%c%')).updateAll({ non_unique: 'updated1' }),
            children.where((child) => child.c.like('%c1%')).updateAll({ non_unique: 'updated2' }),
          ]),
        ).toEqual(parentsWithFirstChildren('updated2', 'updated1'));
      }),
    timeouts.spinUpPpgDev,
  );
});
