import { expect } from 'vitest';
import type { PortContext } from '../../../../../../_harness/postgres';
import type { Contract } from '../_fixture/one_to_one_optional__parent_id_compound__child_id_compound__child_references_parent_compound_id/generated/contract';

type Db = PortContext<Contract>['db'];
type ParentData = Parameters<Db['public']['Parent']['create']>[0];

function createParentReturningKey(db: Db, data: ParentData) {
  return db.public.Parent.select('id_1', 'id_2').create(data);
}

export async function rejectsDeleteMany(db: Db) {
  const parent = await createParentReturningKey(db, { p: 'p1', p_1: 'p', p_2: '1' });

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
