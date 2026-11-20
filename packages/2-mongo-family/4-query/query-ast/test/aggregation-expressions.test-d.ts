import { assertType, expectTypeOf, test } from 'vitest';
import type { MongoAggExpr } from '../src/aggregation-expressions';
import { MongoAggFieldRef } from '../src/aggregation-expressions';
import type { MongoAggExprVisitor } from '../src/visitors';

test('switching on kind is exhaustive', () => {
  function exhaustiveSwitch(expr: MongoAggExpr): string {
    switch (expr.kind) {
      case 'fieldRef':
        return 'fieldRef';
      case 'literal':
        return 'literal';
      case 'operator':
        return 'operator';
      case 'accumulator':
        return 'accumulator';
      case 'cond':
        return 'cond';
      case 'switch':
        return 'switch';
      case 'filter':
        return 'filter';
      case 'map':
        return 'map';
      case 'reduce':
        return 'reduce';
      case 'let':
        return 'let';
      case 'mergeObjects':
        return 'mergeObjects';
      default: {
        const _exhaustive: never = expr;
        return _exhaustive;
      }
    }
  }
  assertType<(expr: MongoAggExpr) => string>(exhaustiveSwitch);
});

test('accept returns R for any visitor R', () => {
  const ref = MongoAggFieldRef.of('x');
  const visitor: MongoAggExprVisitor<number> = {
    fieldRef: () => 1,
    literal: () => 2,
    operator: () => 3,
    accumulator: () => 4,
    cond: () => 5,
    switch_: () => 6,
    filter: () => 7,
    map: () => 8,
    reduce: () => 9,
    let_: () => 10,
    mergeObjects: () => 11,
  };
  expectTypeOf(ref.accept(visitor)).toBeNumber();
});
