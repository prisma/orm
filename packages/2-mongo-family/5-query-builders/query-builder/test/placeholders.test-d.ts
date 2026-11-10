import type { MongoPreparedParamRef } from '@internal/mongo-value';
import { describe, expectTypeOf, it } from 'vitest';
import { fn } from '../src/expression-helpers';
import { mongoQuery } from '../src/query';
import { contextOf } from './fixtures/test-context';
import { testContract } from './fixtures/test-contract';

declare const email: MongoPreparedParamRef<'mongo/string@1', false>;
declare const nickname: MongoPreparedParamRef<'mongo/string@1', true>;
declare const take: MongoPreparedParamRef<'mongo/int32@1', false>;
declare const ratio: MongoPreparedParamRef<'mongo/double@1', false>;
declare const big: MongoPreparedParamRef<'mongo/int64@1', false>;
declare const nullableTake: MongoPreparedParamRef<'mongo/int32@1', true>;

const orders = () => mongoQuery({ context: contextOf(testContract) }).from('orders');

describe('placeholders in the query builder', () => {
  it('go wherever a filter value goes', () => {
    orders().match((f) => f.status.eq(email));
    orders().match((f) => f.status.ne(nickname));
    orders().match((f) => f.amount.gt(ratio));
    orders().match((f) => f.amount.gte(ratio));
    orders().match((f) => f.amount.lt(ratio));
    orders().match((f) => f.amount.lte(ratio));
    orders().match((f) => f.status.type(email));
    orders().match((f) => f.status.in([email, 'new']));
    orders().match((f) => f.status.nin([email]));
  });

  it('go wherever an update value goes', () => {
    orders()
      .match((f) => f.status.eq('new'))
      .updateMany((f) => [
        f.status.set(email),
        f.amount.min(ratio),
        f.amount.max(ratio),
        f.tags.push(email),
        f.tags.addToSet(email),
        f.tags.pull(email),
        f.tags.pullAll([email]),
        f.status.setOnInsert(email),
      ]);
  });

  it('go into insert documents, update pipeline stages and aggregation literals', () => {
    orders().insertOne({ status: email, amount: ratio });
    orders().insertMany([{ status: email }]);
    orders()
      .match((f) => f.status.eq('new'))
      .updateMany((f) => [f.stage.set({ label: fn.literal(email).node })]);
    expectTypeOf(fn.literal(nickname)._field).toEqualTypeOf<{
      readonly codecId: 'mongo/string@1';
      readonly nullable: true;
    }>();
  });

  it('go into limit and skip when the codec input is a number and the placeholder is not nullable', () => {
    orders().limit(take);
    orders().skip(take);
    orders().sort({ amount: 1 }).limit(ratio);
    // @ts-expect-error -- the string codec's input is not a number
    orders().limit(email);
    // @ts-expect-error -- the int64 codec's input is a bigint
    orders().skip(big);
    // @ts-expect-error -- a nullable placeholder cannot be a limit
    orders().limit(nullableTake);
  });
});
