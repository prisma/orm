import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { MongoQueryExecutor, MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import ormContractJson from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import { createMongoCollection } from '../src/collection';
import { collectionContext } from './collection-context';

const contract = ormContractJson as unknown as Contract;

function executorReturning(documents: readonly Record<string, unknown>[]) {
  const plans: MongoQueryPlan[] = [];
  const executor: MongoQueryExecutor = {
    query<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row> {
      plans.push(plan as MongoQueryPlan);
      return new AsyncIterableResult(
        (async function* (): AsyncGenerator<Row> {
          yield* documents as Row[];
        })(),
      );
    },
    async execute() {
      return { affectedRows: 0 };
    },
  };
  return { executor, plans };
}

function collectionsOf(executor: MongoQueryExecutor) {
  const context = collectionContext(contract, executor);
  return {
    users: createMongoCollection(context, 'User'),
    tasks: createMongoCollection(context, 'Task'),
  };
}

type Collections = ReturnType<typeof collectionsOf>;

describe('the plan .prepared.all() describes', () => {
  it.each<[string, (collections: Collections) => Collections['users'] | Collections['tasks']]>([
    ['a plain read', ({ users }) => users],
    ['an include', ({ users }) => users.include('tasks')],
    ['a select', ({ users }) => users.select('name', 'email')],
    ['an orderBy', ({ users }) => users.orderBy({ name: -1 })],
    ['an offset', ({ users }) => users.offset(2)],
    ['a variant', ({ tasks }) => tasks.variant('bug')],
    [
      'an include, select, orderBy, offset and limit together',
      ({ users }) => users.include('tasks').select('name').orderBy({ name: 1 }).offset(1).limit(3),
    ],
    [
      'a variant with a where, select and orderBy',
      ({ tasks }) =>
        tasks.variant('bug').where({ title: 'Crash' }).select('title').orderBy({ title: 1 }),
    ],
  ])('equals the plan all() sends, for %s', async (_label, build) => {
    const { executor, plans } = executorReturning([]);
    const collection = build(collectionsOf(executor));

    const described = collection.prepared.all().plan;
    await collection.all().toArray();

    expect(plans).toEqual([described]);
  });
});

describe('consume on a read with an include', () => {
  it('maps rows and their included documents as all() does', async () => {
    const documents = [
      {
        _id: 'u1',
        name: 'Ann',
        email: 'ann@example.com',
        loginCount: 1,
        tags: ['admin'],
        homeAddress: null,
        tasks: [{ _id: 't1', title: 'Crash', type: 'bug', assigneeId: 'u1', severity: 'high' }],
      },
    ];
    const { executor } = executorReturning(documents);
    const withTasks = collectionsOf(executor).users.include('tasks');

    const consumed = await withTasks.prepared
      .all()
      .consume(executorReturning(documents).executor.query(withTasks.prepared.all().plan))
      .toArray();
    const adHoc = await withTasks.all().toArray();

    expect(consumed).toEqual(adHoc);
    expect(consumed).toEqual([
      {
        _id: 'u1',
        name: 'Ann',
        email: 'ann@example.com',
        loginCount: 1,
        tags: ['admin'],
        homeAddress: null,
        tasks: [{ _id: 't1', title: 'Crash', type: 'bug', assigneeId: 'u1', severity: 'high' }],
      },
    ]);
  });
});
