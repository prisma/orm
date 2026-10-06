import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract as ChildLinkContract } from './_fixture/p1_c1_child_link/generated/contract';
import childLinkJson from './_fixture/p1_c1_child_link/generated/contract.json' with {
  type: 'json',
};
import type { Contract as ParentLinkContract } from './_fixture/p1_c1_parent_link/generated/contract';
import parentLinkJson from './_fixture/p1_c1_parent_link/generated/contract.json' with {
  type: 'json',
};
import requiredCompoundParentIdJson from './_fixture/pm_c1_req_compound_parent_id/generated/contract.json' with {
  type: 'json',
};
import requiredCompoundParentUniqueJson from './_fixture/pm_c1_req_compound_parent_unique/generated/contract.json' with {
  type: 'json',
};
import requiredNoIdJson from './_fixture/pm_c1_req_no_id/generated/contract.json' with {
  type: 'json',
};
import type { Contract } from './_fixture/pm_c1_req_parent_id/generated/contract';
import requiredParentIdJson from './_fixture/pm_c1_req_parent_id/generated/contract.json' with {
  type: 'json',
};
import requiredParentUniqueJson from './_fixture/pm_c1_req_parent_unique/generated/contract.json' with {
  type: 'json',
};
import manyToManyJson from './_fixture/pm_cm/generated/contract.json' with { type: 'json' };

type PortDb = Parameters<Parameters<typeof withPostgresPort<Contract>>[1]>[0]['db'];

function withVariant(contractJson: unknown, fn: (db: PortDb) => Promise<void>) {
  return withPostgresPort<Contract>({ contractJson }, ({ db }) => fn(db));
}

const requiredParentVariants: ReadonlyArray<readonly [string, unknown]> = [
  ['the child references the parent id', requiredParentIdJson],
  ['the child references a compound parent id', requiredCompoundParentIdJson],
  ['the child references a unique parent field', requiredParentUniqueJson],
  ['the child references a compound unique of the parent', requiredCompoundParentUniqueJson],
  ['neither model has an id', requiredNoIdJson],
];

async function setupData(db: PortDb) {
  await db.public.Parent.create({
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
}

function findManyParent(db: PortDb) {
  return db.public.Parent.select('p')
    .include('childrenOpt', (children) => children.select('c').orderBy((child) => child.c.asc()))
    .orderBy((parent) => parent.p.asc())
    .all();
}

const untouchedSecondParent = { p: 'p2', childrenOpt: [{ c: 'c3' }, { c: 'c4' }] };

async function deleteManyWorks(db: PortDb) {
  await setupData(db);

  await db.public.Parent.where({ p: 'p1' }).update({
    childrenOpt: (children) => children.where((child) => child.c.like('%c%')).deleteAll(),
  });

  expect(await findManyParent(db)).toEqual([{ p: 'p1', childrenOpt: [] }, untouchedSecondParent]);
}

async function severalDeleteManys(db: PortDb) {
  await setupData(db);

  await db.public.Parent.where({ p: 'p1' }).update({
    childrenOpt: (children) => [
      children.where((child) => child.c.like('%1%')).deleteAll(),
      children.where((child) => child.c.like('%2%')).deleteAll(),
    ],
  });

  expect(await findManyParent(db)).toEqual([{ p: 'p1', childrenOpt: [] }, untouchedSecondParent]);
}

async function emptyFilter(db: PortDb) {
  await setupData(db);

  await db.public.Parent.where({ p: 'p1' }).update({
    childrenOpt: (children) => [children.deleteAll()],
  });

  expect(await findManyParent(db)).toEqual([{ p: 'p1', childrenOpt: [] }, untouchedSecondParent]);
}

async function noHit(db: PortDb) {
  await setupData(db);

  await db.public.Parent.where({ p: 'p1' }).update({
    childrenOpt: (children) => [
      children.where((child) => child.c.like('%3%')).deleteAll(),
      children.where((child) => child.c.like('%4%')).deleteAll(),
    ],
  });

  expect(await findManyParent(db)).toEqual([
    { p: 'p1', childrenOpt: [{ c: 'c1' }, { c: 'c2' }] },
    untouchedSecondParent,
  ]);
}

describe('ports/engines/writes/nested_mutations/already_converted/nested_delete_many_inside_update', () => {
  describe.each(requiredParentVariants)('PM to C1!, %s', (_variant, contractJson) => {
    it('pm_c1_req', () => withVariant(contractJson, deleteManyWorks), timeouts.spinUpPpgDev);
    it(
      'pm_c1_req_many_delete_manys',
      () => withVariant(contractJson, severalDeleteManys),
      timeouts.spinUpPpgDev,
    );
    it(
      'pm_c1_req_work_empty_filter',
      () => withVariant(contractJson, emptyFilter),
      timeouts.spinUpPpgDev,
    );
    it(
      'pm_c1_req_no_change_if_no_hit',
      () => withVariant(contractJson, noHit),
      timeouts.spinUpPpgDev,
    );
  });

  describe('PM to CM', () => {
    it(
      'pm_cm_should_work',
      () => withVariant(manyToManyJson, deleteManyWorks),
      timeouts.spinUpPpgDev,
    );
  });

  describe('P1 to C1', () => {
    it(
      'o2n_rel_fail, the child holds the key',
      () =>
        withPostgresPort<ChildLinkContract>({ contractJson: childLinkJson }, async ({ db }) => {
          await db.public.Parent.create({ p: 'p1', p_1: 'p', p_2: '1' });

          await expect(
            db.public.Parent.where({ p: 'p1' }).update({
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

    it(
      'o2n_rel_fail, the parent holds the key',
      () =>
        withPostgresPort<ParentLinkContract>({ contractJson: parentLinkJson }, async ({ db }) => {
          await db.public.Parent.create({ p: 'p1', p_1: 'p', p_2: '1' });

          await expect(
            db.public.Parent.where({ p: 'p1' }).update({
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
  });
});
