import { describe, expect, it } from 'vitest';
import { baseContract, createCollectionFor, withoutCapabilityKeys } from '../collection-fixtures';
import { sent } from './sent-statements';

const ada = { id: 1, name: 'Ada' };

function users(returning: 'with RETURNING' | 'without RETURNING') {
  const contract =
    returning === 'with RETURNING'
      ? baseContract
      : withoutCapabilityKeys(baseContract, ['returning']);
  const { collection, runtime } = createCollectionFor('User', contract);
  return { users: collection.where({ name: 'Ada' }).select('id', 'name'), runtime };
}

describe('delete() and update() whose filter names no unique key', () => {
  it('delete() deletes the row it found only if the row still matches the filter, with RETURNING', async () => {
    const { users: rows, runtime } = users('with RETURNING');
    runtime.setNextResults([[ada], [ada]]);

    await rows.delete();

    expect(sent(runtime)[1]).toBe("delete users where (name = 'Ada' and id = 1)");
  });

  it('update() updates the row it found only if the row still matches the filter, with RETURNING', async () => {
    const { users: rows, runtime } = users('with RETURNING');
    runtime.setNextResults([[{ id: 1 }], [ada]]);

    await rows.update({ name: 'Grace' });

    expect(sent(runtime)).toEqual([
      "select users where name = 'Ada' limit 1",
      "update users where (name = 'Ada' and id = 1) returning id, name",
    ]);
  });

  it('delete() and update() carry the filter without RETURNING too', async () => {
    const { users: rows, runtime } = users('without RETURNING');
    runtime.setNextResults([[ada], [{ id: 1 }], [ada]]);

    await rows.delete();
    await rows.update({ name: 'Grace' });

    expect(sent(runtime)).toEqual([
      "select users where name = 'Ada' limit 1",
      "delete users where (name = 'Ada' and id = 1)",
      "select users where name = 'Ada' limit 1",
      "update users where (name = 'Ada' and id = 1)",
      'select users where id = 1',
    ]);
  });
});
