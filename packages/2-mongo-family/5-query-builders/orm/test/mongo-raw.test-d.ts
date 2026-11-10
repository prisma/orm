import type {
  MongoQueryPlan,
  RawAggregateCommand,
  RawDeleteManyCommand,
  RawDeleteOneCommand,
  RawInsertOneCommand,
  RawUpdateManyCommand,
  RawUpdateOneCommand,
} from '@internal/mongo-query-ast/execution';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import type { MongoRawClient } from '../src/mongo-raw';
import type { RawMongoCollection } from '../src/raw-collection';

type Raw = MongoRawClient<Contract>;

test('collection accepts valid root names', () => {
  expectTypeOf<Raw['collection']>().toBeCallableWith('tasks');
  expectTypeOf<Raw['collection']>().toBeCallableWith('users');
});

test('collection rejects invalid root names', () => {
  // @ts-expect-error - 'nonexistent' is not a valid root name
  expectTypeOf<Raw['collection']>().toBeCallableWith('nonexistent');
});

test('collection returns RawMongoCollection', () => {
  expectTypeOf<ReturnType<Raw['collection']>>().toExtend<RawMongoCollection>();
});

test('aggregate build returns MongoQueryPlan', () => {
  type Col = ReturnType<Raw['collection']>;
  type AggFn = Col['aggregate'];
  type BuildFn = ReturnType<AggFn>['build'];
  expectTypeOf<ReturnType<BuildFn>>().toExtend<MongoQueryPlan>();
});

test('each build carries its raw command type', () => {
  type Col = RawMongoCollection;
  type CommandOf<B extends { build(): { readonly command: unknown } }> = ReturnType<
    B['build']
  >['command'];
  expectTypeOf<CommandOf<ReturnType<Col['aggregate']>>>().toEqualTypeOf<RawAggregateCommand>();
  expectTypeOf<CommandOf<ReturnType<Col['insertOne']>>>().toEqualTypeOf<RawInsertOneCommand>();
  expectTypeOf<CommandOf<ReturnType<Col['updateOne']>>>().toEqualTypeOf<RawUpdateOneCommand>();
  expectTypeOf<CommandOf<ReturnType<Col['updateMany']>>>().toEqualTypeOf<RawUpdateManyCommand>();
  expectTypeOf<CommandOf<ReturnType<Col['deleteOne']>>>().toEqualTypeOf<RawDeleteOneCommand>();
  expectTypeOf<CommandOf<ReturnType<Col['deleteMany']>>>().toEqualTypeOf<RawDeleteManyCommand>();
});
