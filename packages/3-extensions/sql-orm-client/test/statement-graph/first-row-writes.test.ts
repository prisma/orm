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

    expect(sent(runtime)[1]).toBe(
      "delete users where (name = 'Ada' and id = 1) returning id, name",
    );
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
    runtime.setNextStats([{ affectedRows: 1 }, { affectedRows: 1 }]);

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

describe('what delete() returns when its filter names no unique key', () => {
  it('returns the row the DELETE removed, with the values it returned, on a database with RETURNING', async () => {
    const { users: rows, runtime } = users('with RETURNING');
    runtime.setNextResults([[ada], [{ id: 1, name: 'Ada L.' }]]);

    expect(await rows.delete()).toEqual({ id: 1, name: 'Ada L.' });
  });

  it('returns null when the row it found no longer matches at the DELETE, on a database with RETURNING', async () => {
    const { users: rows, runtime } = users('with RETURNING');
    runtime.setNextResults([[ada], []]);

    expect(await rows.delete()).toBeNull();
  });

  it('returns the row it found when the DELETE removed it, on a database without RETURNING', async () => {
    const { users: rows, runtime } = users('without RETURNING');
    runtime.setNextResults([[ada]]);
    runtime.setNextStats([{ affectedRows: 1 }]);

    expect(await rows.delete()).toEqual(ada);
    expect(sent(runtime)).toEqual([
      "select users where name = 'Ada' limit 1",
      "delete users where (name = 'Ada' and id = 1)",
    ]);
  });

  it('returns null when the DELETE removed no row, on a database without RETURNING', async () => {
    const { users: rows, runtime } = users('without RETURNING');
    runtime.setNextResults([[ada]]);
    runtime.setNextStats([{ affectedRows: 0 }]);

    expect(await rows.delete()).toBeNull();
  });
});

describe('what update() returns when its filter names no unique key', () => {
  it('returns null when the row it found no longer matches at the UPDATE, on a database with RETURNING', async () => {
    const { users: rows, runtime } = users('with RETURNING');
    runtime.setNextResults([[{ id: 1 }], []]);

    expect(await rows.update({ name: 'Grace' })).toBeNull();
    expect(sent(runtime)).toEqual([
      "select users where name = 'Ada' limit 1",
      "update users where (name = 'Ada' and id = 1) returning id, name",
    ]);
  });

  it('reads the row back when the UPDATE matched it, on a database without RETURNING', async () => {
    const { users: rows, runtime } = users('without RETURNING');
    runtime.setNextResults([[{ id: 1 }], [{ id: 1, name: 'Grace' }]]);
    runtime.setNextStats([{ affectedRows: 1 }]);

    expect(await rows.update({ name: 'Grace' })).toEqual({ id: 1, name: 'Grace' });
  });

  it('returns null without reading back when the UPDATE matched no row, on a database without RETURNING', async () => {
    const { users: rows, runtime } = users('without RETURNING');
    runtime.setNextResults([[{ id: 1 }], [{ id: 1, name: 'Ada' }]]);
    runtime.setNextStats([{ affectedRows: 0 }]);

    expect(await rows.update({ name: 'Grace' })).toBeNull();
    expect(sent(runtime)).toEqual([
      "select users where name = 'Ada' limit 1",
      "update users where (name = 'Ada' and id = 1)",
    ]);
  });
});

describe('delete() and update() whose filter holds raw SQL', () => {
  it('write the row they found by key alone, since the raw SQL may read the table they write', async () => {
    const { collection, runtime } = createCollectionFor('User');
    const rows = collection
      .where((user, { fns }) => fns.raw`${user.name} <> ''`.returns('pg/bool@1'))
      .select('id', 'name');
    runtime.setNextResults([[ada], [ada], [{ id: 1 }], [ada]]);

    await rows.delete();
    await rows.update({ name: 'Grace' });

    expect(sent(runtime)).toEqual([
      'select users where <raw-expr> limit 1',
      'delete users where id = 1 returning id, name',
      'select users where <raw-expr> limit 1',
      'update users where id = 1 returning id, name',
    ]);
  });
});
