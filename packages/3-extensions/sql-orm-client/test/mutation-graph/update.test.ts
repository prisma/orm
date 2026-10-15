import { ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { recordingRun, updatePosts } from './statements';

const userIdOf7 = { user_id: ParamRef.of(7, { name: 'user_id' }) };

describe('Update with a payload', () => {
  it('adds the record of each edge to what it sets', async () => {
    const update = updatePosts({ title: 'New' });
    const run = recordingRun([], 2);
    const views = { views: ParamRef.of(3, { name: 'views' }) };

    expect(
      await update.execute({ filter: null, payload: [[userIdOf7], [views]], state: null }, run),
    ).toBe(2);
    expect(run.executed[0]).toMatchObject({
      kind: 'update',
      set: { title: { value: 'New' }, user_id: { value: 7 }, views: { value: 3 } },
    });
  });

  it('returns no rows and runs nothing when a payload edge has no source row', async () => {
    const update = updatePosts({ title: 'New' }, undefined, ['id']);
    const run = recordingRun([{ id: 1 }]);

    expect(
      await update.execute({ filter: null, payload: [[userIdOf7], []], state: null }, run),
    ).toEqual([]);
    expect(run).toMatchObject({ queried: [], executed: [] });
  });
});
