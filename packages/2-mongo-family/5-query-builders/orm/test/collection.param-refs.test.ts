import { AsyncIterableResult } from '@internal/framework-components/runtime';
import {
  MongoAndExpr,
  MongoFieldFilter,
  type MongoQueryPlan,
} from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import ormContractJson from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import { createMongoCollection } from '../src/collection';
import type { MongoQueryExecutor } from '../src/executor';

const contract = ormContractJson as unknown as Contract;

const user = {
  name: 'Alice',
  email: 'a@b.c',
  loginCount: 0,
  tags: ['x'],
  homeAddress: { city: 'Paris', country: 'FR' },
};

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

function paramRefs(value: unknown): MongoParamRef[] {
  if (value instanceof MongoParamRef) return [value];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(paramRefs);
}

function labels(plans: readonly MongoQueryPlan[]) {
  return plans
    .flatMap((plan) => paramRefs(plan.command))
    .map(({ name, collection, codecId }) => ({ name, collection, codecId }));
}

const string = 'mongo/string@1';
const withoutCodec = { name: undefined, collection: undefined, codecId: undefined };

describe('parameters the Mongo ORM builds', () => {
  it('name each field of a create by its path, nested value-object fields included', async () => {
    const { executor, plans } = recordingExecutor();
    await createMongoCollection(contract, 'User', executor).create(user);

    expect(labels(plans)).toEqual([
      { name: 'name', collection: 'users', codecId: string },
      { name: 'email', collection: 'users', codecId: string },
      { name: 'loginCount', collection: 'users', codecId: 'mongo/int32@1' },
      { name: 'tags.0', collection: 'users', codecId: string },
      { name: 'homeAddress.city', collection: 'users', codecId: string },
      { name: 'homeAddress.country', collection: 'users', codecId: string },
    ]);
  });

  it('name the fields of a where filter and a delete filter', async () => {
    const { executor, plans } = recordingExecutor();
    const users = createMongoCollection(contract, 'User', executor);
    await users.where({ email: 'a@b.c' }).all().toArray();
    await users.where({ name: 'Alice' }).delete();

    expect(labels(plans)).toEqual([
      { name: 'email', collection: 'users', codecId: string },
      { name: 'name', collection: 'users', codecId: string },
    ]);
  });

  it('name the fields of $set, $inc, $push and a dot-path $set', async () => {
    const { executor, plans } = recordingExecutor();
    await createMongoCollection(contract, 'User', executor)
      .where({ email: 'a@b.c' })
      .update((u) => [
        u.name.set('Bob'),
        u.loginCount.inc(1),
        u.tags.push('y'),
        u('homeAddress.city').set('Lyon'),
      ]);

    expect(labels(plans)).toEqual([
      { name: 'email', collection: 'users', codecId: string },
      { name: 'name', collection: 'users', codecId: string },
      { name: 'homeAddress.city', collection: 'users', codecId: string },
      { name: 'loginCount', collection: 'users', codecId: 'mongo/int32@1' },
      { name: 'tags', collection: 'users', codecId: string },
    ]);
  });

  it('name the fields of an upsert, in both $set and $setOnInsert', async () => {
    const { executor, plans } = recordingExecutor();
    await createMongoCollection(contract, 'User', executor)
      .where({ email: 'a@b.c' })
      .upsert({ create: user, update: { name: 'Bob' } });

    const command = plans[0]?.command;
    const update = command?.kind === 'findOneAndUpdate' ? command.update : undefined;
    const namesIn = (operator: string) =>
      paramRefs(Reflect.get(update ?? {}, operator)).map(({ name, collection }) => ({
        name,
        collection,
      }));
    expect(namesIn('$set')).toEqual([{ name: 'name', collection: 'users' }]);
    expect(namesIn('$setOnInsert')).toEqual([
      { name: 'email', collection: 'users' },
      { name: 'loginCount', collection: 'users' },
      { name: 'tags.0', collection: 'users' },
      { name: 'homeAddress.city', collection: 'users' },
      { name: 'homeAddress.country', collection: 'users' },
    ]);
  });

  it('name the base fields and the discriminator of a variant create', async () => {
    const { executor, plans } = recordingExecutor();
    await createMongoCollection(contract, 'Task', executor)
      .variant('Bug')
      .create({ title: 'Crash', assigneeId: 'a1', severity: 'high', comments: [] });

    expect(labels(plans)).toEqual([
      { name: 'title', collection: 'tasks', codecId: string },
      { name: 'assigneeId', collection: 'tasks', codecId: 'mongo/objectId@1' },
      { name: 'severity', collection: 'tasks', codecId: string },
      withoutCodec,
      { name: 'type', collection: 'tasks', codecId: string },
    ]);
  });

  it('encode the values of a filter expression through the codec of the field it names', async () => {
    const { executor, plans } = recordingExecutor();
    await createMongoCollection(contract, 'User', executor)
      .where(
        MongoAndExpr.of([
          MongoFieldFilter.eq('_id', '65f0000000000000000000ab'),
          MongoFieldFilter.in('loginCount', [1, new MongoParamRef(2)]),
          MongoFieldFilter.gt('homeAddress.city', 'L'),
        ]),
      )
      .all()
      .toArray();

    expect(labels(plans)).toEqual([
      { name: '_id', collection: 'users', codecId: 'mongo/objectId@1' },
      { name: 'loginCount', collection: 'users', codecId: 'mongo/int32@1' },
      { name: 'loginCount', collection: 'users', codecId: 'mongo/int32@1' },
      { name: 'homeAddress.city', collection: 'users', codecId: string },
    ]);
  });

  it('encode each element of a whole-list comparison once, wrapped or not', async () => {
    const { executor, plans } = recordingExecutor();
    await createMongoCollection(contract, 'User', executor)
      .where(MongoFieldFilter.eq('tags', [new MongoParamRef('x'), 'y']))
      .all()
      .toArray();

    const refs = plans.flatMap((plan) => paramRefs(plan.command));
    expect(refs.map(({ value, codecId }) => ({ value, codecId }))).toEqual([
      { value: 'x', codecId: string },
      { value: 'y', codecId: string },
    ]);
  });
});

describe('null in the Mongo ORM', () => {
  it('is refused for a required field on create and update, naming the field', async () => {
    const { executor, plans } = recordingExecutor();
    const users = createMongoCollection(contract, 'User', executor);
    const refused = {
      code: 'RUNTIME.ENCODE_FAILED',
      message:
        "Failed to encode field loginCount in collection 'users': the field is required and cannot be null",
      details: { label: 'loginCount', collection: 'users' },
    };

    await expect(users.create({ ...user, loginCount: null as never })).rejects.toMatchObject(
      refused,
    );
    await expect(
      users.where({ email: 'a@b.c' }).update({ loginCount: null as never }),
    ).rejects.toMatchObject(refused);
    await expect(
      users.where({ email: 'a@b.c' }).update((u) => [u.loginCount.set(null as never)]),
    ).rejects.toMatchObject(refused);
    expect(plans).toEqual([]);
  });

  it('is written without a codec to a nullable field and compared without one in a filter', async () => {
    const { executor, plans } = recordingExecutor();
    const users = createMongoCollection(contract, 'User', executor);
    await users.create({ ...user, homeAddress: null });
    await users
      .where({ loginCount: null as never })
      .all()
      .toArray();
    await users.where(MongoFieldFilter.eq('loginCount', null)).all().toArray();

    expect(labels(plans)).toEqual([
      { name: 'name', collection: 'users', codecId: string },
      { name: 'email', collection: 'users', codecId: string },
      { name: 'loginCount', collection: 'users', codecId: 'mongo/int32@1' },
      { name: 'tags.0', collection: 'users', codecId: string },
    ]);
    expect(plans[0]?.command).toMatchObject({ document: { homeAddress: null } });
    for (const plan of plans.slice(1)) {
      expect(plan.command).toMatchObject({
        pipeline: [{ filter: { field: 'loginCount', value: null } }],
      });
    }
  });
});
