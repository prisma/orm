import { MongoFieldFilter, type MongoMatchStage } from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import { acc } from '../src/accumulator-helpers';
import { mongoQuery } from '../src/query';
import { contextOf } from './fixtures/test-context';
import { testContract } from './fixtures/test-contract';

const orders = () => mongoQuery({ context: contextOf(testContract) }).from('orders');

const param = (value: unknown, codecId: string, name: string) =>
  new MongoParamRef(value, { codecId, name, collection: 'orders' });

function filterOf(stage: unknown) {
  return (stage as MongoMatchStage).filter;
}

describe('a match value on a model field', () => {
  it('is encoded through the field codec, as an ORM filter value is', () => {
    const plan = orders()
      .match((f) => f.status.eq('active'))
      .build();
    expect(filterOf(plan.command.pipeline[0])).toEqual(
      MongoFieldFilter.eq('status', param('active', 'mongo/string@1', 'status')),
    );
  });

  it('encodes each value of $in and $nin, and each comparison', () => {
    const filters = [
      orders().match((f) => f.amount.in([1, 2])),
      orders().match((f) => f.amount.nin([3])),
      orders().match((f) => f.amount.gte(4)),
      orders().match((f) => f.amount.lt(5)),
    ].map((chain) => filterOf(chain.build().command.pipeline[0]));
    expect(filters).toEqual([
      MongoFieldFilter.in('amount', [
        param(1, 'mongo/double@1', 'amount'),
        param(2, 'mongo/double@1', 'amount'),
      ]),
      MongoFieldFilter.nin('amount', [param(3, 'mongo/double@1', 'amount')]),
      MongoFieldFilter.gte('amount', param(4, 'mongo/double@1', 'amount')),
      MongoFieldFilter.lt('amount', param(5, 'mongo/double@1', 'amount')),
    ]);
  });

  it('encodes a list field value element by element, and leaves null as it is', () => {
    const filters = [
      orders().match((f) => f.tags.eq(['a', 'b'])),
      orders().match((f) => f.tags.eq('a')),
      orders().match((f) => f.notes.eq(null)),
    ].map((chain) => filterOf(chain.build().command.pipeline[0]));
    expect(filters).toEqual([
      MongoFieldFilter.eq('tags', [
        param('a', 'mongo/string@1', 'tags'),
        param('b', 'mongo/string@1', 'tags'),
      ]),
      MongoFieldFilter.eq('tags', param('a', 'mongo/string@1', 'tags')),
      MongoFieldFilter.eq('notes', null),
    ]);
  });

  it('is encoded after a stage that keeps the documents, and not after one that reshapes them', () => {
    const kept = orders()
      .sort({ amount: 1 })
      .match((f) => f.status.eq('active'))
      .build();
    const grouped = orders()
      .group((f) => ({ _id: f.status, total: acc.sum(f.amount) }))
      .match((f) => f.total.gte(10))
      .build();
    expect({
      kept: filterOf(kept.command.pipeline[1]),
      grouped: filterOf(grouped.command.pipeline[1]),
    }).toEqual({
      kept: MongoFieldFilter.eq('status', param('active', 'mongo/string@1', 'status')),
      grouped: MongoFieldFilter.gte('total', 10),
    });
  });
});

describe('an update value on a model field', () => {
  const updateOf = (updater: Parameters<ReturnType<typeof orders>['updateAll']>[0]) =>
    orders().updateAll(updater).command.update;

  it('is encoded through the field codec: a whole value, or one element of a list field', () => {
    expect(
      updateOf((f) => [
        f.status.set('done'),
        f.notes.setOnInsert('first'),
        f.amount.max(9),
        f.tags.push('a'),
        f.tags.addToSet({ $each: ['b', 'c'] }),
        f.tags.pullAll(['d']),
      ]),
    ).toEqual({
      $set: { status: param('done', 'mongo/string@1', 'status') },
      $setOnInsert: { notes: param('first', 'mongo/string@1', 'notes') },
      $max: { amount: param(9, 'mongo/double@1', 'amount') },
      $push: { tags: param('a', 'mongo/string@1', 'tags') },
      $addToSet: {
        tags: {
          $each: [param('b', 'mongo/string@1', 'tags'), param('c', 'mongo/string@1', 'tags')],
        },
      },
      $pullAll: { tags: [param('d', 'mongo/string@1', 'tags')] },
    });
  });

  it('leaves a $pull condition document as it is', () => {
    expect(updateOf((f) => [f.tags.pull({ $in: ['a'] })])).toEqual({
      $pull: { tags: { $in: ['a'] } },
    });
  });
});
