import { describe, expect, it } from 'vitest';
import {
  baseContract,
  createCollectionFor,
  withoutCapabilityKeys,
  withReturningCapability,
} from '../collection-fixtures';
import { buildMixedPolyContract } from '../helpers';
import { sent } from './sent-statements';

const featureCondition =
  "exists (select id from tasks tasks_2 inner join features on tasks_2.id = features.id where (id = tasks.id and tasks.title = 'Crash' and tasks.type = 'feature'))";

function tasks() {
  const { collection, runtime } = createCollectionFor(
    'Task' as never,
    withReturningCapability(buildMixedPolyContract()),
  );
  return { tasks: collection.where({ title: 'Crash' } as never), runtime };
}

describe('deleteAll() that reads its rows first returns only the rows its DELETE removed', () => {
  it('with includes', async () => {
    const { collection, runtime } = createCollectionFor('User');
    runtime.setNextResults([
      [
        { id: 1, name: 'Ada', posts: [] },
        { id: 2, name: 'Ada', posts: [] },
      ],
      [{ id: 2, name: 'Ada' }],
    ]);

    const rows = await collection
      .where({ name: 'Ada' })
      .select('id', 'name')
      .include('posts')
      .deleteAll()
      .toArray();

    expect(rows).toEqual([{ id: 2, name: 'Ada', posts: [] }]);
    expect(sent(runtime).at(-1)).toBe(
      "delete users where (name = 'Ada' and id in (1, 2)) returning id, name",
    );
  });

  it('leaves out the key it read only to match the deleted rows, when the caller did not select it', async () => {
    const { collection, runtime } = createCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Ada', posts: [] }], [{ id: 1, name: 'Ada' }]]);

    const rows = await collection
      .where({ name: 'Ada' })
      .select('name')
      .include('posts')
      .deleteAll()
      .toArray();

    expect(rows).toEqual([{ name: 'Ada', posts: [] }]);
  });

  it('on a variant stored in its own table', async () => {
    const { tasks: rows, runtime } = tasks();
    runtime.setNextResults([[{ id: 1 }, { id: 2 }], [{ id: 2 }]]);

    const deleted = await rows
      .variant('feature' as never)
      .select('id' as never)
      .deleteAll()
      .toArray();

    expect(deleted).toEqual([{ id: 2 }]);
    expect(sent(runtime)).toEqual([
      `select tasks inner join features where ${featureCondition}`,
      `delete tasks where (${featureCondition} and id in (1, 2)) returning id`,
    ]);
  });

  it('on a polymorphic base model with a variant table', async () => {
    const { tasks: rows, runtime } = tasks();
    runtime.setNextResults([[{ id: 1 }, { id: 2 }], [{ id: 1 }]]);

    const deleted = await rows
      .select('id' as never)
      .deleteAll()
      .toArray();

    expect(deleted).toEqual([{ id: 1 }]);
    expect(sent(runtime).at(-1)).toBe(
      "delete tasks where (title = 'Crash' and id in (1, 2)) returning id",
    );
  });

  it('returns every row it read on a database without RETURNING', async () => {
    const { collection, runtime } = createCollectionFor(
      'User',
      withoutCapabilityKeys(baseContract, ['returning']),
    );
    runtime.setNextResults([
      [
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Ada' },
      ],
    ]);
    runtime.setNextStats([{ affectedRows: 2 }]);

    const rows = await collection.where({ name: 'Ada' }).select('id', 'name').deleteAll().toArray();

    expect(rows).toEqual([
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Ada' },
    ]);
    expect(sent(runtime)).toEqual([
      "select users where name = 'Ada'",
      "delete users where (name = 'Ada' and id in (1, 2))",
    ]);
  });
});
