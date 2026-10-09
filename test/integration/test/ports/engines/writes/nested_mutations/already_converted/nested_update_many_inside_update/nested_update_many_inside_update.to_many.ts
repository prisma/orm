import { expect } from 'vitest';
import type { PortContext } from '../../../../../../_harness/postgres';
import type { Contract } from '../_fixture/parent_to_many_child_to_one_required__parent_id_simple__child_id_simple__child_references_parent_id/generated/contract';

export type SharedParentKey = 'p' | 'p_1_p_2' | 'id';

type Db = PortContext<Contract>['db'];
type ParentData = Parameters<Db['public']['Parent']['create']>[0];

function createParentReturningKey(db: Db, parentKey: SharedParentKey, data: ParentData) {
  switch (parentKey) {
    case 'p':
      return db.public.Parent.select('p').create(data);
    case 'p_1_p_2':
      return db.public.Parent.select('p_1', 'p_2').create(data);
    case 'id':
      return db.public.Parent.select('id').create(data);
  }
}

async function setupData(db: Db, parentKey: SharedParentKey) {
  const firstParent = await createParentReturningKey(db, parentKey, {
    p: 'p1',
    p_1: 'p',
    p_2: '1',
    childrenOpt: (children) =>
      children.create([
        { c: 'c1', c_1: 'foo', c_2: 'bar' },
        { c: 'c2', c_1: 'fo', c_2: 'lo' },
      ]),
  });
  await createParentReturningKey(db, parentKey, {
    p: 'p2',
    p_1: 'p',
    p_2: '2',
    childrenOpt: (children) =>
      children.create([
        { c: 'c3', c_1: 'ao', c_2: 'bo' },
        { c: 'c4', c_1: 'go', c_2: 'zo' },
      ]),
  });
  return firstParent;
}

function findManyParent(db: Db) {
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

export async function updatesMatchingChildren(db: Db, parentKey: SharedParentKey) {
  const parent = await setupData(db, parentKey);

  await db.public.Parent.where(parent).update({
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

export async function severalUpdateManys(db: Db, parentKey: SharedParentKey) {
  const parent = await setupData(db, parentKey);

  await db.public.Parent.where(parent).update({
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

export async function emptyFilter(db: Db, parentKey: SharedParentKey) {
  const parent = await setupData(db, parentKey);

  await db.public.Parent.where(parent).update({
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

export async function noHit(db: Db, parentKey: SharedParentKey) {
  const parent = await setupData(db, parentKey);

  await db.public.Parent.where(parent).update({
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

export async function overlappingFilters(db: Db, parentKey: SharedParentKey) {
  const parent = await setupData(db, parentKey);

  await db.public.Parent.where(parent).update({
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
