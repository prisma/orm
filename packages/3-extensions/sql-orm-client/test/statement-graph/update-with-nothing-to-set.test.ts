import { describe, expect, it } from 'vitest';
import { createReturningCollectionFor } from '../collection-fixtures';
import type { MockRuntime } from '../helpers';

function kinds(runtime: MockRuntime): string[] {
  return runtime.executions.map((execution) =>
    'ast' in execution.plan ? `${execution.operation} ${execution.plan.ast.kind}` : 'no ast',
  );
}

describe('an update with nothing to set', () => {
  it('update resolves the first matching row with the selection of the caller', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Ada' }]]);

    const row = await collection.where({ name: 'Ada' }).select('id', 'name').update({});

    expect(row).toEqual({ id: 1, name: 'Ada' });
    expect(kinds(runtime)).toEqual(['query select']);
    expect(runtime.executions[0]?.plan).toMatchObject({ ast: { limit: 1 } });
  });

  it('update resolves the first matching row with its includes', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Ada', posts: [] }]]);

    const row = await collection
      .where({ name: 'Ada' })
      .select('id', 'name')
      .include('posts', (posts) => posts.select('id', 'title'))
      .update({});

    expect(row).toEqual({ id: 1, name: 'Ada', posts: [] });
    expect(kinds(runtime)).toEqual(['query select']);
  });

  it('update resolves null when no row matches', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[]]);

    expect(await collection.where({ name: 'Ada' }).select('id').update({})).toBeNull();
    expect(kinds(runtime)).toEqual(['query select']);
  });

  it('updateAll yields the matching rows', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([
      [
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Ada' },
      ],
    ]);

    const rows = await collection.where({ name: 'Ada' }).select('id', 'name').updateAll({});

    expect(rows).toEqual([
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Ada' },
    ]);
    expect(kinds(runtime)).toEqual(['query select']);
  });

  it('updateAndCount resolves zero and runs no statement', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');

    expect(await collection.where({ name: 'Ada' }).updateAndCount({})).toBe(0);
    expect(runtime.executions).toEqual([]);
  });
});
