import { describe, expect, it } from 'vitest';
import { type PortContext, timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract as ManyToManyContract } from '../_fixture/many_to_many/generated/contract';
import manyToManyJson from '../_fixture/many_to_many/generated/contract.json' with { type: 'json' };
import type { Contract } from '../_fixture/parent_to_many_child_to_one_optional/generated/contract';
import optionalChildJson from '../_fixture/parent_to_many_child_to_one_optional/generated/contract.json' with {
  type: 'json',
};

type Db = PortContext<Contract>['db'];
type ChildrenUpdate = NonNullable<Parameters<Db['public']['Parent']['update']>[0]['childrenOpt']>;
type ManyToManyDb = PortContext<ManyToManyContract>['db'];
type ManyToManyChildrenUpdate = NonNullable<
  Parameters<ManyToManyDb['public']['Parent']['update']>[0]['childrenOpt']
>;

function childrenOf(db: Db) {
  return db.public.Parent.select('p')
    .include('childrenOpt', (children) =>
      children.select('c', 'non_unique').orderBy((child) => child.c.asc()),
    )
    .all();
}

async function updateChildren(db: Db, childrenOpt: ChildrenUpdate) {
  await db.public.Parent.where({ p: 'p1' }).update({ childrenOpt });
  return childrenOf(db);
}

function manyToManyChildrenOf(db: ManyToManyDb) {
  return db.public.Parent.select('p')
    .include('childrenOpt', (children) =>
      children.select('c', 'non_unique').orderBy((child) => child.c.asc()),
    )
    .all();
}

async function updateManyToManyChildren(db: ManyToManyDb, childrenOpt: ManyToManyChildrenUpdate) {
  await db.public.Parent.where({ p: 'p1' }).update({ childrenOpt });
  return manyToManyChildrenOf(db);
}

async function seedLinkedParent(db: Db, nonUnique: string | null) {
  await db.public.Parent.create({ p: 'p1', p_1: 'p', p_2: '1', non_unique: nonUnique });
  await db.public.Child.create({
    c: 'c1',
    c_1: 'c',
    c_2: '1',
    parentOpt: (parent) => parent.connect({ p: 'p1' }),
  });
}

function parentOf(db: Db) {
  return db.public.Child.select('c')
    .include('parentOpt', (parent) => parent.select('p', 'non_unique'))
    .all();
}

describe('ports/engines/writes/nested_mutations/nested_update_inside_update', () => {
  it(
    'a nested update changes the linked row, P1 to CM (p1_cm_should_work)',
    () =>
      withPostgresPort<Contract>({ contractJson: optionalChildJson }, async ({ db }) => {
        await seedLinkedParent(db, null);

        await db.public.Child.where({ c: 'c1' }).update({
          parentOpt: (parent) => parent.update({ non_unique: 'updated' }),
        });

        expect(await parentOf(db)).toEqual([
          { c: 'c1', parentOpt: { p: 'p1', non_unique: 'updated' } },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested update with a filter changes the linked row when it matches, P1 to CM (p1_cm_by_id_and_filters_should_work)',
    () =>
      withPostgresPort<Contract>({ contractJson: optionalChildJson }, async ({ db }) => {
        await seedLinkedParent(db, '0');

        await db.public.Child.where({ c: 'c1' }).update({
          parentOpt: (parent) =>
            parent.where({ non_unique: '0' }).update({ non_unique: 'updated' }),
        });

        expect(await parentOf(db)).toEqual([
          { c: 'c1', parentOpt: { p: 'p1', non_unique: 'updated' } },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested update without a linked row changes nothing and raises nothing, P1 to CM (p1_cm_error_if_not_connected)',
    () =>
      withPostgresPort<Contract>({ contractJson: optionalChildJson }, async ({ db }) => {
        await db.public.Parent.create({ p: 'p1', p_1: 'p', p_2: '1' });
        await db.public.Child.create({ c: 'c1', c_1: 'c', c_2: '1' });

        await db.public.Child.where({ c: 'c1' }).update({
          parentOpt: (parent) => parent.update({ non_unique: 'updated' }),
        });

        expect(await parentOf(db)).toEqual([{ c: 'c1', parentOpt: null }]);
        expect(await db.public.Parent.select('p', 'non_unique').all()).toEqual([
          { p: 'p1', non_unique: null },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested update whose filter does not match the linked row changes nothing and raises nothing, P1 to CM (p1_cm_error_if_filter_not_match)',
    () =>
      withPostgresPort<Contract>({ contractJson: optionalChildJson }, async ({ db }) => {
        await seedLinkedParent(db, '0');

        await db.public.Child.where({ c: 'c1' }).update({
          parentOpt: (parent) =>
            parent.where({ non_unique: '1' }).update({ non_unique: 'updated' }),
        });

        expect(await parentOf(db)).toEqual([{ c: 'c1', parentOpt: { p: 'p1', non_unique: '0' } }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested update changes the related child the filter names, PM to C1 (pm_c1_should_work, pm_cm_should_work)',
    () =>
      withPostgresPort<Contract>({ contractJson: optionalChildJson }, async ({ db }) => {
        await db.public.Parent.create({
          p: 'p1',
          p_1: 'p',
          p_2: '1',
          childrenOpt: (children) =>
            children.create([
              { c: 'c1', c_1: 'c', c_2: '1' },
              { c: 'c2', c_1: 'c', c_2: '2' },
            ]),
        });

        expect(
          await updateChildren(db, (children) =>
            children.where({ c: 'c1' }).update({ non_unique: 'updated' }),
          ),
        ).toEqual([
          {
            p: 'p1',
            childrenOpt: [
              { c: 'c1', non_unique: 'updated' },
              { c: 'c2', non_unique: null },
            ],
          },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested update changes the related child the filter names, PM to CM (pm_c1_should_work, pm_cm_should_work)',
    () =>
      withPostgresPort<ManyToManyContract>({ contractJson: manyToManyJson }, async ({ db }) => {
        await db.public.Parent.create({
          p: 'p1',
          p_1: 'p',
          p_2: '1',
          childrenOpt: (children) =>
            children.create([
              { c: 'c1', c_1: 'c', c_2: '1' },
              { c: 'c2', c_1: 'c', c_2: '2' },
            ]),
        });

        expect(
          await updateManyToManyChildren(db, (children) =>
            children.where({ c: 'c1' }).update({ non_unique: 'updated' }),
          ),
        ).toEqual([
          {
            p: 'p1',
            childrenOpt: [
              { c: 'c1', non_unique: 'updated' },
              { c: 'c2', non_unique: null },
            ],
          },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested update with a unique field and a filter changes the matching child, PM to C1 (pm_c1_by_id_and_filters_should_work, pm_cm_by_id_and_filters_should_work)',
    () =>
      withPostgresPort<Contract>({ contractJson: optionalChildJson }, async ({ db }) => {
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

        expect(
          await updateChildren(db, (children) =>
            children.where({ c: 'c1', non_unique: '0' }).update({ non_unique: 'updated' }),
          ),
        ).toEqual([
          {
            p: 'p1',
            childrenOpt: [
              { c: 'c1', non_unique: 'updated' },
              { c: 'c2', non_unique: '1' },
            ],
          },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested update with a unique field and a filter changes the matching child, PM to CM (pm_c1_by_id_and_filters_should_work, pm_cm_by_id_and_filters_should_work)',
    () =>
      withPostgresPort<ManyToManyContract>({ contractJson: manyToManyJson }, async ({ db }) => {
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

        expect(
          await updateManyToManyChildren(db, (children) =>
            children.where({ c: 'c1', non_unique: '0' }).update({ non_unique: 'updated' }),
          ),
        ).toEqual([
          {
            p: 'p1',
            childrenOpt: [
              { c: 'c1', non_unique: 'updated' },
              { c: 'c2', non_unique: '1' },
            ],
          },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested update of a child that is not related changes nothing and raises nothing, PM to C1 (pm_c1_error_if_not_connected, pm_cm_error_if_not_connected)',
    () =>
      withPostgresPort<Contract>({ contractJson: optionalChildJson }, async ({ db }) => {
        await db.public.Parent.create({ p: 'p1', p_1: 'p', p_2: '1' });
        await db.public.Child.create({ c: 'c1', c_1: 'c', c_2: '1' });

        expect(
          await updateChildren(db, (children) =>
            children.where({ c: 'c1' }).update({ non_unique: 'updated' }),
          ),
        ).toEqual([{ p: 'p1', childrenOpt: [] }]);
        expect(await db.public.Child.select('c', 'non_unique').all()).toEqual([
          { c: 'c1', non_unique: null },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested update of a child that is not related changes nothing and raises nothing, PM to CM (pm_c1_error_if_not_connected, pm_cm_error_if_not_connected)',
    () =>
      withPostgresPort<ManyToManyContract>({ contractJson: manyToManyJson }, async ({ db }) => {
        await db.public.Parent.create({ p: 'p1', p_1: 'p', p_2: '1' });
        await db.public.Child.create({ c: 'c1', c_1: 'c', c_2: '1' });

        expect(
          await updateManyToManyChildren(db, (children) =>
            children.where({ c: 'c1' }).update({ non_unique: 'updated' }),
          ),
        ).toEqual([{ p: 'p1', childrenOpt: [] }]);
        expect(await db.public.Child.select('c', 'non_unique').all()).toEqual([
          { c: 'c1', non_unique: null },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested update whose filter does not match the related child changes nothing and raises nothing, PM to C1 (pm_c1_error_if_filter_not_match, pm_cm_error_if_filter_not_match)',
    () =>
      withPostgresPort<Contract>({ contractJson: optionalChildJson }, async ({ db }) => {
        await db.public.Parent.create({
          p: 'p1',
          p_1: 'p',
          p_2: '1',
          childrenOpt: (children) =>
            children.create([{ c: 'existingChild', c_1: 'c', c_2: '1', non_unique: '0' }]),
        });

        expect(
          await updateChildren(db, (children) =>
            children
              .where({ c: 'existingChild', non_unique: '1' })
              .update({ non_unique: 'updated' }),
          ),
        ).toEqual([{ p: 'p1', childrenOpt: [{ c: 'existingChild', non_unique: '0' }] }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested update whose filter does not match the related child changes nothing and raises nothing, PM to CM (pm_c1_error_if_filter_not_match, pm_cm_error_if_filter_not_match)',
    () =>
      withPostgresPort<ManyToManyContract>({ contractJson: manyToManyJson }, async ({ db }) => {
        await db.public.Parent.create({
          p: 'p1',
          p_1: 'p',
          p_2: '1',
          childrenOpt: (children) =>
            children.create([{ c: 'existingChild', c_1: 'c', c_2: '1', non_unique: '0' }]),
        });

        expect(
          await updateManyToManyChildren(db, (children) =>
            children
              .where({ c: 'existingChild', non_unique: '1' })
              .update({ non_unique: 'updated' }),
          ),
        ).toEqual([{ p: 'p1', childrenOpt: [{ c: 'existingChild', non_unique: '0' }] }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested update on a many-to-many relation that matches no row writes the parent and leaves the child unchanged (tx_m2m_fail_wrong_where, no_tx_m2m_fail_gracefully)',
    () =>
      withPostgresPort<ManyToManyContract>({ contractJson: manyToManyJson }, async ({ db }) => {
        await db.public.Parent.create({
          p: 'p1',
          p_1: 'p',
          p_2: '1',
          non_unique: 'Some Text',
          childrenOpt: (children) => children.create([{ c: 'c1', c_1: 'c', c_2: '1' }]),
        });

        const updated = await db.public.Parent.where({ p: 'p1' })
          .select('p', 'non_unique')
          .update({
            non_unique: 'Some Changed Text',
            childrenOpt: (children) =>
              children.where({ id: 'DOES NOT EXIST' }).update({ non_unique: 'updated title' }),
          });

        expect(updated).toEqual({ p: 'p1', non_unique: 'Some Changed Text' });
        expect(await manyToManyChildrenOf(db)).toEqual([
          { p: 'p1', childrenOpt: [{ c: 'c1', non_unique: null }] },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );
});
