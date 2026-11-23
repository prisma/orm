import { describe, expect, it } from 'vitest';
import { createCollectionFor, withReturningCapability } from '../collection-fixtures';
import { buildMixedPolyContract } from '../helpers';
import { sent } from './sent-statements';

function selectedUsers() {
  const { collection, runtime } = createCollectionFor('User');
  return { users: collection.select('id', 'name'), runtime };
}

type Users = ReturnType<typeof selectedUsers>['users'];

const postsTitled =
  "exists (select user_id from posts where (user_id = users.id and title = 'Hello'))";

const filters = [
  {
    name: 'two where() calls',
    apply: (users: Users) => users.where({ name: 'Ada' }).where({ email: 'ada@example.com' }),
    condition: "(name = 'Ada' and email = 'ada@example.com')",
  },
  {
    name: 'three where() calls',
    apply: (users: Users) =>
      users
        .where({ name: 'Ada' })
        .where({ email: 'ada@example.com' })
        .where((user) => user.id.gt(0)),
    condition: "(name = 'Ada' and email = 'ada@example.com' and id > 0)",
  },
  {
    name: 'a relation filter and a second where() call',
    apply: (users: Users) =>
      users
        .where((user) => user.posts.some((post) => post.title.eq('Hello')))
        .where({
          name: 'Ada',
        }),
    condition: `(${postsTitled} and name = 'Ada')`,
  },
] as const;

describe.each(filters)(
  'bulk writes on a database with RETURNING, after $name',
  ({ apply, condition }) => {
    it('deleteAll() sends one DELETE that returns the selected columns', async () => {
      const { users, runtime } = selectedUsers();

      await apply(users).deleteAll().toArray();

      expect(sent(runtime)).toEqual([`delete users where ${condition} returning id, name`]);
    });

    it('updateAll() sends one UPDATE that returns the selected columns', async () => {
      const { users, runtime } = selectedUsers();

      await apply(users).updateAll({ name: 'Grace' }).toArray();

      expect(sent(runtime)).toEqual([`update users where ${condition} returning id, name`]);
    });

    it('deleteAndCount() and updateAndCount() send one statement each', async () => {
      const { users, runtime } = selectedUsers();

      await apply(users).deleteAndCount();
      await apply(users).updateAndCount({ name: 'Grace' });

      expect(sent(runtime)).toEqual([
        `delete users where ${condition}`,
        `update users where ${condition}`,
      ]);
    });
  },
);

const featureCondition =
  "exists (select id from tasks tasks_2 inner join features on tasks_2.id = features.id where (id = tasks.id and tasks.type = 'feature' and tasks.title = 'Crash'))";

describe('bulk writes of a variant in its own table, on a database with RETURNING', () => {
  function features() {
    const { collection, runtime } = createCollectionFor(
      'Task' as never,
      withReturningCapability(buildMixedPolyContract()),
    );
    runtime.setNextResults([[{ id: 1 }], [{ id: 1 }]]);
    return {
      features: collection.variant('feature' as never).where({ title: 'Crash' } as never),
      runtime,
    };
  }

  it('updateAll() sends one UPDATE that returns the keys, then reads the rows back with the variant join', async () => {
    const { features: rows, runtime } = features();

    await rows.updateAll({ title: 'Crash!' } as never).toArray();

    expect(sent(runtime)).toEqual([
      `update tasks where ${featureCondition} returning id`,
      'select tasks inner join features where id = 1',
    ]);
  });

  it('deleteAll() reads the rows with the variant join, then deletes the rows it read by key', async () => {
    const { features: rows, runtime } = features();

    await rows.deleteAll().toArray();

    expect(sent(runtime)).toEqual([
      `select tasks inner join features where ${featureCondition}`,
      `delete tasks where (${featureCondition} and id = 1)`,
    ]);
  });
});
