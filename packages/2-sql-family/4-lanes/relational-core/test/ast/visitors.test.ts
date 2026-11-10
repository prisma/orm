import { describe, expect, it } from 'vitest';
import {
  AggregateExpr,
  AndExpr,
  BinaryExpr,
  DerivedTableSource,
  EqColJoinOn,
  ExistsExpr,
  JoinAst,
  JsonArrayAggExpr,
  JsonObjectExpr,
  ListExpression,
  NativeJsonValueProjection,
  NullCheckExpr,
  OrderByItem,
  SelectAst,
  SubqueryExpr,
} from '../../src/exports/ast';
import { col, lit, lowerExpr, param, shiftParamRef, simpleSelect, table } from './test-helpers';

describe('ast/visitors', () => {
  it('rewrites expressions through node-level rewrite methods', () => {
    const operation = lowerExpr(col('user', 'email'), param(0, 'email'), lit(true));
    const list = ListExpression.of([param(1, 'firstId'), lit(2)]);
    const objectExpr = JsonObjectExpr.fromEntries([
      JsonObjectExpr.entry('email', new NativeJsonValueProjection(operation)),
      JsonObjectExpr.entry('active', new NativeJsonValueProjection(lit(false))),
    ]);
    const arrayExpr = JsonArrayAggExpr.of(
      new NativeJsonValueProjection(col('post', 'id')),
      'emptyArray',
      [OrderByItem.desc(col('post', 'createdAt'))],
    );

    const rewrittenOperation = operation.rewrite({
      columnRef: (expr) => (expr.table === 'user' ? col('member', expr.column) : expr),
      paramRef: shiftParamRef(10),
      literal: (expr) => (expr.value === true ? lit('TRUE') : expr),
    });
    const rewrittenList = list.rewrite({
      paramRef: shiftParamRef(20),
      literal: () => lit('mapped'),
    });
    const rewrittenObject = objectExpr.rewrite({
      literal: (expr) => (expr.value === false ? lit('FALSE') : expr),
    });
    const rewrittenArray = arrayExpr.rewrite({
      columnRef: (expr) => (expr.table === 'post' ? col('article', expr.column) : expr),
    });

    expect(rewrittenOperation).toEqual(
      lowerExpr(col('member', 'email'), param(10, 'email'), lit('TRUE')),
    );
    expect(rewrittenList).toEqual(ListExpression.of([param(21, 'firstId'), lit('mapped')]));
    expect(rewrittenObject).toEqual(
      JsonObjectExpr.fromEntries([
        JsonObjectExpr.entry('email', new NativeJsonValueProjection(operation)),
        JsonObjectExpr.entry('active', new NativeJsonValueProjection(lit('FALSE'))),
      ]),
    );
    expect(rewrittenArray).toEqual(
      JsonArrayAggExpr.of(new NativeJsonValueProjection(col('article', 'id')), 'emptyArray', [
        OrderByItem.desc(col('article', 'createdAt')),
      ]),
    );
  });

  it('rewrites nested selects deeply through select.rewrite', () => {
    const inner = SelectAst.from(table('post'))
      .addProjection('userId', col('post', 'userId'))
      .withWhere(BinaryExpr.eq(col('post', 'published'), lit(true)));
    const ast = SelectAst.from(table('user'))
      .addProjection('id', col('user', 'id'))
      .addProjection('latestPost', SubqueryExpr.of(inner))
      .withJoins([
        JoinAst.left(
          DerivedTableSource.as('posts', inner),
          EqColJoinOn.of(col('user', 'id'), col('posts', 'userId')),
          true,
        ),
      ])
      .withWhere(
        AndExpr.of([
          BinaryExpr.eq(col('user', 'id'), param(0, 'userId')),
          ExistsExpr.exists(simpleSelect('comment', ['id'])),
          NullCheckExpr.isNull(col('user', 'deletedAt')),
        ]),
      );

    const rewritten = ast.rewrite({
      tableSource: (source) => (source.name === 'user' ? table('member') : source),
      columnRef: (expr) => (expr.table === 'user' ? col('member', expr.column) : expr),
      paramRef: shiftParamRef(1),
      literal: (expr) => (expr.value === true ? lit('TRUE') : expr),
      eqColJoinOn: (on) => EqColJoinOn.of(col('member', on.left.column), on.right),
      select: (select) => select.withLimit(select.limit ?? 25),
    });

    expect(rewritten.from).toEqual(table('member'));
    expect(rewritten.limit).toBe(25);
    expect(rewritten.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(col('member', 'id'), param(1, 'userId')),
        ExistsExpr.exists(simpleSelect('comment', ['id']).withLimit(25)),
        NullCheckExpr.isNull(col('member', 'deletedAt')),
      ]),
    );
    expect(rewritten.joins?.[0]?.on).toEqual(
      EqColJoinOn.of(col('member', 'id'), col('posts', 'userId')),
    );
    expect(
      ((rewritten.projection[1]!.expr as SubqueryExpr).query.where as BinaryExpr).right,
    ).toEqual(lit('TRUE'));
  });

  it('folds expression and where trees through node-level fold methods', () => {
    const where = AndExpr.of([
      BinaryExpr.eq(lowerExpr(col('user', 'email')), lit('a@example.com')),
      BinaryExpr.in(col('user', 'status'), ListExpression.of([param(1), lit('active')])),
      ExistsExpr.exists(simpleSelect('post', ['id'])),
    ]);

    const folded = where.fold<string[]>({
      empty: [],
      combine: (a, b) => [...a, ...b],
      columnRef: (expr) => [`${expr.table}.${expr.column}`],
      paramRef: (expr) => [`$${expr.value}`],
      literal: (expr) => [`lit:${String(expr.value)}`],
      list: (expr) => [`list:${expr.values.length}`],
      select: (ast) => ast.collectColumnRefs().map((expr) => `${expr.table}.${expr.column}`),
    });

    expect(folded).toEqual(['user.email', 'lit:a@example.com', 'user.status', 'list:2', 'post.id']);
  });

  it('replaces old visitor helpers with collectColumnRefs and baseColumnRef', () => {
    const operation = lowerExpr(col('user', 'email'), param(0, 'email'));
    const aggregate = AggregateExpr.sum(col('post', 'likes'));

    expect(operation.baseColumnRef()).toEqual(col('user', 'email'));
    expect(
      SelectAst.from(table('user'))
        .addProjection('email', operation)
        .withWhere(BinaryExpr.eq(aggregate, lit(10)))
        .collectColumnRefs(),
    ).toEqual([col('user', 'email'), col('post', 'likes')]);
    expect(() => AggregateExpr.count().baseColumnRef()).toThrow(
      'AggregateExpr does not expose a base column reference',
    );
  });
});
