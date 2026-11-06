import type {
  AggregateCommand,
  AnyMongoCommand,
  DeleteManyCommand,
  DeleteOneCommand,
  InsertOneCommand,
  MongoQueryExecutor,
  MongoQueryPlan,
  RawAggregateCommand,
  RawDeleteManyCommand,
  RawDeleteOneCommand,
  RawUpdateManyCommand,
  RawUpdateOneCommand,
  UpdateManyCommand,
  UpdateOneCommand,
} from '@internal/mongo-query-ast/execution';
import type { MongoPreparedParamRef } from '@internal/mongo-value';
import { describe, expectTypeOf, test } from 'vitest';
import type { MongoRuntime } from '../src/mongo-runtime';
import type {
  MongoDeclaration,
  MongoParamsFromDeclaration,
  MongoPlaceholders,
  MongoPreparedExecution,
  MongoPreparedFor,
  MongoPreparedStatement,
} from '../src/prepared/types';
import type { TestCodecTypes } from './prepare-fixtures';

type Declared = {
  readonly email: 'test/string@1';
  readonly take: { readonly codecId: 'test/int@1' };
  readonly nickname: { readonly codecId: 'test/string@1'; readonly nullable: true };
};

describe('declarations', () => {
  test('accept known codec ids, in short and object form', () => {
    expectTypeOf<Declared>().toExtend<MongoDeclaration<TestCodecTypes>>();
  });

  test('reject unknown codec ids', () => {
    expectTypeOf<{ readonly email: 'test/missing@1' }>().not.toExtend<
      MongoDeclaration<TestCodecTypes>
    >();
    expectTypeOf<{ readonly email: { readonly codecId: 'test/missing@1' } }>().not.toExtend<
      MongoDeclaration<TestCodecTypes>
    >();
  });
});

test('placeholders carry the codec id and nullability', () => {
  expectTypeOf<MongoPlaceholders<Declared>>().toEqualTypeOf<{
    readonly email: MongoPreparedParamRef<'test/string@1', false>;
    readonly take: MongoPreparedParamRef<'test/int@1', false>;
    readonly nickname: MongoPreparedParamRef<'test/string@1', true>;
  }>();
});

test('run params are each codec input, plus null when nullable', () => {
  expectTypeOf<MongoParamsFromDeclaration<Declared, TestCodecTypes>>().toEqualTypeOf<{
    readonly email: string;
    readonly take: number;
    readonly nickname: string | null;
  }>();
});

describe('the handle a plan prepares into', () => {
  test('update and delete commands get execute', () => {
    expectTypeOf<MongoPreparedFor<{ a: string }, unknown, UpdateOneCommand>>().toEqualTypeOf<
      MongoPreparedExecution<{ a: string }, unknown>
    >();
    expectTypeOf<MongoPreparedFor<{ a: string }, unknown, UpdateManyCommand>>().toHaveProperty(
      'execute',
    );
    expectTypeOf<MongoPreparedFor<{ a: string }, unknown, DeleteOneCommand>>().toHaveProperty(
      'execute',
    );
    expectTypeOf<MongoPreparedFor<{ a: string }, unknown, DeleteManyCommand>>().toHaveProperty(
      'execute',
    );
  });

  test('raw update and delete commands get execute, as ad-hoc execute gives them statistics', () => {
    expectTypeOf<MongoPreparedFor<{ a: string }, unknown, RawUpdateOneCommand>>().toEqualTypeOf<
      MongoPreparedExecution<{ a: string }, unknown>
    >();
    expectTypeOf<MongoPreparedFor<{ a: string }, unknown, RawUpdateManyCommand>>().toHaveProperty(
      'execute',
    );
    expectTypeOf<MongoPreparedFor<{ a: string }, unknown, RawDeleteOneCommand>>().toHaveProperty(
      'execute',
    );
    expectTypeOf<MongoPreparedFor<{ a: string }, unknown, RawDeleteManyCommand>>().toHaveProperty(
      'execute',
    );
    expectTypeOf<
      MongoPreparedFor<{ a: string }, unknown, RawAggregateCommand>
    >().not.toHaveProperty('execute');
  });

  test('other commands get query only', () => {
    expectTypeOf<MongoPreparedFor<{ a: string }, { n: 1 }, AggregateCommand>>().toEqualTypeOf<
      MongoPreparedStatement<{ a: string }, { n: 1 }>
    >();
    expectTypeOf<MongoPreparedFor<{ a: string }, unknown, InsertOneCommand>>().not.toHaveProperty(
      'execute',
    );
    expectTypeOf<MongoPreparedFor<{ a: string }, unknown, AnyMongoCommand>>().not.toHaveProperty(
      'execute',
    );
  });

  test('runtime.prepare picks the handle from the plan command type', () => {
    const runtime = {} as MongoRuntime;
    const read = runtime.prepare(
      { email: 'test/string@1' },
      (_p) => ({}) as MongoQueryPlan<{ readonly email: string }, AggregateCommand>,
    );
    expectTypeOf(read).resolves.not.toHaveProperty('execute');
    expectTypeOf(read).resolves.toHaveProperty('query');

    const update = runtime.prepare(
      { status: 'test/string@1' },
      (_p) => ({}) as MongoQueryPlan<unknown, UpdateManyCommand>,
    );
    expectTypeOf(update).resolves.toHaveProperty('execute');
  });
});

test('a MongoRuntime is a target', () => {
  expectTypeOf<MongoRuntime>().toExtend<MongoQueryExecutor>();
  expectTypeOf<MongoPreparedStatement<{ a: string }, unknown>['query']>()
    .parameter(0)
    .toEqualTypeOf<MongoQueryExecutor>();
});
