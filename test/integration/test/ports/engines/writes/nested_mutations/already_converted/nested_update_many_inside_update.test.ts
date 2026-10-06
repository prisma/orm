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
import optionalCompoundParentIdJson from './_fixture/pm_c1_compound_parent_id/generated/contract.json' with {
  type: 'json',
};
import optionalCompoundParentUniqueJson from './_fixture/pm_c1_compound_parent_unique/generated/contract.json' with {
  type: 'json',
};
import optionalParentIdJson from './_fixture/pm_c1_parent_id/generated/contract.json' with {
  type: 'json',
};
import optionalParentUniqueJson from './_fixture/pm_c1_parent_unique/generated/contract.json' with {
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

const optionalParentVariants: ReadonlyArray<readonly [string, unknown]> = [
  ['the child references the parent id', optionalParentIdJson],
  ['the child references a compound parent id', optionalCompoundParentIdJson],
  ['the child references a unique parent field', optionalParentUniqueJson],
  ['the child references a compound unique of the parent', optionalCompoundParentUniqueJson],
];

async function setupData(db: PortDb) {
  await db.public.Parent.create({
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
}

function findManyParent(db: PortDb) {
  return db.public.Parent.select('p')
    .include('childrenOpt', (children) =>
      children.select('c', 'non_unique').orderBy((child) => child.c.asc()),
    )
    .orderBy((parent) => parent.p.asc())
    .all();
}

const untouchedSecondParent = {
  p: 'p2',
  childrenOpt: [
    { c: 'c3', non_unique: null },
    { c: 'c4', non_unique: null },
  ],
};

async function updateManyWorks(db: PortDb) {
  await setupData(db);

  await db.public.Parent.where({ p: 'p1' }).update({
    childrenOpt: (children) =>
      children.where((child) => child.c.like('%c%')).updateAll({ non_unique: 'updated' }),
  });

  expect(await findManyParent(db)).toEqual([
    {
      p: 'p1',
      childrenOpt: [
        { c: 'c1', non_unique: 'updated' },
        { c: 'c2', non_unique: 'updated' },
      ],
    },
    untouchedSecondParent,
  ]);
}

async function severalUpdateManys(db: PortDb) {
  await setupData(db);

  await db.public.Parent.where({ p: 'p1' }).update({
    childrenOpt: (children) => [
      children.where((child) => child.c.like('%1%')).updateAll({ non_unique: 'updated1' }),
      children.where((child) => child.c.like('%2%')).updateAll({ non_unique: 'updated2' }),
    ],
  });

  expect(await findManyParent(db)).toEqual([
    {
      p: 'p1',
      childrenOpt: [
        { c: 'c1', non_unique: 'updated1' },
        { c: 'c2', non_unique: 'updated2' },
      ],
    },
    untouchedSecondParent,
  ]);
}

async function emptyFilter(db: PortDb) {
  await setupData(db);

  await db.public.Parent.where({ p: 'p1' }).update({
    childrenOpt: (children) => [children.updateAll({ non_unique: 'updated1' })],
  });

  expect(await findManyParent(db)).toEqual([
    {
      p: 'p1',
      childrenOpt: [
        { c: 'c1', non_unique: 'updated1' },
        { c: 'c2', non_unique: 'updated1' },
      ],
    },
    untouchedSecondParent,
  ]);
}

async function noHit(db: PortDb) {
  await setupData(db);

  await db.public.Parent.where({ p: 'p1' }).update({
    childrenOpt: (children) => [
      children.where((child) => child.c.like('%3%')).updateAll({ non_unique: 'updated3' }),
      children.where((child) => child.c.like('%4%')).updateAll({ non_unique: 'updated4' }),
    ],
  });

  expect(await findManyParent(db)).toEqual([
    {
      p: 'p1',
      childrenOpt: [
        { c: 'c1', non_unique: null },
        { c: 'c2', non_unique: null },
      ],
    },
    untouchedSecondParent,
  ]);
}

async function overlappingFilters(db: PortDb) {
  await setupData(db);

  await db.public.Parent.where({ p: 'p1' }).update({
    childrenOpt: (children) => [
      children.where((child) => child.c.like('%c%')).updateAll({ non_unique: 'updated1' }),
      children.where((child) => child.c.like('%c1%')).updateAll({ non_unique: 'updated2' }),
    ],
  });

  expect(await findManyParent(db)).toEqual([
    {
      p: 'p1',
      childrenOpt: [
        { c: 'c1', non_unique: 'updated2' },
        { c: 'c2', non_unique: 'updated1' },
      ],
    },
    untouchedSecondParent,
  ]);
}

describe('ports/engines/writes/nested_mutations/already_converted/nested_update_many_inside_update', () => {
  describe.each(requiredParentVariants)('PM to C1!, %s', (_variant, contractJson) => {
    it(
      'pm_c1_req_should_work',
      () => withVariant(contractJson, updateManyWorks),
      timeouts.spinUpPpgDev,
    );
    it(
      'pm_c1_req_many_ums',
      () => withVariant(contractJson, severalUpdateManys),
      timeouts.spinUpPpgDev,
    );
    it(
      'pm_c1_req_empty_filter',
      () => withVariant(contractJson, emptyFilter),
      timeouts.spinUpPpgDev,
    );
    it('pm_c1_req_noop_no_hit', () => withVariant(contractJson, noHit), timeouts.spinUpPpgDev);
    it(
      'pm_c1_req_many_filters',
      () => withVariant(contractJson, overlappingFilters),
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(optionalParentVariants)('PM to C1, %s', (_variant, contractJson) => {
    it(
      'pm_c1_should_work',
      () => withVariant(contractJson, updateManyWorks),
      timeouts.spinUpPpgDev,
    );
  });

  describe('PM to CM', () => {
    it(
      'pm_cm_should_work',
      () => withVariant(manyToManyJson, updateManyWorks),
      timeouts.spinUpPpgDev,
    );
  });

  describe('P1 to C1', () => {
    it(
      'one2n_rel_error_nested_um, the child holds the key',
      () =>
        withPostgresPort<ChildLinkContract>({ contractJson: childLinkJson }, async ({ db }) => {
          await db.public.Parent.create({ p: 'p1', p_1: 'p', p_2: '1' });

          await expect(
            db.public.Parent.where({ p: 'p1' }).update({
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

    it(
      'one2n_rel_error_nested_um, the parent holds the key',
      () =>
        withPostgresPort<ParentLinkContract>({ contractJson: parentLinkJson }, async ({ db }) => {
          await db.public.Parent.create({ p: 'p1', p_1: 'p', p_2: '1' });

          await expect(
            db.public.Parent.where({ p: 'p1' }).update({
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
  });
});
