import type { MongoValue } from '@internal/mongo-value';
import type { MongoAggExpr } from './aggregation-expressions';
import { MongoAstNode } from './ast-node';
import { ormError } from './orm-errors';
import type { MongoFilterRewriter, MongoFilterVisitor } from './visitors';

const FILTER_EXPR_BRAND = '__prismaMongoFilter__';

export function isMongoFilterExpr(value: unknown): value is MongoFilterExpr {
  return typeof value === 'object' && value !== null && FILTER_EXPR_BRAND in value;
}

abstract class MongoFilterExpression extends MongoAstNode {
  abstract accept<R>(visitor: MongoFilterVisitor<R>): R;
  abstract rewrite(rewriter: MongoFilterRewriter): MongoFilterExpr;

  not(this: MongoFilterExpr): MongoNotExpr {
    return new MongoNotExpr(this);
  }

  and(this: MongoFilterExpr, other: MongoFilterExpr): MongoAndExpr {
    return MongoAndExpr.of([this, other]);
  }
}

Object.defineProperty(MongoFilterExpression.prototype, FILTER_EXPR_BRAND, {
  value: true,
  writable: false,
  enumerable: false,
  configurable: false,
});

export class MongoFieldFilter extends MongoFilterExpression {
  readonly kind = 'field' as const;
  readonly field: string;
  readonly op: string;
  readonly value: MongoValue;

  constructor(field: string, op: string, value: MongoValue) {
    super();
    this.field = field;
    this.op = op;
    this.value = value;
    this.freeze();
  }

  static of(field: string, op: string, value: MongoValue): MongoFieldFilter {
    return new MongoFieldFilter(field, op, value);
  }

  static eq(field: string, value: MongoValue): MongoFieldFilter {
    return new MongoFieldFilter(field, '$eq', value);
  }

  static neq(field: string, value: MongoValue): MongoFieldFilter {
    return new MongoFieldFilter(field, '$ne', value);
  }

  static gt(field: string, value: MongoValue): MongoFieldFilter {
    return new MongoFieldFilter(field, '$gt', value);
  }

  static lt(field: string, value: MongoValue): MongoFieldFilter {
    return new MongoFieldFilter(field, '$lt', value);
  }

  static gte(field: string, value: MongoValue): MongoFieldFilter {
    return new MongoFieldFilter(field, '$gte', value);
  }

  static lte(field: string, value: MongoValue): MongoFieldFilter {
    return new MongoFieldFilter(field, '$lte', value);
  }

  static in(field: string, values: ReadonlyArray<MongoValue>): MongoFieldFilter {
    return new MongoFieldFilter(field, '$in', values);
  }

  static nin(field: string, values: ReadonlyArray<MongoValue>): MongoFieldFilter {
    return new MongoFieldFilter(field, '$nin', values);
  }

  static isNull(field: string): MongoFieldFilter {
    return new MongoFieldFilter(field, '$eq', null);
  }

  static isNotNull(field: string): MongoFieldFilter {
    return new MongoFieldFilter(field, '$ne', null);
  }

  accept<R>(visitor: MongoFilterVisitor<R>): R {
    return visitor.field(this);
  }

  rewrite(rewriter: MongoFilterRewriter): MongoFilterExpr {
    return rewriter.field ? rewriter.field(this) : this;
  }
}

export class MongoAndExpr extends MongoFilterExpression {
  readonly kind = 'and' as const;
  readonly exprs: ReadonlyArray<MongoFilterExpr>;

  constructor(exprs: ReadonlyArray<MongoFilterExpr>) {
    super();
    if (exprs.length === 0) {
      throw ormError('ORM.ARGUMENT_INVALID', '$and requires at least one expression');
    }
    this.exprs = Object.freeze([...exprs]);
    this.freeze();
  }

  static of(exprs: ReadonlyArray<MongoFilterExpr>): MongoAndExpr {
    return new MongoAndExpr(exprs);
  }

  accept<R>(visitor: MongoFilterVisitor<R>): R {
    return visitor.and(this);
  }

  rewrite(rewriter: MongoFilterRewriter): MongoFilterExpr {
    const rewritten = new MongoAndExpr(this.exprs.map((e) => e.rewrite(rewriter)));
    return rewriter.and ? rewriter.and(rewritten) : rewritten;
  }
}

export class MongoOrExpr extends MongoFilterExpression {
  readonly kind = 'or' as const;
  readonly exprs: ReadonlyArray<MongoFilterExpr>;

  constructor(exprs: ReadonlyArray<MongoFilterExpr>) {
    super();
    if (exprs.length === 0) {
      throw ormError('ORM.ARGUMENT_INVALID', '$or requires at least one expression');
    }
    this.exprs = Object.freeze([...exprs]);
    this.freeze();
  }

  static of(exprs: ReadonlyArray<MongoFilterExpr>): MongoOrExpr {
    return new MongoOrExpr(exprs);
  }

  accept<R>(visitor: MongoFilterVisitor<R>): R {
    return visitor.or(this);
  }

  rewrite(rewriter: MongoFilterRewriter): MongoFilterExpr {
    const rewritten = new MongoOrExpr(this.exprs.map((e) => e.rewrite(rewriter)));
    return rewriter.or ? rewriter.or(rewritten) : rewritten;
  }
}

export class MongoNotExpr extends MongoFilterExpression {
  readonly kind = 'not' as const;
  readonly expr: MongoFilterExpr;

  constructor(expr: MongoFilterExpr) {
    super();
    this.expr = expr;
    this.freeze();
  }

  accept<R>(visitor: MongoFilterVisitor<R>): R {
    return visitor.not(this);
  }

  rewrite(rewriter: MongoFilterRewriter): MongoFilterExpr {
    const rewritten = new MongoNotExpr(this.expr.rewrite(rewriter));
    return rewriter.not ? rewriter.not(rewritten) : rewritten;
  }
}

export class MongoExistsExpr extends MongoFilterExpression {
  readonly kind = 'exists' as const;
  readonly field: string;
  readonly exists: boolean;

  constructor(field: string, exists: boolean) {
    super();
    this.field = field;
    this.exists = exists;
    this.freeze();
  }

  static exists(field: string): MongoExistsExpr {
    return new MongoExistsExpr(field, true);
  }

  static notExists(field: string): MongoExistsExpr {
    return new MongoExistsExpr(field, false);
  }

  accept<R>(visitor: MongoFilterVisitor<R>): R {
    return visitor.exists(this);
  }

  rewrite(rewriter: MongoFilterRewriter): MongoFilterExpr {
    return rewriter.exists ? rewriter.exists(this) : this;
  }
}

export class MongoExprFilter extends MongoFilterExpression {
  readonly kind = 'expr' as const;
  readonly aggExpr: MongoAggExpr;

  constructor(aggExpr: MongoAggExpr) {
    super();
    this.aggExpr = aggExpr;
    this.freeze();
  }

  static of(aggExpr: MongoAggExpr): MongoExprFilter {
    return new MongoExprFilter(aggExpr);
  }

  accept<R>(visitor: MongoFilterVisitor<R>): R {
    return visitor.expr(this);
  }

  rewrite(rewriter: MongoFilterRewriter): MongoFilterExpr {
    return rewriter.expr ? rewriter.expr(this) : this;
  }
}

export type MongoFilterExpr =
  | MongoFieldFilter
  | MongoAndExpr
  | MongoOrExpr
  | MongoNotExpr
  | MongoExistsExpr
  | MongoExprFilter;
