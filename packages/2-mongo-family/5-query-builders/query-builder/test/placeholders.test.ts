import {
  MongoAddFieldsStage,
  MongoAggLiteral,
  MongoLimitStage,
  MongoSkipStage,
} from '@internal/mongo-query-ast/execution';
import { MongoPreparedParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import { fn } from '../src/expression-helpers';
import { mongoQuery } from '../src/query';
import { contextOf } from './fixtures/test-context';
import { testContract } from './fixtures/test-contract';

const orders = () => mongoQuery({ context: contextOf(testContract) }).from('orders');
const take = new MongoPreparedParamRef('take', 'mongo/int32@1', false);
const label = new MongoPreparedParamRef('label', 'mongo/string@1', false);

describe('placeholders in the query builder', () => {
  it('keeps limit and skip placeholders in their stages', () => {
    const plan = orders().skip(take).limit(take).build();
    expect(plan.command.pipeline).toEqual([new MongoSkipStage(take), new MongoLimitStage(take)]);
  });

  it('keeps a placeholder in an aggregation literal', () => {
    const plan = orders()
      .addFields(() => ({ label: fn.literal(label) }))
      .build();
    expect(plan.command.pipeline).toEqual([
      new MongoAddFieldsStage({ label: MongoAggLiteral.of(label) }),
    ]);
  });
});
