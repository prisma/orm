import { assertType, expectTypeOf, test } from 'vitest';
import type { MongoFilterExpr } from '../src/filter-expressions';
import type { MongoFilterVisitor } from '../src/visitors';

test('switching on MongoFilterExpr kind is exhaustive', () => {
  function exhaustiveSwitch(expr: MongoFilterExpr): string {
    switch (expr.kind) {
      case 'field':
        return 'field';
      case 'and':
        return 'and';
      case 'or':
        return 'or';
      case 'not':
        return 'not';
      case 'exists':
        return 'exists';
      case 'expr':
        return 'expr';
      default: {
        const _exhaustive: never = expr;
        return _exhaustive;
      }
    }
  }
  assertType<(expr: MongoFilterExpr) => string>(exhaustiveSwitch);
});

test('MongoFilterVisitor requires expr method', () => {
  expectTypeOf<MongoFilterVisitor<string>>().toHaveProperty('expr');

  // @ts-expect-error - missing 'expr' method
  assertType<MongoFilterVisitor<string>>({
    field: () => '',
    and: () => '',
    or: () => '',
    not: () => '',
    exists: () => '',
  });
});
