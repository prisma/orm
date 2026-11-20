import { describe, expect, it } from 'vitest';
import { type PortContext, timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/simple_m2m/generated/contract';
import contractJson from './_fixture/simple_m2m/generated/contract.json' with { type: 'json' };

type Db = PortContext<Contract>['db'];

function createModelA(db: Db, id: string, manyB: readonly string[]) {
  return db.public.ModelA.select('id')
    .include('manyB', (b) => b.select('id').orderBy((row) => row.id.asc()))
    .create({
      id,
      manyB: (mutator) =>
        mutator.create(
          manyB.map((bId) => ({ id: bId })),
          { onConflict: 'connect', conflictOn: ['id'] },
        ),
    });
}

async function createTestData(db: Db) {
  expect(await createModelA(db, 'A1', ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'])).toEqual({
    id: 'A1',
    manyB: [{ id: 'B1' }, { id: 'B2' }, { id: 'B3' }, { id: 'B4' }, { id: 'B5' }, { id: 'B6' }],
  });
  expect(await createModelA(db, 'A2', ['B2', 'B3', 'B5', 'B7', 'B8'])).toEqual({
    id: 'A2',
    manyB: [{ id: 'B2' }, { id: 'B3' }, { id: 'B5' }, { id: 'B7' }, { id: 'B8' }],
  });
  expect(await createModelA(db, 'A3', [])).toEqual({ id: 'A3', manyB: [] });
}

describe('ports/engines/queries/order_and_pagination/nested_pagination', () => {
  it.fails(
    'a many-to-many include with a cursor returns the children from the cursor on (m2m_many_children_nested_cursor)',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        expect(await createModelA(db, 'A1', ['B1', 'B2', 'B3'])).toEqual({
          id: 'A1',
          manyB: [{ id: 'B1' }, { id: 'B2' }, { id: 'B3' }],
        });
        expect(await createModelA(db, 'A2', ['B2'])).toEqual({ id: 'A2', manyB: [{ id: 'B2' }] });
        expect(await createModelA(db, 'A3', [])).toEqual({ id: 'A3', manyB: [] });

        const rows = await db.public.ModelA.select('id')
          .include('manyB', (b) =>
            b
              .select('id')
              .orderBy((row) => row.id.asc())
              .cursor({ id: 'B2' }),
          )
          .orderBy((a) => a.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 'A1', manyB: [{ id: 'B2' }, { id: 'B3' }] },
          { id: 'A2', manyB: [{ id: 'B2' }] },
          { id: 'A3', manyB: [] },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'a many-to-many include with a cursor, skip and take, also a negative take (m2m_many_children_nested_cursor_skip_take)',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await createTestData(db);
        const all = db.public.ModelA.select('id').orderBy((a) => a.id.asc());

        expect(
          await all
            .include('manyB', (b) =>
              b
                .select('id')
                .orderBy((row) => row.id.asc())
                .cursor({ id: 'B2' })
                .offset(1),
            )
            .all(),
        ).toEqual([
          { id: 'A1', manyB: [{ id: 'B3' }, { id: 'B4' }, { id: 'B5' }, { id: 'B6' }] },
          { id: 'A2', manyB: [{ id: 'B3' }, { id: 'B5' }, { id: 'B7' }, { id: 'B8' }] },
          { id: 'A3', manyB: [] },
        ]);
        expect(
          await all
            .include('manyB', (b) =>
              b
                .select('id')
                .orderBy((row) => row.id.asc())
                .cursor({ id: 'B2' })
                .offset(1)
                .limit(2),
            )
            .all(),
        ).toEqual([
          { id: 'A1', manyB: [{ id: 'B3' }, { id: 'B4' }] },
          { id: 'A2', manyB: [{ id: 'B3' }, { id: 'B5' }] },
          { id: 'A3', manyB: [] },
        ]);
        expect(
          await all
            .include('manyB', (b) =>
              b
                .select('id')
                .orderBy((row) => row.id.asc())
                .cursor({ id: 'B5' })
                .offset(1)
                .limit(-2),
            )
            .all(),
        ).toEqual([
          { id: 'A1', manyB: [{ id: 'B3' }, { id: 'B4' }] },
          { id: 'A2', manyB: [{ id: 'B2' }, { id: 'B3' }] },
          { id: 'A3', manyB: [] },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'a many-to-many include with skip and take, also a negative take (m2m_many_children_nested_skip_take)',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await createTestData(db);
        const a1 = db.public.ModelA.select('id').where({ id: 'A1' });
        const all = db.public.ModelA.select('id').orderBy((a) => a.id.asc());

        expect(
          await a1
            .include('manyB', (b) =>
              b
                .select('id')
                .orderBy((row) => row.id.asc())
                .offset(1),
            )
            .first(),
        ).toEqual({
          id: 'A1',
          manyB: [{ id: 'B2' }, { id: 'B3' }, { id: 'B4' }, { id: 'B5' }, { id: 'B6' }],
        });
        expect(
          await all
            .include('manyB', (b) =>
              b
                .select('id')
                .orderBy((row) => row.id.asc())
                .offset(1),
            )
            .all(),
        ).toEqual([
          {
            id: 'A1',
            manyB: [{ id: 'B2' }, { id: 'B3' }, { id: 'B4' }, { id: 'B5' }, { id: 'B6' }],
          },
          { id: 'A2', manyB: [{ id: 'B3' }, { id: 'B5' }, { id: 'B7' }, { id: 'B8' }] },
          { id: 'A3', manyB: [] },
        ]);
        expect(
          await a1
            .include('manyB', (b) =>
              b
                .select('id')
                .orderBy((row) => row.id.asc())
                .offset(1)
                .limit(2),
            )
            .first(),
        ).toEqual({ id: 'A1', manyB: [{ id: 'B2' }, { id: 'B3' }] });
        expect(
          await all
            .include('manyB', (b) =>
              b
                .select('id')
                .orderBy((row) => row.id.asc())
                .offset(1)
                .limit(2),
            )
            .all(),
        ).toEqual([
          { id: 'A1', manyB: [{ id: 'B2' }, { id: 'B3' }] },
          { id: 'A2', manyB: [{ id: 'B3' }, { id: 'B5' }] },
          { id: 'A3', manyB: [] },
        ]);
        expect(
          await a1
            .include('manyB', (b) =>
              b
                .select('id')
                .orderBy((row) => row.id.asc())
                .offset(1)
                .limit(-2),
            )
            .first(),
        ).toEqual({ id: 'A1', manyB: [{ id: 'B4' }, { id: 'B5' }] });
        expect(
          await all
            .include('manyB', (b) =>
              b
                .select('id')
                .orderBy((row) => row.id.asc())
                .offset(1)
                .limit(-2),
            )
            .all(),
        ).toEqual([
          { id: 'A1', manyB: [{ id: 'B4' }, { id: 'B5' }] },
          { id: 'A2', manyB: [{ id: 'B5' }, { id: 'B7' }] },
          { id: 'A3', manyB: [] },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );
});
