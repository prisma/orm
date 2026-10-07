import { expect } from 'vitest';
import type { PortContext } from '../../../../../../_harness/postgres';
import type { Contract } from '../_fixture/one_to_one_optional__parent_id_simple__child_id_simple__child_references_parent_id/generated/contract';

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

export async function rejectsDeleteMany(db: Db, parentKey: SharedParentKey) {
  const parent = await createParentReturningKey(db, parentKey, { p: 'p1', p_1: 'p', p_2: '1' });

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
}
