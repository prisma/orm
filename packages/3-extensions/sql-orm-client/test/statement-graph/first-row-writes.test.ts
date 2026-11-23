import { describe, expect, it } from 'vitest';
import { createCollectionFor } from '../collection-fixtures';
import { sent } from './sent-statements';

const ada = { id: 1, name: 'Ada' };

function users() {
  const { collection, runtime } = createCollectionFor('User');
  return { users: collection.where({ name: 'Ada' }).select('id', 'name'), runtime };
}

describe('what delete() returns when its filter names no unique key, on a database with RETURNING', () => {
  it('returns the row the DELETE removed, with the values it returned', async () => {
    const { users: rows, runtime } = users();
    runtime.setNextResults([[ada], [{ id: 1, name: 'Ada L.' }]]);

    expect(await rows.delete()).toEqual({ id: 1, name: 'Ada L.' });
    expect(sent(runtime)).toEqual([
      "select users where name = 'Ada' limit 1",
      'delete users where id = 1 returning id, name',
    ]);
  });

  it('returns null when the DELETE removed no row', async () => {
    const { users: rows, runtime } = users();
    runtime.setNextResults([[ada], []]);

    expect(await rows.delete()).toBeNull();
  });
});
