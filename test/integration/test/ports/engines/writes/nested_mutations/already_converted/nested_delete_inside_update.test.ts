import { describe, expect, it } from 'vitest';
import { type PortContext, timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import manyToManyJson from '../_fixture/many_to_many/generated/contract.json' with { type: 'json' };
import type { Contract as OneToOneContract } from '../_fixture/one_to_one_optional/generated/contract';
import oneToOneJson from '../_fixture/one_to_one_optional/generated/contract.json' with {
  type: 'json',
};
import type { Contract as OptionalChildContract } from '../_fixture/parent_to_many_child_to_one_optional/generated/contract';
import optionalChildJson from '../_fixture/parent_to_many_child_to_one_optional/generated/contract.json' with {
  type: 'json',
};
import type { Contract as RequiredChildContract } from '../_fixture/parent_to_many_child_to_one_required/generated/contract';
import requiredChildJson from '../_fixture/parent_to_many_child_to_one_required/generated/contract.json' with {
  type: 'json',
};

type OneToOneDb = PortContext<OneToOneContract>['db'];
type ToManyDb = PortContext<OptionalChildContract>['db'];

function parentsOf(db: OneToOneDb) {
  return db.public.Parent.select('p')
    .include('childOpt', (child) => child.select('c'))
    .orderBy((parent) => parent.p.asc())
    .all();
}

function childrenOf(db: ToManyDb) {
  return db.public.Parent.select('p')
    .include('childrenOpt', (children) => children.select('c').orderBy((child) => child.c.asc()))
    .orderBy((parent) => parent.p.asc())
    .all();
}

function linkedParentsOf(db: ToManyDb) {
  return db.public.Child.select('c')
    .include('parentOpt', (parent) => parent.select('p'))
    .orderBy((child) => child.c.asc())
    .all();
}

function oneToOneChildren(db: OneToOneDb) {
  return db.public.Child.select('c')
    .orderBy((child) => child.c.asc())
    .all();
}

function toManyChildren(db: ToManyDb) {
  return db.public.Child.select('c')
    .orderBy((child) => child.c.asc())
    .all();
}

async function seedOneToOne(db: OneToOneDb, nonUnique: string | null) {
  await db.public.Parent.create({
    p: 'p1',
    p_1: 'p',
    p_2: '1',
    childOpt: (child) =>
      child.create({ c: 'existingChild', c_1: 'c', c_2: '1', non_unique: nonUnique }),
  });
  await db.public.Parent.create({
    p: 'p2',
    p_1: 'p',
    p_2: '2',
    childOpt: (child) => child.create({ c: 'c2', c_1: 'c', c_2: '2', non_unique: nonUnique }),
  });
}

async function seedTwoChildren(db: ToManyDb) {
  await db.public.Parent.create({
    p: 'p1',
    p_1: 'p',
    p_2: '1',
    childrenOpt: (children) =>
      children.create([
        { c: 'c1', c_1: 'c', c_2: '1', non_unique: '0' },
        { c: 'c2', c_1: 'c', c_2: '2', non_unique: '1' },
      ]),
  });
}

async function seedLinkedParents(db: ToManyDb, nonUnique: string | null) {
  await db.public.Parent.create({ p: 'p1', p_1: 'p', p_2: '1', non_unique: nonUnique });
  await db.public.Parent.create({ p: 'p2', p_1: 'p', p_2: '2', non_unique: nonUnique });
  await db.public.Child.create({
    c: 'c1',
    c_1: 'c',
    c_2: '1',
    parentOpt: (parent) => parent.connect({ p: 'p1' }),
  });
}

async function seedManyToMany(db: ToManyDb) {
  await db.public.Parent.create({
    p: 'otherParent',
    p_1: 'p',
    p_2: '1',
    childrenOpt: (children) =>
      children.create([{ c: 'otherChild', c_1: 'c', c_2: '1', non_unique: '0' }]),
  });
  await db.public.Parent.create({
    p: 'p2',
    p_1: 'p',
    p_2: '2',
    childrenOpt: (children) =>
      children.create([
        { c: 'c2', c_1: 'c', c_2: '2', non_unique: '0' },
        { c: 'c3', c_1: 'c', c_2: '3', non_unique: '0' },
        { c: 'c4', c_1: 'c', c_2: '4' },
      ]),
  });
}

const manyToManyAfterDeletingC2 = [
  { p: 'otherParent', childrenOpt: [{ c: 'otherChild' }] },
  { p: 'p2', childrenOpt: [{ c: 'c3' }, { c: 'c4' }] },
];

describe('ports/engines/writes/nested_mutations/already_converted/nested_delete_inside_update', () => {
  it(
    'a nested delete deletes the linked child and leaves the child of another parent, P1 to C1 (p1_c1_mut_by_id, p1_c1_req_by_id_should_work)',
    () =>
      withPostgresPort<OneToOneContract>({ contractJson: oneToOneJson }, async ({ db }) => {
        await seedOneToOne(db, null);

        await db.public.Parent.where({ p: 'p2' }).update({ childOpt: (child) => child.delete() });

        expect(await parentsOf(db)).toEqual([
          { p: 'p1', childOpt: { c: 'existingChild' } },
          { p: 'p2', childOpt: null },
        ]);
        expect(await oneToOneChildren(db)).toEqual([{ c: 'existingChild' }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested delete with a filter deletes the linked child when it matches, P1 to C1 (p1_c1_mut_by_id_and_filters, p1_c1_req_by_filters_should_work)',
    () =>
      withPostgresPort<OneToOneContract>({ contractJson: oneToOneJson }, async ({ db }) => {
        await seedOneToOne(db, '0');

        await db.public.Parent.where({ p: 'p2' }).update({
          childOpt: (child) => child.where({ non_unique: '0' }).delete(),
        });

        expect(await parentsOf(db)).toEqual([
          { p: 'p1', childOpt: { c: 'existingChild' } },
          { p: 'p2', childOpt: null },
        ]);
        expect(await oneToOneChildren(db)).toEqual([{ c: 'existingChild' }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested delete without a linked child changes nothing and raises nothing, P1 to C1 (p1_c1_error_if_not_connected)',
    () =>
      withPostgresPort<OneToOneContract>({ contractJson: oneToOneJson }, async ({ db }) => {
        await db.public.Parent.create({ p: 'p1', p_1: 'p', p_2: '1' });
        await db.public.Child.create({ c: 'c1', c_1: 'c', c_2: '1' });

        await db.public.Parent.where({ p: 'p1' }).update({ childOpt: (child) => child.delete() });

        expect(await parentsOf(db)).toEqual([{ p: 'p1', childOpt: null }]);
        expect(await db.public.Child.select('c').all()).toEqual([{ c: 'c1' }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested delete whose filter does not match the linked child changes nothing and raises nothing, P1 to C1 (p1_c1_error_if_filter_not_match, p1_c1_req_error_if_filter_not_match)',
    () =>
      withPostgresPort<OneToOneContract>({ contractJson: oneToOneJson }, async ({ db }) => {
        await seedOneToOne(db, '0');

        await db.public.Parent.where({ p: 'p1' }).update({
          childOpt: (child) => child.where({ non_unique: '1' }).delete(),
        });

        expect(await parentsOf(db)).toEqual([
          { p: 'p1', childOpt: { c: 'existingChild' } },
          { p: 'p2', childOpt: { c: 'c2' } },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it.each([
    ['PM to C1! (pm_c1_req_by_id_should_work)', requiredChildJson],
    ['PM to C1 (pm_c1_by_id_should_work)', optionalChildJson],
  ])(
    'a nested delete deletes the child the filter names, %s',
    (_, contractJson) =>
      withPostgresPort<OptionalChildContract>({ contractJson }, async ({ db }) => {
        await seedTwoChildren(db);

        await db.public.Parent.where({ p: 'p1' }).update({
          childrenOpt: (children) => children.where({ c: 'c1' }).delete(),
        });

        expect(await childrenOf(db)).toEqual([{ p: 'p1', childrenOpt: [{ c: 'c2' }] }]);
        expect(await toManyChildren(db)).toEqual([{ c: 'c2' }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it.each([
    ['PM to C1! (pm_c1_req_by_id_and_fiters_should_work)', requiredChildJson],
    ['PM to C1 (pm_c1_by_id_and_filter_should_work)', optionalChildJson],
  ])(
    'a nested delete with a unique field and a filter deletes the matching child, %s',
    (_, contractJson) =>
      withPostgresPort<OptionalChildContract>({ contractJson }, async ({ db }) => {
        await seedTwoChildren(db);

        await db.public.Parent.where({ p: 'p1' }).update({
          childrenOpt: (children) => children.where({ c: 'c1', non_unique: '0' }).delete(),
        });

        expect(await childrenOf(db)).toEqual([{ p: 'p1', childrenOpt: [{ c: 'c2' }] }]);
        expect(await toManyChildren(db)).toEqual([{ c: 'c2' }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it.each([
    ['PM to C1! (pm_c1_req_error_if_filter_not_match)', requiredChildJson],
    ['PM to C1 (pm_c1_error_if_filter_not_match)', optionalChildJson],
  ])(
    'a nested delete whose filter does not match the related child changes nothing and raises nothing, %s',
    (_, contractJson) =>
      withPostgresPort<OptionalChildContract>({ contractJson }, async ({ db }) => {
        await seedTwoChildren(db);

        await db.public.Parent.where({ p: 'p1' }).update({
          childrenOpt: (children) => children.where({ c: 'c1', non_unique: '1' }).delete(),
        });

        expect(await childrenOf(db)).toEqual([
          { p: 'p1', childrenOpt: [{ c: 'c1' }, { c: 'c2' }] },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested delete of the row a required key points at is refused and changes nothing, P1! to CM (p1_req_cm_should_error)',
    () =>
      withPostgresPort<RequiredChildContract>(
        { contractJson: requiredChildJson },
        async ({ db }) => {
          await db.public.Parent.create({
            p: 'p1',
            p_1: 'p',
            p_2: '1',
            childrenOpt: (children) => children.create([{ c: 'c1', c_1: 'c', c_2: '1' }]),
          });

          await expect(
            db.public.Child.where({ c: 'c1' }).update({
              // @ts-expect-error
              parentReq: (parent) => parent.delete(),
            }),
          ).rejects.toMatchObject({
            code: 'ORM.OPERATION_UNSUPPORTED',
            meta: {
              kind: 'delete',
              relation: 'parentReq',
              reason: 'required-foreign-key',
              model: 'Child',
              fields: ['parentId'],
            },
          });
          expect(
            await db.public.Child.select('c')
              .include('parentReq', (parent) => parent.select('p'))
              .all(),
          ).toEqual([{ c: 'c1', parentReq: { p: 'p1' } }]);
        },
      ),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested delete unlinks the child and deletes the row it pointed at, P1 to CM (p1_cm_by_id_should_work)',
    () =>
      withPostgresPort<OptionalChildContract>(
        { contractJson: optionalChildJson },
        async ({ db }) => {
          await seedLinkedParents(db, null);

          await db.public.Child.where({ c: 'c1' }).update({
            parentOpt: (parent) => parent.delete(),
          });

          expect(await linkedParentsOf(db)).toEqual([{ c: 'c1', parentOpt: null }]);
          expect(await db.public.Parent.select('p').all()).toEqual([{ p: 'p2' }]);
        },
      ),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested delete with a filter unlinks the child and deletes the row it pointed at when it matches, P1 to CM (p1_cm_by_id_and_filters_should_work)',
    () =>
      withPostgresPort<OptionalChildContract>(
        { contractJson: optionalChildJson },
        async ({ db }) => {
          await seedLinkedParents(db, '0');

          await db.public.Child.where({ c: 'c1' }).update({
            parentOpt: (parent) => parent.where({ non_unique: '0' }).delete(),
          });

          expect(await linkedParentsOf(db)).toEqual([{ c: 'c1', parentOpt: null }]);
          expect(await db.public.Parent.select('p').all()).toEqual([{ p: 'p2' }]);
        },
      ),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested delete without a linked row changes nothing and raises nothing, P1 to CM (p1_cm_error_if_not_connected)',
    () =>
      withPostgresPort<OptionalChildContract>(
        { contractJson: optionalChildJson },
        async ({ db }) => {
          await db.public.Parent.create({ p: 'p1', p_1: 'p', p_2: '1' });
          await db.public.Child.create({ c: 'c1', c_1: 'c', c_2: '1' });

          await db.public.Child.where({ c: 'c1' }).update({
            parentOpt: (parent) => parent.delete(),
          });

          expect(await linkedParentsOf(db)).toEqual([{ c: 'c1', parentOpt: null }]);
          expect(await db.public.Parent.select('p').all()).toEqual([{ p: 'p1' }]);
        },
      ),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested delete whose filter does not match the linked row changes nothing and raises nothing, P1 to CM (p1_cm_error_if_filter_not_match)',
    () =>
      withPostgresPort<OptionalChildContract>(
        { contractJson: optionalChildJson },
        async ({ db }) => {
          await seedLinkedParents(db, '0');

          await db.public.Child.where({ c: 'c1' }).update({
            parentOpt: (parent) => parent.where({ non_unique: '1' }).delete(),
          });

          expect(await linkedParentsOf(db)).toEqual([{ c: 'c1', parentOpt: { p: 'p1' } }]);
          expect(
            await db.public.Parent.select('p')
              .orderBy((parent) => parent.p.asc())
              .all(),
          ).toEqual([{ p: 'p1' }, { p: 'p2' }]);
        },
      ),
    timeouts.spinUpPpgDev,
  );

  it(
    'nested deletes skip a child of another parent and delete a related one, PM to CM (pm_cm_by_id_should_work, pm_cm_error_invalid_child)',
    () =>
      withPostgresPort<OptionalChildContract>({ contractJson: manyToManyJson }, async ({ db }) => {
        await seedManyToMany(db);

        await db.public.Parent.where({ p: 'p2' }).update({
          childrenOpt: (children) => [
            children.where({ c: 'otherChild' }).delete(),
            children.where({ c: 'c2' }).delete(),
          ],
        });
        const afterDelete = await childrenOf(db);
        await db.public.Parent.where({ p: 'p2' }).update({
          childrenOpt: (children) => children.where({ c: 'c2' }).delete(),
        });

        expect(afterDelete).toEqual(manyToManyAfterDeletingC2);
        expect(await childrenOf(db)).toEqual(manyToManyAfterDeletingC2);
        expect(await toManyChildren(db)).toEqual([{ c: 'c3' }, { c: 'c4' }, { c: 'otherChild' }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'nested deletes with filters delete only a related child the filter matches, PM to CM (pm_cm_by_id_and_filters_should_work)',
    () =>
      withPostgresPort<OptionalChildContract>({ contractJson: manyToManyJson }, async ({ db }) => {
        await seedManyToMany(db);

        await db.public.Parent.where({ p: 'p2' }).update({
          childrenOpt: (children) => [
            children.where({ c: 'otherChild', non_unique: '0' }).delete(),
            children.where({ c: 'c2', non_unique: '0' }).delete(),
          ],
        });
        await db.public.Parent.where({ p: 'p2' }).update({
          childrenOpt: (children) => children.where({ c: 'c3', non_unique: '1' }).delete(),
        });

        expect(await childrenOf(db)).toEqual(manyToManyAfterDeletingC2);
        expect(await toManyChildren(db)).toEqual([{ c: 'c3' }, { c: 'c4' }, { c: 'otherChild' }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'nested deletes of related children delete them and leave the children of another parent, PM to CM (pm_cm_work_correct_children)',
    () =>
      withPostgresPort<OptionalChildContract>({ contractJson: manyToManyJson }, async ({ db }) => {
        await seedManyToMany(db);

        await db.public.Parent.where({ p: 'p2' }).update({
          childrenOpt: (children) => [
            children.where({ c: 'c2' }).delete(),
            children.where({ c: 'c3' }).delete(),
          ],
        });

        expect(await childrenOf(db)).toEqual([
          { p: 'otherParent', childrenOpt: [{ c: 'otherChild' }] },
          { p: 'p2', childrenOpt: [{ c: 'c4' }] },
        ]);
        expect(await toManyChildren(db)).toEqual([{ c: 'c4' }, { c: 'otherChild' }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
