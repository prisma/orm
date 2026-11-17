import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { MongoAggFieldRef, MongoAggOperator } from '../src/aggregation-expressions';
import type { MongoFilterExpr } from '../src/filter-expressions';
import {
  isMongoFilterExpr,
  MongoAndExpr,
  MongoExistsExpr,
  MongoExprFilter,
  MongoFieldFilter,
  MongoNotExpr,
  MongoOrExpr,
} from '../src/filter-expressions';
import type { MongoFilterRewriter, MongoFilterVisitor } from '../src/visitors';

describe('MongoFieldFilter', () => {
  it('constructs via static factory', () => {
    const filter = MongoFieldFilter.eq('email', 'alice@example.com');
    expect(filter.kind).toBe('field');
    expect(filter.field).toBe('email');
    expect(filter.op).toBe('$eq');
    expect(filter.value).toBe('alice@example.com');
  });

  it('constructs with of() for arbitrary operators', () => {
    const filter = MongoFieldFilter.of('loc', '$near', [1, 2]);
    expect(filter.op).toBe('$near');
    expect(filter.value).toEqual([1, 2]);
  });

  it.each([
    ['eq', '$eq'],
    ['neq', '$ne'],
    ['gt', '$gt'],
    ['lt', '$lt'],
    ['gte', '$gte'],
    ['lte', '$lte'],
  ] as const)('%s() sets op to %s', (method, expectedOp) => {
    const filter = MongoFieldFilter[method]('x', 1);
    expect(filter.op).toBe(expectedOp);
    expect(filter.field).toBe('x');
    expect(filter.value).toBe(1);
  });

  it('in() sets op to $in', () => {
    const filter = MongoFieldFilter.in('status', [1, 2, 3]);
    expect(filter.op).toBe('$in');
    expect(filter.value).toEqual([1, 2, 3]);
  });

  it('is frozen after construction', () => {
    const filter = MongoFieldFilter.eq('x', 1);
    expect(Object.isFrozen(filter)).toBe(true);
  });
});

describe('MongoAndExpr', () => {
  it('wraps multiple expressions', () => {
    const a = MongoFieldFilter.eq('x', 1);
    const b = MongoFieldFilter.gt('y', 2);
    const and = MongoAndExpr.of([a, b]);
    expect(and.kind).toBe('and');
    expect(and.exprs).toHaveLength(2);
  });

  it('rejects empty expression array', () => {
    expect(() => MongoAndExpr.of([])).toThrow('$and requires at least one expression');
  });

  it('raises ORM.ARGUMENT_INVALID for an empty expression array', () => {
    let caught: unknown;
    try {
      MongoAndExpr.of([]);
    } catch (error) {
      caught = error;
    }
    expect(isStructuredError(caught)).toBe(true);
    expect(isStructuredError(caught) && caught.code).toBe('ORM.ARGUMENT_INVALID');
  });

  it('is frozen after construction', () => {
    const and = MongoAndExpr.of([MongoFieldFilter.eq('x', 1)]);
    expect(Object.isFrozen(and)).toBe(true);
    expect(Object.isFrozen(and.exprs)).toBe(true);
  });
});

describe('MongoOrExpr', () => {
  it('wraps multiple expressions', () => {
    const a = MongoFieldFilter.eq('x', 1);
    const b = MongoFieldFilter.eq('x', 2);
    const or = MongoOrExpr.of([a, b]);
    expect(or.kind).toBe('or');
    expect(or.exprs).toHaveLength(2);
  });

  it('rejects empty expression array', () => {
    expect(() => MongoOrExpr.of([])).toThrow('$or requires at least one expression');
  });

  it('is frozen after construction', () => {
    const or = MongoOrExpr.of([MongoFieldFilter.eq('x', 1)]);
    expect(Object.isFrozen(or)).toBe(true);
    expect(Object.isFrozen(or.exprs)).toBe(true);
  });
});

describe('MongoNotExpr', () => {
  it('wraps a single expression', () => {
    const inner = MongoFieldFilter.eq('x', 1);
    const not = new MongoNotExpr(inner);
    expect(not.kind).toBe('not');
    expect(not.expr).toBe(inner);
  });

  it('is frozen after construction', () => {
    const not = new MongoNotExpr(MongoFieldFilter.eq('x', 1));
    expect(Object.isFrozen(not)).toBe(true);
  });
});

describe('MongoExistsExpr', () => {
  it('exists() creates positive existence check', () => {
    const expr = MongoExistsExpr.exists('name');
    expect(expr.kind).toBe('exists');
    expect(expr.field).toBe('name');
    expect(expr.exists).toBe(true);
  });

  it('notExists() creates negative existence check', () => {
    const expr = MongoExistsExpr.notExists('name');
    expect(expr.exists).toBe(false);
  });

  it('is frozen after construction', () => {
    const expr = MongoExistsExpr.exists('name');
    expect(Object.isFrozen(expr)).toBe(true);
  });
});

describe('.not() convenience method', () => {
  it('wraps expression in MongoNotExpr', () => {
    const field = MongoFieldFilter.eq('x', 1);
    const negated = field.not();
    expect(negated.kind).toBe('not');
    expect(negated.expr).toBe(field);
  });
});

describe('MongoExprFilter', () => {
  it('constructs with aggregation expression', () => {
    const aggExpr = MongoAggOperator.of('$gt', [
      MongoAggFieldRef.of('qty'),
      MongoAggFieldRef.of('minQty'),
    ]);
    const filter = MongoExprFilter.of(aggExpr);
    expect(filter.kind).toBe('expr');
    expect(filter.aggExpr).toBe(aggExpr);
  });

  it('is frozen after construction', () => {
    const filter = MongoExprFilter.of(MongoAggFieldRef.of('x'));
    expect(Object.isFrozen(filter)).toBe(true);
  });
});

describe('MongoFilterVisitor', () => {
  const kindVisitor: MongoFilterVisitor<string> = {
    field: (expr) => `field:${expr.field}`,
    and: (expr) => `and:${expr.exprs.length}`,
    or: (expr) => `or:${expr.exprs.length}`,
    not: () => 'not',
    exists: (expr) => `exists:${expr.field}`,
    expr: () => 'expr',
  };

  it('dispatches field', () => {
    expect(MongoFieldFilter.eq('x', 1).accept(kindVisitor)).toBe('field:x');
  });

  it('dispatches and', () => {
    const and = MongoAndExpr.of([MongoFieldFilter.eq('x', 1), MongoFieldFilter.eq('y', 2)]);
    expect(and.accept(kindVisitor)).toBe('and:2');
  });

  it('dispatches or', () => {
    const or = MongoOrExpr.of([MongoFieldFilter.eq('x', 1)]);
    expect(or.accept(kindVisitor)).toBe('or:1');
  });

  it('dispatches not', () => {
    const not = new MongoNotExpr(MongoFieldFilter.eq('x', 1));
    expect(not.accept(kindVisitor)).toBe('not');
  });

  it('dispatches exists', () => {
    expect(MongoExistsExpr.exists('name').accept(kindVisitor)).toBe('exists:name');
  });

  it('dispatches expr', () => {
    const filter = MongoExprFilter.of(MongoAggFieldRef.of('x'));
    expect(filter.accept(kindVisitor)).toBe('expr');
  });
});

describe('MongoFilterRewriter', () => {
  it('rewrites only hooked node kinds (bottom-up)', () => {
    const rewriter: MongoFilterRewriter = {
      field: (expr) =>
        expr.op === '$eq' ? MongoFieldFilter.of(expr.field, '$ne', expr.value) : expr,
    };

    const original = MongoFieldFilter.eq('x', 1);
    const rewritten = original.rewrite(rewriter);
    expect(rewritten.kind).toBe('field');
    expect((rewritten as MongoFieldFilter).op).toBe('$ne');
  });

  it('leaves untouched nodes when no hook provided', () => {
    const rewriter: MongoFilterRewriter = {};
    const original = MongoFieldFilter.eq('x', 1);
    const rewritten = original.rewrite(rewriter);
    expect(rewritten).toBe(original);
  });

  it('rewrites children of and before the and hook', () => {
    const rewriter: MongoFilterRewriter = {
      field: (expr) => MongoFieldFilter.of(expr.field, '$gte', expr.value),
    };

    const and = MongoAndExpr.of([MongoFieldFilter.eq('x', 1), MongoFieldFilter.lt('y', 2)]);
    const rewritten = and.rewrite(rewriter) as MongoAndExpr;
    expect(rewritten.kind).toBe('and');
    expect((rewritten.exprs[0] as MongoFieldFilter).op).toBe('$gte');
    expect((rewritten.exprs[1] as MongoFieldFilter).op).toBe('$gte');
  });

  it('rewrites nested or expressions', () => {
    const rewriter: MongoFilterRewriter = {
      field: (expr) => MongoFieldFilter.of(expr.field, '$lte', expr.value),
    };

    const or = MongoOrExpr.of([MongoFieldFilter.eq('a', 1)]);
    const rewritten = or.rewrite(rewriter) as MongoOrExpr;
    expect((rewritten.exprs[0] as MongoFieldFilter).op).toBe('$lte');
  });

  it('rewrites inner expression of not', () => {
    const rewriter: MongoFilterRewriter = {
      field: () => MongoExistsExpr.exists('replaced'),
    };

    const not = new MongoNotExpr(MongoFieldFilter.eq('x', 1));
    const rewritten = not.rewrite(rewriter) as MongoNotExpr;
    expect(rewritten.expr.kind).toBe('exists');
  });

  it('leaves exists untouched when no hook', () => {
    const rewriter: MongoFilterRewriter = {};
    const original = MongoExistsExpr.exists('name');
    expect(original.rewrite(rewriter)).toBe(original);
  });

  it('leaves expr untouched when no hook', () => {
    const rewriter: MongoFilterRewriter = {};
    const original = MongoExprFilter.of(MongoAggFieldRef.of('x'));
    expect(original.rewrite(rewriter)).toBe(original);
  });

  it('applies expr hook', () => {
    const rewriter: MongoFilterRewriter = {
      expr: () => MongoFieldFilter.eq('x', 1),
    };
    const original = MongoExprFilter.of(MongoAggFieldRef.of('x'));
    const rewritten = original.rewrite(rewriter);
    expect(rewritten.kind).toBe('field');
  });
});

describe('isMongoFilterExpr', () => {
  it('returns true for all filter expression types', () => {
    const field = MongoFieldFilter.eq('x', 1);
    const and = MongoAndExpr.of([field]);
    const or = MongoOrExpr.of([field]);
    const not = new MongoNotExpr(field);
    const exists = MongoExistsExpr.exists('x');
    const expr = MongoExprFilter.of(MongoAggFieldRef.of('x'));

    for (const node of [field, and, or, not, exists, expr]) {
      expect(isMongoFilterExpr(node)).toBe(true);
    }
  });

  it('returns false for plain objects with a kind property', () => {
    const impersonator = { kind: 'field', field: 'x', op: '$eq', value: 1 };
    expect(isMongoFilterExpr(impersonator)).toBe(false);
  });

  it('returns false for null and primitives', () => {
    expect(isMongoFilterExpr(null)).toBe(false);
    expect(isMongoFilterExpr(undefined)).toBe(false);
    expect(isMongoFilterExpr(42)).toBe(false);
  });

  it('brand property is non-enumerable', () => {
    const field = MongoFieldFilter.eq('x', 1);
    const brandKey = '__prismaMongoFilter__';
    expect(Object.keys(field)).not.toContain(brandKey);
    expect(JSON.parse(JSON.stringify(field))).not.toHaveProperty(brandKey);
  });

  it('survives dual-package scenario (string-based lookup)', () => {
    const field = MongoFieldFilter.eq('x', 1);
    const brandKey = '__prismaMongoFilter__';
    expect(brandKey in field).toBe(true);
  });
});

describe('composite nesting', () => {
  it('supports $and containing $or and $not', () => {
    const expr: MongoFilterExpr = MongoAndExpr.of([
      MongoOrExpr.of([MongoFieldFilter.eq('x', 1), MongoFieldFilter.eq('x', 2)]),
      new MongoNotExpr(MongoFieldFilter.gt('y', 10)),
      MongoExistsExpr.exists('z'),
    ]);

    expect(expr.kind).toBe('and');
    const and = expr as MongoAndExpr;
    expect(and.exprs[0]!.kind).toBe('or');
    expect(and.exprs[1]!.kind).toBe('not');
    expect(and.exprs[2]!.kind).toBe('exists');
  });
});
