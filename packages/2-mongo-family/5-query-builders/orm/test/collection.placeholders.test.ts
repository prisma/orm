import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { MongoQueryExecutor, MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import { MongoFieldFilter, MongoOrExpr } from '@internal/mongo-query-ast/execution';
import { MongoPreparedParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import ormContractJson from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import { createMongoCollection } from '../src/collection';
import { collectionContext } from './collection-context';

const contract = ormContractJson as unknown as Contract;

function recordingExecutor() {
  const plans: MongoQueryPlan[] = [];
  const executor: MongoQueryExecutor = {
    query<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row> {
      plans.push(plan as MongoQueryPlan);
      async function* gen(): AsyncGenerator<Row> {
        yield { _id: 'id-1', insertedId: 'id-1' } as Row;
      }
      return new AsyncIterableResult(gen());
    },
    async execute(plan: MongoQueryPlan) {
      plans.push(plan);
      return { affectedRows: 1 };
    },
  };
  return { executor, plans };
}

const placeholder = new MongoPreparedParamRef('value', 'mongo/string@1', false);
const valueRefused = (field: string) => ({
  code: 'ORM.ARGUMENT_INVALID',
  message: `The prepared parameter 'value' cannot be used for '${field}'. ORM writes run at once, and a value-object literal is built with the query, so neither can take a prepared parameter. In a read, compare the scalar field with it directly in a filter expression, such as where(MongoFieldFilter.eq('${field}', ...)).`,
  meta: { name: 'value', field },
});

const refused = {
  code: 'ORM.ARGUMENT_INVALID',
  meta: { name: 'value', field: expect.any(String) },
};

describe('a prepared placeholder in the Mongo ORM', () => {
  it('is refused in an object-form write, and nothing is sent', async () => {
    const { executor, plans } = recordingExecutor();
    const users = createMongoCollection(collectionContext(contract, executor), 'User');

    await expect(
      users.create({
        name: placeholder as unknown as string,
        email: 'a@b.c',
        loginCount: 0,
        tags: [],
        homeAddress: null,
      }),
    ).rejects.toMatchObject(valueRefused('name'));
    expect(plans).toEqual([]);
  });

  it('is refused as a top-level scalar field in an object-form update, though a where accepts one there', async () => {
    const { executor, plans } = recordingExecutor();
    const users = createMongoCollection(collectionContext(contract, executor), 'User');
    const name = placeholder as unknown as string;

    await expect(users.where({ email: 'a@b.c' }).update({ name })).rejects.toMatchObject({
      code: 'ORM.ARGUMENT_INVALID',
      meta: { name: 'value', field: 'name' },
    });
    expect(plans).toEqual([]);
  });

  it('is refused in a callback-form update, and nothing is sent', async () => {
    const { executor, plans } = recordingExecutor();
    const users = createMongoCollection(collectionContext(contract, executor), 'User');

    await expect(
      users
        .where({ email: 'a@b.c' })
        .update((u) => [u.tags.push(placeholder as unknown as string)]),
    ).rejects.toMatchObject(refused);
    expect(plans).toEqual([]);
  });

  it('is refused in a value-object literal by the where call itself', () => {
    const { executor, plans } = recordingExecutor();
    const users = createMongoCollection(collectionContext(contract, executor), 'User');

    expect(() =>
      users.where({ homeAddress: { city: placeholder as unknown as string, country: 'FR' } }),
    ).toThrow(expect.objectContaining(valueRefused('homeAddress.city')));
    expect(plans).toEqual([]);
  });

  const newUser = { name: 'Ann', email: 'a@b.c', loginCount: 0, tags: [], homeAddress: null };

  it('is refused as a whole value object in a write, and nothing is sent', async () => {
    const { executor, plans } = recordingExecutor();
    const users = createMongoCollection(collectionContext(contract, executor), 'User');
    const homeAddress = placeholder as unknown as { city: string; country: string };

    await expect(users.create({ ...newUser, homeAddress })).rejects.toMatchObject(refused);
    await expect(users.where({ email: 'a@b.c' }).update({ homeAddress })).rejects.toMatchObject(
      refused,
    );
    expect(plans).toEqual([]);
  });

  it('is refused in an embedded row, and nothing is sent', async () => {
    const { executor, plans } = recordingExecutor();
    const tasks = createMongoCollection(collectionContext(contract, executor), 'Task');

    await expect(
      tasks.variant('bug').create({
        title: 'Crash',
        assigneeId: 'a1',
        severity: 'high',
        comments: [{ _id: 'c1', text: placeholder as unknown as string, createdAt: new Date() }],
      }),
    ).rejects.toMatchObject(refused);
    expect(plans).toEqual([]);
  });

  it.each([
    ['as a value', placeholder],
    ['nested in an object', { inner: { deep: placeholder } }],
    ['nested in an array', [1, [placeholder]]],
  ])(
    'is refused in a value-object key the contract does not have, %s, and nothing is sent',
    async (_label, value) => {
      const { executor, plans } = recordingExecutor();
      const users = createMongoCollection(collectionContext(contract, executor), 'User');
      const homeAddress = { city: 'Paris', country: 'FR', extra: value } as unknown as {
        city: string;
        country: string;
      };

      await expect(users.create({ ...newUser, homeAddress })).rejects.toMatchObject(refused);
      await expect(users.where({ email: 'a@b.c' }).update({ homeAddress })).rejects.toMatchObject(
        refused,
      );
      await expect(
        users.where({ email: 'a@b.c' }).update((u) => [u.homeAddress.set(homeAddress)]),
      ).rejects.toMatchObject(refused);
      expect(plans).toEqual([]);
    },
  );

  it('is refused in an operator the ORM does not encode with a codec', async () => {
    const { executor, plans } = recordingExecutor();
    const users = createMongoCollection(collectionContext(contract, executor), 'User');

    await expect(
      users
        .where({ email: 'a@b.c' })
        .update((u) => [u.loginCount.inc(placeholder as unknown as number)]),
    ).rejects.toMatchObject(refused);
    expect(plans).toEqual([]);
  });

  describe('in a where followed by a write', () => {
    const name = placeholder as unknown as string;
    const usersOf = (executor: MongoQueryExecutor) =>
      createMongoCollection(collectionContext(contract, executor), 'User');

    it.each<[string, string, (users: ReturnType<typeof usersOf>) => Promise<unknown>]>([
      ['update', 'update', (users) => users.where({ name }).update({ loginCount: 1 })],
      [
        'updateAll',
        'updateAll',
        async (users) => users.where({ name }).updateAll({ loginCount: 1 }).toArray(),
      ],
      [
        'updateAndCount',
        'updateAndCount',
        (users) => users.where({ name }).updateAndCount({ loginCount: 1 }),
      ],
      ['delete', 'delete', (users) => users.where({ name }).delete()],
      ['deleteAll', 'deleteAll', async (users) => users.where({ name }).deleteAll().toArray()],
      ['deleteAndCount', 'deleteAndCount', (users) => users.where({ name }).deleteAndCount()],
      [
        'upsert',
        'upsert',
        (users) =>
          users.where({ name }).upsert({
            create: { name: 'Ann', email: 'a@b.c', loginCount: 0, tags: [], homeAddress: null },
            update: { loginCount: 1 },
          }),
      ],
      [
        'a write after a filter expression',
        'deleteAndCount',
        (users) =>
          users.where(MongoOrExpr.of([MongoFieldFilter.eq('email', placeholder)])).deleteAndCount(),
      ],
    ])('is refused by %s when it is called, and nothing is sent', async (_label, method, write) => {
      const { executor, plans } = recordingExecutor();

      await expect((async () => write(usersOf(executor)))()).rejects.toMatchObject({
        code: 'ORM.ARGUMENT_INVALID',
        message: `${method}() cannot run because the collection's where holds the prepared parameter 'value'. ORM writes run at once and cannot be prepared; use a prepared parameter only with .prepared.all(), .prepared.first() or .prepared.firstOrThrow().`,
        meta: { name: 'value', method },
      });
      expect(plans).toEqual([]);
    });
  });
});
