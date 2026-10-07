import { expect } from 'vitest';
import type { PortContext } from '../../../../../../_harness/postgres';
import type { Contract } from './_fixture/parent_to_many_child_to_one_required__parent_id_simple__child_id_simple__child_references_parent_id/generated/contract';

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
        { c: 'c1', c_1: 'dear', c_2: 'god' },
        { c: 'c2', c_1: 'why', c_2: 'me' },
      ]),
  });
  await createParentReturningKey(db, parentKey, {
    p: 'p2',
    p_1: 'p',
    p_2: '2',
    childrenOpt: (children) =>
      children.create([
        { c: 'c3', c_1: 'buu', c_2: 'huu' },
        { c: 'c4', c_1: 'meow', c_2: 'miau' },
      ]),
  });
  return firstParent;
}

function findManyParent(db: Db) {
  return db.public.Parent.select('p')
    .include('childrenOpt', (children) => children.select('c').orderBy((child) => child.c.asc()))
    .orderBy((parent) => parent.p.asc())
    .all();
}

const untouchedSecondParent = { p: 'p2', childrenOpt: [{ c: 'c3' }, { c: 'c4' }] };

export async function deletesMatchingChildren(db: Db, parentKey: SharedParentKey) {
  const parent = await setupData(db, parentKey);

  await db.public.Parent.where(parent).update({
    childrenOpt: (children) => children.where((child) => child.c.like('%c%')).deleteAll(),
  });

  expect(await findManyParent(db)).toEqual([{ p: 'p1', childrenOpt: [] }, untouchedSecondParent]);
}

export async function severalDeleteManys(db: Db, parentKey: SharedParentKey) {
  const parent = await setupData(db, parentKey);

  await db.public.Parent.where(parent).update({
    childrenOpt: (children) => [
      children.where((child) => child.c.like('%1%')).deleteAll(),
      children.where((child) => child.c.like('%2%')).deleteAll(),
    ],
  });

  expect(await findManyParent(db)).toEqual([{ p: 'p1', childrenOpt: [] }, untouchedSecondParent]);
}

export async function emptyFilter(db: Db, parentKey: SharedParentKey) {
  const parent = await setupData(db, parentKey);

  await db.public.Parent.where(parent).update({
    childrenOpt: (children) => [children.deleteAll()],
  });

  expect(await findManyParent(db)).toEqual([{ p: 'p1', childrenOpt: [] }, untouchedSecondParent]);
}

export async function noHit(db: Db, parentKey: SharedParentKey) {
  const parent = await setupData(db, parentKey);

  await db.public.Parent.where(parent).update({
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
