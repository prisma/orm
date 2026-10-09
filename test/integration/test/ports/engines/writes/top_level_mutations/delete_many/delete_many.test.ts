import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract } from './_fixture/nested_del_many/generated/contract';
import contractJson from './_fixture/nested_del_many/generated/contract.json' with { type: 'json' };

describe('ports/engines/writes/top_level_mutations/delete_many', () => {
  it(
    'nested deleteMany removes the children matching either filter (nested_delete_many)',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const created = await db.public.Parent.select('name')
          .include('children', (children) =>
            children.select('name').orderBy((child) => child.name.asc()),
          )
          .create({
            id: '1',
            name: 'Dad',
            children: (children) =>
              children.create([
                { id: '1', name: 'Daughter' },
                { id: '2', name: 'Daughter2' },
                { id: '3', name: 'Son' },
                { id: '4', name: 'Son2' },
              ]),
          });

        expect(created).toEqual({
          name: 'Dad',
          children: [
            { name: 'Daughter' },
            { name: 'Daughter2' },
            { name: 'Son' },
            { name: 'Son2' },
          ],
        });

        const updated = await db.public.Parent.where({ name: 'Dad' })
          .select('name')
          .include('children', (children) =>
            children.select('name').orderBy((child) => child.name.asc()),
          )
          .update({
            children: (children) => [
              children.where((child) => child.name.like('%Daughter%')).deleteAll(),
              children.where((child) => child.name.like('%Son%')).deleteAll(),
            ],
          });

        expect(updated).toEqual({ name: 'Dad', children: [] });
      }),
    timeouts.spinUpPpgDev,
  );
});
