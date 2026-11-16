import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { MongoQueryExecutor, MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import {
  AggregateCommand,
  MongoAndExpr,
  MongoFieldFilter,
  MongoLimitStage,
  MongoMatchStage,
  MongoSkipStage,
} from '@internal/mongo-query-ast/execution';
import { MongoParamRef, MongoPreparedParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import type { Contract as OrmContract } from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import ormContractJson from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import { createMongoCollection } from '../src/collection';
import { collectionContext } from './collection-context';
import type { Contract as StoredNamesContract } from './fixtures/stored-names-contract';
import storedNamesContractJson from './fixtures/stored-names-contract.json';

const storedNamesContract = storedNamesContractJson as unknown as StoredNamesContract;
const ormContract = ormContractJson as unknown as OrmContract;

function recordingExecutor() {
  const plans: MongoQueryPlan[] = [];
  const executor: MongoQueryExecutor = {
    query<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row> {
      plans.push(plan as MongoQueryPlan);
      return new AsyncIterableResult((async function* (): AsyncGenerator<Row> {})());
    },
    async execute(plan: MongoQueryPlan) {
      plans.push(plan);
      return { affectedRows: 0 };
    },
  };
  return { executor, plans };
}

function rowsOf<Row>(rows: Row[]): AsyncIterableResult<Row> {
  return new AsyncIterableResult(
    (async function* (): AsyncGenerator<Row> {
      yield* rows;
    })(),
  );
}

function usersOf(executor: MongoQueryExecutor) {
  return createMongoCollection(collectionContext(storedNamesContract, executor), 'User');
}

function ormUsersOf(executor: MongoQueryExecutor) {
  return createMongoCollection(collectionContext(ormContract, executor), 'User');
}

const name = new MongoPreparedParamRef('name', 'mongo/string@1', false);
const email = new MongoPreparedParamRef('email', 'mongo/string@1', true);
const city = new MongoPreparedParamRef('city', 'mongo/string@1', false);
const take = new MongoPreparedParamRef('take', 'mongo/int32@1', false);
const skip = new MongoPreparedParamRef('skip', 'mongo/int32@1', false);

const placeholderRefused = (placeholder: MongoPreparedParamRef, field: string) => ({
  code: 'ORM.ARGUMENT_INVALID',
  meta: { name: placeholder.name, field },
});

describe('.prepared reads on a Mongo ORM collection', () => {
  it('all() describes the plan all() sends, and sends nothing', () => {
    const { executor, plans } = recordingExecutor();
    const users = usersOf(executor).where({ displayName: 'Ann' }).limit(5);

    const described = users.prepared.all();
    expect(plans).toEqual([]);
    void users.all();

    expect(described.plan).toEqual(plans[0]);
  });

  it('all() reads each document as a row of the model', async () => {
    const { executor } = recordingExecutor();
    const described = usersOf(executor).prepared.all();

    const rows = await described
      .consume(
        rowsOf([
          { _id: 'u1', display_name: 'Ann', email: null },
          { _id: 'u2', display_name: 'Bob', email: 'b@example.com' },
        ]),
      )
      .toArray();

    expect(rows).toEqual([
      { id: 'u1', displayName: 'Ann', email: null },
      { id: 'u2', displayName: 'Bob', email: 'b@example.com' },
    ]);
  });

  it('first() describes a read limited to one document', () => {
    const { executor } = recordingExecutor();
    const described = usersOf(executor).where({ displayName: name }).prepared.first();

    expect(described.plan.command).toEqual(
      new AggregateCommand('users', [
        new MongoMatchStage(MongoFieldFilter.eq('display_name', name)),
        new MongoLimitStage(1),
      ]),
    );
  });

  it('first() replaces a limit placeholder with 1', () => {
    const { executor } = recordingExecutor();
    const described = usersOf(executor).limit(take).prepared.first();

    expect(described.plan.command).toEqual(new AggregateCommand('users', [new MongoLimitStage(1)]));
  });

  it('first() reads the first document as a row, or null when there is none', async () => {
    const { executor } = recordingExecutor();
    const described = usersOf(executor).prepared.first();

    const results = {
      found: await described.consume(rowsOf([{ _id: 'u1', display_name: 'Ann' }])),
      missing: await described.consume(rowsOf([])),
    };

    expect(results).toEqual({ found: { id: 'u1', displayName: 'Ann' }, missing: null });
  });

  it('firstOrThrow() describes the plan firstOrThrow() sends, limited to one document', async () => {
    const { executor, plans } = recordingExecutor();
    const users = usersOf(executor).where({ displayName: name }).limit(take);

    const described = users.prepared.firstOrThrow();
    expect(plans).toEqual([]);
    await users.firstOrThrow().catch(() => undefined);

    expect({ described: described.plan, sent: plans }).toEqual({
      described: plans[0],
      sent: [
        expect.objectContaining({
          command: new AggregateCommand('users', [
            new MongoMatchStage(MongoFieldFilter.eq('display_name', name)),
            new MongoLimitStage(1),
          ]),
        }),
      ],
    });
  });

  it('firstOrThrow() reads the first document as a row', async () => {
    const { executor } = recordingExecutor();
    const described = usersOf(executor).prepared.firstOrThrow();

    const row = await described.consume(rowsOf([{ _id: 'u1', display_name: 'Ann' }]));

    expect(row).toEqual({ id: 'u1', displayName: 'Ann' });
  });

  it('firstOrThrow() rejects as the ad-hoc firstOrThrow() does when there is no document', async () => {
    const { executor } = recordingExecutor();
    const users = usersOf(executor);

    const prepared = await users.prepared
      .firstOrThrow()
      .consume(rowsOf([]))
      .catch((error: unknown) => error);
    const adHoc = await users.firstOrThrow().catch((error: unknown) => error);

    expect(prepared).toEqual(adHoc);
    expect(prepared).toMatchObject({ code: 'RUNTIME.NO_ROWS' });
  });
});

describe('ad-hoc first() and firstOrThrow()', () => {
  it.each(['first', 'firstOrThrow'] as const)(
    '%s() rejects, and does not throw, when the plan cannot be built',
    async (method) => {
      const { executor, plans } = recordingExecutor();
      const users = usersOf(executor).offset(-1);

      let result: Promise<unknown> | undefined;
      expect(() => {
        result = users[method]();
      }).not.toThrow();
      await expect(result).rejects.toMatchObject({ code: 'ORM.ARGUMENT_INVALID' });
      expect(plans).toEqual([]);
    },
  );
});

describe('a placeholder in an object-form where', () => {
  it('is kept as it is on a scalar field', () => {
    const { executor } = recordingExecutor();
    const described = usersOf(executor).where({ displayName: name, email }).prepared.all();

    expect(described.plan.command).toEqual(
      new AggregateCommand('users', [
        new MongoMatchStage(
          MongoAndExpr.of([
            MongoFieldFilter.eq('display_name', name),
            MongoFieldFilter.eq('email', email),
          ]),
        ),
      ]),
    );
  });

  it('on a list field, matches a list holding it', () => {
    const { executor } = recordingExecutor();
    const described = ormUsersOf(executor).where({ tags: name }).prepared.all();

    expect(described.plan.command).toEqual(
      new AggregateCommand('users', [
        new MongoMatchStage(MongoFieldFilter.of('tags', '$elemMatch', { $eq: name })),
      ]),
    );
  });

  it('is refused on a value-object field when the where is built', () => {
    const { executor } = recordingExecutor();
    const users = usersOf(executor);

    expect(() => users.where({ home: city as unknown as { city: string } })).toThrow(
      expect.objectContaining({
        ...placeholderRefused(city, 'home'),
        message:
          "A prepared parameter stands for one scalar value, so the prepared parameter 'city' cannot stand for the value object at 'home'.",
      }),
    );
  });
});

describe('a placeholder in a filter-expression where', () => {
  it('is kept as it is in a comparison on a scalar field', () => {
    const { executor } = recordingExecutor();
    const described = usersOf(executor)
      .where(MongoFieldFilter.eq('displayName', name))
      .where(MongoFieldFilter.of('email', '$ne', email))
      .prepared.all();

    expect(described.plan.command).toEqual(
      new AggregateCommand('users', [
        new MongoMatchStage(
          MongoAndExpr.of([
            MongoFieldFilter.eq('display_name', name),
            MongoFieldFilter.of('email', '$ne', email),
          ]),
        ),
      ]),
    );
  });

  it('is kept as it is in a membership list, beside encoded values', () => {
    const { executor } = recordingExecutor();
    const described = usersOf(executor)
      .where(MongoFieldFilter.in('displayName', [name, 'Bob']))
      .prepared.all();

    expect(described.plan.command).toEqual(
      new AggregateCommand('users', [
        new MongoMatchStage(
          MongoFieldFilter.in('display_name', [
            name,
            new MongoParamRef('Bob', {
              codecId: 'mongo/string@1',
              name: 'displayName',
              collection: 'users',
            }),
          ]),
        ),
      ]),
    );
  });

  it('is kept as it is on a scalar inside a value object', () => {
    const { executor } = recordingExecutor();
    const described = usersOf(executor)
      .where(MongoFieldFilter.eq('home.city', city))
      .prepared.all();

    expect(described.plan.command).toEqual(
      new AggregateCommand('users', [
        new MongoMatchStage(MongoFieldFilter.eq('home_address.city', city)),
      ]),
    );
  });

  it.each([
    [
      'a whole value object',
      'home',
      city,
      "A prepared parameter stands for one scalar value, so the prepared parameter 'city' cannot stand for the value object at 'home'.",
      'home',
    ],
    [
      'a path below a value object the contract does not know',
      'home.planet',
      city,
      "The contract has no field at 'home.planet', so the prepared parameter 'city' cannot be checked against a codec there.",
      'home.planet',
    ],
    [
      'a value nested in a value object',
      'home',
      { city },
      "The prepared parameter 'city' cannot be used for 'home'. A prepared parameter stands for one value in a read: a value compared with a scalar field in a where (an equality, a comparison, or an item of $in or $nin), a limit or an offset.",
      'home',
    ],
    [
      'an array given for a single value object',
      'home',
      [city],
      "A prepared parameter stands for one scalar value, so the prepared parameter 'city' cannot stand for the value object at 'home'.",
      'home',
    ],
    [
      'a path through an embed relation',
      'addresses.city',
      { city },
      "The prepared parameter 'city' cannot be used for 'addresses.city'. A prepared parameter stands for one value in a read: a value compared with a scalar field in a where (an equality, a comparison, or an item of $in or $nin), a limit or an offset.",
      'addresses.city',
    ],
  ])('is refused on %s when the where is built', (_label, path, value, message, field) => {
    const { executor } = recordingExecutor();
    const users = usersOf(executor);

    expect(() => users.where(MongoFieldFilter.eq(path, value))).toThrow(
      expect.objectContaining({ ...placeholderRefused(city, field), message }),
    );
  });
});

const objectId = new MongoPreparedParamRef('objectId', 'mongo/objectId@1', false);
const nullableName = new MongoPreparedParamRef('nullableName', 'mongo/string@1', true);

const codecMismatch = (
  placeholder: MongoPreparedParamRef,
  field: string,
  fieldCodecId: string,
) => ({
  code: 'ORM.ARGUMENT_INVALID',
  message: `The prepared parameter '${placeholder.name}' has codec '${placeholder.codecId}', but the field '${field}' has codec '${fieldCodecId}'.`,
  meta: { name: placeholder.name, field, codecId: placeholder.codecId, fieldCodecId },
});

const nullableOnField = (placeholder: MongoPreparedParamRef, field: string, list: boolean) => ({
  code: 'ORM.ARGUMENT_INVALID',
  message: list
    ? `The prepared parameter '${placeholder.name}' is nullable, but the field '${field}' is a list, where a parameter stands for one item, which is never null.`
    : `The prepared parameter '${placeholder.name}' is nullable, but the field '${field}' is not.`,
  meta: { name: placeholder.name, field, nullable: true, list },
});

describe('the codec of a placeholder in a where', () => {
  it.each([
    ['object form', { displayName: objectId }],
    ['filter expression', MongoFieldFilter.eq('displayName', objectId)],
  ])('must be the field codec, in the %s', (_label, filter) => {
    const { executor } = recordingExecutor();
    const users = usersOf(executor);

    expect(() => users.where(filter as never)).toThrow(
      expect.objectContaining(codecMismatch(objectId, 'displayName', 'mongo/string@1')),
    );
  });

  it('must be the field codec on a scalar inside a value object', () => {
    const { executor } = recordingExecutor();
    const users = usersOf(executor);

    expect(() => users.where(MongoFieldFilter.eq('home.city', objectId))).toThrow(
      expect.objectContaining(codecMismatch(objectId, 'home.city', 'mongo/string@1')),
    );
  });

  it('must be the field codec for each element of a membership list', () => {
    const { executor } = recordingExecutor();
    const users = usersOf(executor);

    expect(() => users.where(MongoFieldFilter.in('displayName', [name, objectId]))).toThrow(
      expect.objectContaining(codecMismatch(objectId, 'displayName', 'mongo/string@1')),
    );
  });

  it.each([
    ['object form', { tags: objectId }],
    ['filter expression', MongoFieldFilter.eq('tags', objectId)],
  ])('must be the element codec on a list field, in the %s', (_label, filter) => {
    const { executor } = recordingExecutor();
    const users = ormUsersOf(executor);

    expect(() => users.where(filter as never)).toThrow(
      expect.objectContaining(codecMismatch(objectId, 'tags', 'mongo/string@1')),
    );
  });

  it.each([
    ['object form', { displayName: nullableName }],
    ['filter expression', MongoFieldFilter.eq('displayName', nullableName)],
    ['membership list', MongoFieldFilter.in('displayName', [nullableName])],
  ])('may be nullable only on a nullable field, in the %s', (_label, filter) => {
    const { executor } = recordingExecutor();
    const users = usersOf(executor);

    expect(() => users.where(filter as never)).toThrow(
      expect.objectContaining(nullableOnField(nullableName, 'displayName', false)),
    );
  });

  it.each([
    ['object form', { tags: nullableName }],
    ['filter expression', MongoFieldFilter.eq('tags', nullableName)],
    ['membership list', MongoFieldFilter.in('tags', [nullableName])],
  ])('is never nullable on a list field, in the %s', (_label, filter) => {
    const { executor } = recordingExecutor();
    const users = ormUsersOf(executor);

    expect(() => users.where(filter as never)).toThrow(
      expect.objectContaining(nullableOnField(nullableName, 'tags', true)),
    );
  });

  it('may be nullable on a nullable field, in both forms', () => {
    const { executor } = recordingExecutor();
    const described = usersOf(executor)
      .where({ email: nullableName })
      .where(MongoFieldFilter.eq('email', nullableName))
      .prepared.all();

    expect(described.plan.command).toEqual(
      new AggregateCommand('users', [
        new MongoMatchStage(
          MongoAndExpr.of([
            MongoFieldFilter.eq('email', nullableName),
            MongoFieldFilter.eq('email', nullableName),
          ]),
        ),
      ]),
    );
  });
});

describe('a placeholder in limit and offset', () => {
  it('is kept as it is in the $skip and $limit stages', () => {
    const { executor } = recordingExecutor();
    const described = usersOf(executor).offset(skip).limit(take).prepared.all();

    expect(described.plan.command).toEqual(
      new AggregateCommand('users', [new MongoSkipStage(skip), new MongoLimitStage(take)]),
    );
  });
});
