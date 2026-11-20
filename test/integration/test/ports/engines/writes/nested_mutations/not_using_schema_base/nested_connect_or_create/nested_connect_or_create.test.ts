import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../../_harness/postgres';
import type { Contract as M2nContract } from './_fixture/m2n/generated/contract';
import m2nJson from './_fixture/m2n/generated/contract.json' with { type: 'json' };
import type { Contract as OneReq2mContract } from './_fixture/one_req_2m/generated/contract';
import oneReq2mJson from './_fixture/one_req_2m/generated/contract.json' with { type: 'json' };
import type { Contract as One2mContract } from './_fixture/one2m/generated/contract';
import one2mJson from './_fixture/one2m/generated/contract.json' with { type: 'json' };
import type { Contract as One2oneContract } from './_fixture/one2one/generated/contract';
import one2oneJson from './_fixture/one2one/generated/contract.json' with { type: 'json' };

describe('ports/engines/writes/nested_mutations/not_using_schema_base/nested_connect_or_create', () => {
  it(
    'a m:n relation connectOrCreate creates or connects the targets (m2n_connect_or_create)',
    () =>
      withPostgresPort<M2nContract>({ contractJson: m2nJson }, async ({ db }) => {
        const withManyB = () =>
          db.public.ModelA.select('id').include('manyB', (manyB) =>
            manyB.select('id').orderBy((b) => b.id.asc()),
          );

        const bothNew = await withManyB().create({
          id: 'A1',
          manyB: (manyB) =>
            manyB.create({ id: 'B1' }, { onConflict: 'connect', conflictOn: ['id'] }),
        });
        expect(bothNew).toEqual({ id: 'A1', manyB: [{ id: 'B1' }] });

        const existingChild = await withManyB().create({
          id: 'A2',
          manyB: (manyB) =>
            manyB.create({ id: 'B1' }, { onConflict: 'connect', conflictOn: ['id'] }),
        });
        expect(existingChild).toEqual({ id: 'A2', manyB: [{ id: 'B1' }] });

        const updated = await withManyB()
          .where({ id: 'A1' })
          .update({
            manyB: (manyB) =>
              manyB.create([{ id: 'B2' }, { id: 'B3' }], {
                onConflict: 'connect',
                conflictOn: ['id'],
              }),
          });
        expect(updated).toEqual({ id: 'A1', manyB: [{ id: 'B1' }, { id: 'B2' }, { id: 'B3' }] });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a 1!:m relation connectOrCreate works inlined in the parent and in the child (one_req_2m_connect_or_create)',
    () =>
      withPostgresPort<OneReq2mContract>({ contractJson: oneReq2mJson }, async ({ db }) => {
        const createA = (id: string) =>
          db.public.ModelA.select('id')
            .include('oneB', (oneB) => oneB.select('id'))
            .create({
              id,
              oneB: (oneB) =>
                oneB.create(
                  { id: 'B_id_1', b_u: 'B1' },
                  { onConflict: 'connect', conflictOn: ['b_u'] },
                ),
            });

        expect(await createA('A1')).toEqual({ id: 'A1', oneB: { id: 'B_id_1' } });
        expect(await createA('A2')).toEqual({ id: 'A2', oneB: { id: 'B_id_1' } });

        const updated = await db.public.ModelB.select('id')
          .include('manyA', (manyA) => manyA.select('id').orderBy((a) => a.id.asc()))
          .where({ b_u: 'B1' })
          .update({
            manyA: (manyA) =>
              manyA.create([{ id: 'A3' }, { id: 'A4' }], {
                onConflict: 'connect',
                conflictOn: ['id'],
              }),
          });
        expect(updated).toEqual({
          id: 'B_id_1',
          manyA: [{ id: 'A1' }, { id: 'A2' }, { id: 'A3' }, { id: 'A4' }],
        });

        const created = await db.public.ModelB.select('id')
          .include('manyA', (manyA) => manyA.select('id'))
          .create({
            id: 'B_id_2',
            b_u: 'B2',
            manyA: (manyA) =>
              manyA.create({ id: 'A1' }, { onConflict: 'connect', conflictOn: ['id'] }),
          });
        expect(created).toEqual({ id: 'B_id_2', manyA: [{ id: 'A1' }] });

        const a1 = await db.public.ModelA.select('id')
          .include('oneB', (oneB) => oneB.select('b_u'))
          .where({ id: 'A1' })
          .first();
        expect(a1).toEqual({ id: 'A1', oneB: { b_u: 'B2' } });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a 1:m relation connectOrCreate works inlined in the parent and in the child (one2m_connect_or_create)',
    () =>
      withPostgresPort<One2mContract>({ contractJson: one2mJson }, async ({ db }) => {
        const createA = (id: string) =>
          db.public.ModelA.select('id')
            .include('oneB', (oneB) => oneB.select('id'))
            .create({
              id,
              oneB: (oneB) =>
                oneB.create(
                  { id: 'B_id_1', b_u: 'B1' },
                  { onConflict: 'connect', conflictOn: ['b_u'] },
                ),
            });

        expect(await createA('A1')).toEqual({ id: 'A1', oneB: { id: 'B_id_1' } });
        expect(await createA('A2')).toEqual({ id: 'A2', oneB: { id: 'B_id_1' } });

        const updated = await db.public.ModelB.select('id')
          .include('manyA', (manyA) => manyA.select('id').orderBy((a) => a.id.asc()))
          .where({ b_u: 'B1' })
          .update({
            manyA: (manyA) =>
              manyA.create([{ id: 'A3' }, { id: 'A4' }], {
                onConflict: 'connect',
                conflictOn: ['id'],
              }),
          });
        expect(updated).toEqual({
          id: 'B_id_1',
          manyA: [{ id: 'A1' }, { id: 'A2' }, { id: 'A3' }, { id: 'A4' }],
        });

        const created = await db.public.ModelB.select('id')
          .include('manyA', (manyA) => manyA.select('id'))
          .create({
            id: 'B_id_2',
            b_u: 'B2',
            manyA: (manyA) =>
              manyA.create({ id: 'A1' }, { onConflict: 'connect', conflictOn: ['id'] }),
          });
        expect(created).toEqual({ id: 'B_id_2', manyA: [{ id: 'A1' }] });

        const a1 = await db.public.ModelA.select('id')
          .include('oneB', (oneB) => oneB.select('b_u'))
          .where({ id: 'A1' })
          .first();
        expect(a1).toEqual({ id: 'A1', oneB: { b_u: 'B2' } });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a 1:1 update connectOrCreate links a child not yet connected and keeps it when already connected (one2one_update_if_no_child_connected_yet)',
    () =>
      withPostgresPort<One2oneContract>({ contractJson: one2oneJson }, async ({ db }) => {
        await db.public.Parent.create({ id: 1 });
        await db.public.Child.create({ id: 1 });

        const connect = () =>
          db.public.Parent.select('id')
            .include('child', (child) => child.select('id'))
            .where({ id: 1 })
            .update({
              child: (child) =>
                child.create({ id: 1 }, { onConflict: 'connect', conflictOn: ['id'] }),
            });

        expect(await connect()).toEqual({ id: 1, child: { id: 1 } });
        expect(await connect()).toEqual({ id: 1, child: { id: 1 } });
      }),
    timeouts.spinUpPpgDev,
  );
});
