import { describe, expect, it } from 'vitest';
import { createAggregateBuilder, isAggregateSelector } from '../src/aggregate-builder';
import { columnPassedForField, getTestAggregates, getTestContract } from './helpers';

describe('aggregate-builder', () => {
  const contract = getTestContract();
  const aggregates = getTestAggregates();

  it('createAggregateBuilder() maps numeric field selectors to storage columns', () => {
    const aggregate = createAggregateBuilder(contract, aggregates, 'public', 'Post');
    const numericField = 'views' as never;

    expect(aggregate.count()).toEqual({
      kind: 'aggregate',
      fn: 'count',
    });
    expect(aggregate.sum(numericField)).toEqual({
      kind: 'aggregate',
      fn: 'sum',
      column: 'views',
    });
    expect(aggregate.avg(numericField)).toEqual({
      kind: 'aggregate',
      fn: 'avg',
      column: 'views',
    });
    expect(aggregate.min(numericField)).toEqual({
      kind: 'aggregate',
      fn: 'min',
      column: 'views',
    });
    expect(aggregate.max(numericField)).toEqual({
      kind: 'aggregate',
      fn: 'max',
      column: 'views',
    });
  });

  it('createAggregateBuilder() refuses a name that is not a field', () => {
    const aggregate = createAggregateBuilder(contract, aggregates, 'public', 'Post');
    expect(() => aggregate.sum('user_id' as never)).toThrow(
      columnPassedForField('Post', 'user_id', 'userId'),
    );
  });

  it('isAggregateSelector() validates selector shape', () => {
    expect(isAggregateSelector(null)).toBe(false);
    expect(isAggregateSelector('x')).toBe(false);
    expect(isAggregateSelector({ kind: 'not-aggregate', fn: 'count' })).toBe(false);
    // The operation vocabulary is open: any string names a potentially
    // contributed operation, so validity is shape-only.
    expect(isAggregateSelector({ kind: 'aggregate', fn: 'median' })).toBe(true);
    expect(isAggregateSelector({ kind: 'aggregate', fn: 42 })).toBe(false);
    expect(isAggregateSelector({ kind: 'aggregate', fn: 'count' })).toBe(true);
    expect(isAggregateSelector({ kind: 'aggregate', fn: 'sum', column: 'views' })).toBe(true);
  });
});
