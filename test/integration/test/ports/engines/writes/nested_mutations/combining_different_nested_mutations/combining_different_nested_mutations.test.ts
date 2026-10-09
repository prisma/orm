import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

describe('ports/engines/writes/nested_mutations/combining_different_nested_mutations', () => {
  it(
    'a nested create followed by a disconnect detaches only the disconnected child',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const created = await db.public.Parent.select('p')
          .include('childrenOpt', (children) =>
            children.select('c').orderBy((child) => child.c.asc()),
          )
          .create({
            p: 'p1',
            p_1: '1',
            p_2: '2',
            childrenOpt: (children) =>
              children.create([
                { c: 'c1', c_1: 'foo', c_2: 'bar' },
                { c: 'c2', c_1: 'asd', c_2: 'qawf' },
              ]),
          });

        expect(created).toEqual({ p: 'p1', childrenOpt: [{ c: 'c1' }, { c: 'c2' }] });

        const updated = await db.public.Parent.where({ p: 'p1' })
          .select('p')
          .include('childrenOpt', (children) =>
            children.select('c').orderBy((child) => child.c.asc()),
          )
          .update({
            childrenOpt: (children) => [
              children.create([
                { c: 'c3', c_1: 'yksi', c_2: 'kaksi' },
                { c: 'c4', c_1: 'kolme', c_2: 'neljae' },
              ]),
              children.disconnect([{ c: 'c3' }]),
            ],
          });

        expect(updated).toEqual({
          p: 'p1',
          childrenOpt: [{ c: 'c1' }, { c: 'c2' }, { c: 'c4' }],
        });

        const children = await db.public.Child.select('c')
          .include('parentsOpt', (parents) => parents.select('p'))
          .orderBy((child) => child.c.asc())
          .all();

        expect(children).toEqual([
          { c: 'c1', parentsOpt: [{ p: 'p1' }] },
          { c: 'c2', parentsOpt: [{ p: 'p1' }] },
          { c: 'c3', parentsOpt: [] },
          { c: 'c4', parentsOpt: [{ p: 'p1' }] },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );
});
