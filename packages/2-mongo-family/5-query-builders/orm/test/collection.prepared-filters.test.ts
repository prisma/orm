import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type {
  MongoFilterExpr,
  MongoQueryExecutor,
  MongoQueryPlan,
} from '@internal/mongo-query-ast/execution';
import {
  AggregateCommand,
  MongoAggFieldRef,
  MongoAggLiteral,
  MongoAggOperator,
  MongoAndExpr,
  MongoExprFilter,
  MongoFieldFilter,
  MongoMatchStage,
  MongoNotExpr,
  MongoOrExpr,
} from '@internal/mongo-query-ast/execution';
import { MongoParamRef, MongoPreparedParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import ormContractJson from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import { createMongoCollection } from '../src/collection';
import { collectionContext } from './collection-context';

const contract = ormContractJson as unknown as Contract;

const executor: MongoQueryExecutor = {
  query<Row>(_plan: MongoQueryPlan<Row>): AsyncIterableResult<Row> {
    return new AsyncIterableResult((async function* (): AsyncGenerator<Row> {})());
  },
  async execute() {
    return { affectedRows: 0 };
  },
};

function users() {
  return createMongoCollection(collectionContext(contract, executor), 'User');
}

const text = new MongoPreparedParamRef('text', 'mongo/string@1', false);
const count = new MongoPreparedParamRef('count', 'mongo/int32@1', false);

const refused = (placeholder: MongoPreparedParamRef, field: string) => ({
  code: 'ORM.ARGUMENT_INVALID',
  meta: { name: placeholder.name, field },
});

const refusedInExpr = (placeholder: MongoPreparedParamRef) => ({
  code: 'ORM.ARGUMENT_INVALID',
  message: `The prepared parameter '${placeholder.name}' cannot be used inside $expr. A prepared parameter stands for one value in a read: a value compared with a scalar field in a where (an equality, a comparison, or an item of $in or $nin), a limit or an offset.`,
  meta: { name: placeholder.name, operator: '$expr' },
});

const placeholderInExpr = MongoExprFilter.of(
  MongoAggOperator.of('$eq', [MongoAggFieldRef.of('name'), MongoAggLiteral.of(text)]),
);

describe('a placeholder in a filter-expression where', () => {
  it.each<[string, MongoFilterExpr, MongoPreparedParamRef, string]>([
    ['$type', MongoFieldFilter.of('name', '$type', text), text, 'name'],
    ['$regex', MongoFieldFilter.of('name', '$regex', text), text, 'name'],
    ['$exists', MongoFieldFilter.of('name', '$exists', text), text, 'name'],
    ['$size', MongoFieldFilter.of('tags', '$size', count), count, 'tags'],
    ['$elemMatch', MongoFieldFilter.of('tags', '$elemMatch', { $eq: text }), text, 'tags'],
    ['$in whose value is not a list', MongoFieldFilter.of('name', '$in', text), text, 'name'],
    ['$nin whose value is not a list', MongoFieldFilter.of('name', '$nin', text), text, 'name'],
    [
      'a parameter that wraps it',
      MongoFieldFilter.eq('name', new MongoParamRef(text, { codecId: 'mongo/string@1' })),
      text,
      'name',
    ],
  ])('is refused in %s when the where is built', (_label, filter, placeholder, field) => {
    expect(() => users().where(filter)).toThrow(
      expect.objectContaining(refused(placeholder, field)),
    );
  });

  it.each<[string, MongoFilterExpr]>([
    ['an $expr literal', MongoExprFilter.of(MongoAggLiteral.of(text))],
    ['an $expr operator argument', placeholderInExpr],
  ])('is refused in %s when the where is built, naming $expr', (_label, filter) => {
    expect(() => users().where(filter)).toThrow(expect.objectContaining(refusedInExpr(text)));
  });

  it.each<[string, (inner: MongoFilterExpr) => MongoFilterExpr]>([
    ['$and', (inner) => MongoAndExpr.of([MongoFieldFilter.eq('email', 'a@b.c'), inner])],
    ['$or', (inner) => MongoOrExpr.of([MongoFieldFilter.eq('email', 'a@b.c'), inner])],
    ['$not', (inner) => new MongoNotExpr(inner)],
  ])('is refused the same way under %s', (_label, nest) => {
    for (const inner of [MongoFieldFilter.of('name', '$type', text), placeholderInExpr]) {
      expect(() => users().where(nest(inner))).toThrow(
        expect.objectContaining({ code: 'ORM.ARGUMENT_INVALID' }),
      );
    }
  });

  it('is kept as a comparison operand under $or and $not', () => {
    const described = users()
      .where(
        MongoOrExpr.of([
          MongoFieldFilter.eq('name', text),
          new MongoNotExpr(MongoFieldFilter.of('name', '$gt', text)),
        ]),
      )
      .prepared.all();

    expect(described.plan.command).toEqual(
      new AggregateCommand('users', [
        new MongoMatchStage(
          MongoOrExpr.of([
            MongoFieldFilter.eq('name', text),
            new MongoNotExpr(MongoFieldFilter.of('name', '$gt', text)),
          ]),
        ),
      ]),
    );
  });

  it('is refused with ORM.FIELD_UNKNOWN when the first segment is not a field, as any value is', () => {
    expect(() => users().where(MongoFieldFilter.eq('planet', text))).toThrow(
      expect.objectContaining({
        code: 'ORM.FIELD_UNKNOWN',
        meta: { model: 'User', field: 'planet' },
      }),
    );
  });

  it('is refused with ORM.ARGUMENT_INVALID on a path below a value object that the contract does not know', () => {
    expect(() => users().where(MongoFieldFilter.eq('homeAddress.planet', text))).toThrow(
      expect.objectContaining({
        ...refused(text, 'homeAddress.planet'),
        message:
          "The contract has no field at 'homeAddress.planet', so the prepared parameter 'text' cannot be checked against a codec there.",
      }),
    );
  });
});

describe('a list holding a placeholder', () => {
  const listRefused = (field: string) => ({
    code: 'ORM.ARGUMENT_INVALID',
    message: `The list given for '${field}' holds the prepared parameter 'text'. A declaration has no list form, so a prepared parameter cannot be part of a list; on a list field, one prepared parameter matches one item.`,
    meta: { name: 'text', field },
  });

  it('is refused in an object-form where, naming the list field', () => {
    expect(() => users().where({ tags: [text as unknown as string] })).toThrow(
      expect.objectContaining(listRefused('tags')),
    );
  });

  it('is refused in a mixed list in a filter-expression equality, naming the list field', () => {
    expect(() => users().where(MongoFieldFilter.eq('tags', [text, 'x']))).toThrow(
      expect.objectContaining(listRefused('tags')),
    );
  });
});
