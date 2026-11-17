import { describe, expect, it } from 'vitest';
import {
  AggregateExpr,
  AndExpr,
  type AnyOperationArg,
  BinaryExpr,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  DerivedTableSource,
  EqColJoinOn,
  ExistsExpr,
  InsertAst,
  InsertOnConflict,
  JoinAst,
  JsonArrayAggExpr,
  JsonObjectExpr,
  ListExpression,
  LiteralExpr,
  NativeJsonValueProjection,
  NotExpr,
  NullCheckExpr,
  OperationExpr,
  OrderByItem,
  OrExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
  UpdateAst,
} from '../../src/exports/ast';
import { shiftParamRef } from './test-helpers';

const stringReturn = { codecId: 'core/text', nullable: false } as const;
function lowerEmail(column: ColumnRef, ...args: Array<AnyOperationArg>) {
  return new OperationExpr({
    method: 'lower',
    self: column,
    args,
    returns: stringReturn,
    lowering: {
      targetFamily: 'sql',
      template: 'lower({{self}})',
    },
  });
}

describe('rich SQL AST', () => {
  it('builds rich class instances across the AST families', () => {
    const table = TableSource.named('user', 'u');
    const select = SelectAst.from(table);
    const insert = InsertAst.into(table);
    const update = UpdateAst.table(table);
    const del = DeleteAst.from(table);
    const column = ColumnRef.of('user', 'id');
    const param = ParamRef.of(0, { name: 'id', codec: { codecId: 'pg/int4@1' } });
    const literal = LiteralExpr.of('alice');
    const binary = BinaryExpr.eq(column, param);

    expect(select.kind).toBe('select');
    expect(insert.kind).toBe('insert');
    expect(update.kind).toBe('update');
    expect(del.kind).toBe('delete');
    expect(column.kind).toBe('column-ref');
    expect(SubqueryExpr.of(select).kind).toBe('subquery');
    expect(lowerEmail(column, param, literal).kind).toBe('operation');
    expect(AggregateExpr.sum(column).kind).toBe('aggregate');
    expect(
      JsonObjectExpr.fromEntries([
        JsonObjectExpr.entry('id', new NativeJsonValueProjection(column)),
      ]).kind,
    ).toBe('json-object');
    expect(JsonArrayAggExpr.of(new NativeJsonValueProjection(column)).kind).toBe('json-array-agg');
    expect(binary.kind).toBe('binary');
    expect(AndExpr.of([binary]).kind).toBe('and');
    expect(OrExpr.of([binary]).kind).toBe('or');
    expect(ExistsExpr.exists(select).kind).toBe('exists');
    expect(NullCheckExpr.isNull(column).kind).toBe('null-check');
    expect(EqColJoinOn.of(column, ColumnRef.of('post', 'userId')).kind).toBe('eq-col-join-on');
    expect(JoinAst.left(TableSource.named('post'), binary).kind).toBe('join');
    expect(ProjectionItem.of('id', column).kind).toBe('projection-item');
    expect(OrderByItem.asc(column).kind).toBe('order-by-item');
    expect(InsertOnConflict.on([column]).action.kind).toBe('do-nothing');
    expect(InsertOnConflict.on([column]).doUpdateSet({ id: param }).action.kind).toBe(
      'do-update-set',
    );
    expect(new DefaultValueExpr().kind).toBe('default-value');
  });

  it('supports fluent immutable query construction', () => {
    const base = SelectAst.from(TableSource.named('user'));
    const where = BinaryExpr.eq(
      ColumnRef.of('user', 'id'),
      ParamRef.of(0, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
    );

    const next = base
      .addProjection('id', ColumnRef.of('user', 'id'))
      .addProjection('email', lowerEmail(ColumnRef.of('user', 'email')))
      .withWhere(where)
      .withOrderBy([OrderByItem.asc(ColumnRef.of('user', 'email'))])
      .withDistinct()
      .withDistinctOn([ColumnRef.of('user', 'email')])
      .withGroupBy([ColumnRef.of('user', 'id')])
      .withHaving(BinaryExpr.gt(AggregateExpr.count(ColumnRef.of('user', 'id')), LiteralExpr.of(0)))
      .withLimit(10)
      .withOffset(20)
      .withSelectAllIntent({ table: 'user' });

    expect(base).toMatchObject({ projection: [], where: undefined });
    expect(next).toMatchObject({
      where,
      limit: 10,
      offset: 20,
      selectAllIntent: { table: 'user' },
    });
    expect(next.projection.map((item) => item.alias)).toEqual(['id', 'email']);
    expect(Object.isFrozen(next.projection)).toBe(true);
  });

  it('rewrites expressions, joins, and nested selects through rich-node methods', () => {
    const inner = SelectAst.from(TableSource.named('post'))
      .addProjection('authorId', ColumnRef.of('post', 'authorId'))
      .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'published'), LiteralExpr.of(true)));

    const ast = SelectAst.from(TableSource.named('user'))
      .addProjection('id', ColumnRef.of('user', 'id'))
      .addProjection(
        'email',
        lowerEmail(
          ColumnRef.of('user', 'email'),
          ParamRef.of(0, { name: 'email', codec: { codecId: 'pg/text@1' } }),
        ),
      )
      .withJoins([
        JoinAst.left(
          DerivedTableSource.as('posts', inner),
          EqColJoinOn.of(ColumnRef.of('user', 'id'), ColumnRef.of('posts', 'authorId')),
          true,
        ),
      ])
      .withWhere(
        AndExpr.of([
          BinaryExpr.eq(
            ColumnRef.of('user', 'id'),
            ParamRef.of(1, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
          ),
          ExistsExpr.exists(
            SelectAst.from(TableSource.named('comment'))
              .addProjection('id', ColumnRef.of('comment', 'id'))
              .withWhere(
                BinaryExpr.eq(ColumnRef.of('comment', 'postId'), ColumnRef.of('post', 'id')),
              ),
          ),
        ]),
      );

    const rewritten = ast.rewrite({
      tableSource: (source) =>
        source.name === 'user' ? TableSource.named('member', source.alias) : source,
      columnRef: (expr) => (expr.table === 'user' ? ColumnRef.of('member', expr.column) : expr),
      paramRef: shiftParamRef(10),
      literal: (expr) => (expr.value === true ? LiteralExpr.of('TRUE') : expr),
      eqColJoinOn: (on) =>
        EqColJoinOn.of(
          ColumnRef.of(`rewritten_${on.left.table}`, on.left.column),
          ColumnRef.of(`rewritten_${on.right.table}`, on.right.column),
        ),
      select: (select) => select.withLimit(select.limit ?? 99),
    });

    expect(rewritten.from).toEqual(TableSource.named('member'));
    expect(rewritten.limit).toBe(99);
    expect(rewritten.projection[0]?.expr).toEqual(ColumnRef.of('member', 'id'));
    expect(rewritten.projection[1]?.expr?.kind).toBe('operation');
    expect((rewritten.projection[1]!.expr as OperationExpr).args[0]).toEqual(
      ParamRef.of(10, { name: 'email', codec: { codecId: 'pg/text@1' } }),
    );
    expect(rewritten.joins?.[0]?.on).toEqual(
      EqColJoinOn.of(
        ColumnRef.of('rewritten_user', 'id'),
        ColumnRef.of('rewritten_posts', 'authorId'),
      ),
    );
    expect(
      ((rewritten.joins![0]!.source as DerivedTableSource).query.where as BinaryExpr).right,
    ).toEqual(LiteralExpr.of('TRUE'));
  });

  it('folds, collects column refs, and exposes base column refs', () => {
    const email = ColumnRef.of('user', 'email');
    const op = lowerEmail(
      email,
      ParamRef.of(3, { name: 'needle', codec: { codecId: 'pg/text@1' } }),
    );
    const where = AndExpr.of([
      BinaryExpr.eq(op, LiteralExpr.of('alice@example.com')),
      BinaryExpr.in(
        ColumnRef.of('user', 'status'),
        ListExpression.of([
          ParamRef.of(4, { codec: { codecId: 'pg/text@1' } }),
          LiteralExpr.of('active'),
        ]),
      ),
    ]);

    const folded = where.fold<string[]>({
      empty: [],
      combine: (a, b) => [...a, ...b],
      columnRef: (expr) => [`${expr.table}.${expr.column}`],
      paramRef: (expr) => [`$${expr.name ?? String(expr.value)}`],
      literal: (expr) => [`lit:${String(expr.value)}`],
      list: (expr) => [`list:${expr.values.length}`],
      select: (ast) => ast.collectColumnRefs().map((expr) => `${expr.table}.${expr.column}`),
    });

    expect(op.baseColumnRef()).toEqual(email);
    expect(where.collectColumnRefs()).toEqual([
      ColumnRef.of('user', 'email'),
      ColumnRef.of('user', 'status'),
    ]);
    expect(folded).toEqual([
      'user.email',
      '$needle',
      'lit:alice@example.com',
      'user.status',
      'list:2',
    ]);
    expect(() => AggregateExpr.count().baseColumnRef()).toThrow(
      'AggregateExpr does not expose a base column reference',
    );
  });

  it('negates where expressions through not()', () => {
    expect(
      BinaryExpr.eq(
        ColumnRef.of('user', 'id'),
        ParamRef.of(0, { codec: { codecId: 'pg/int4@1' } }),
      ).not(),
    ).toEqual(
      new NotExpr(
        BinaryExpr.eq(
          ColumnRef.of('user', 'id'),
          ParamRef.of(0, { codec: { codecId: 'pg/int4@1' } }),
        ),
      ),
    );
    expect(
      AndExpr.of([
        BinaryExpr.eq(
          ColumnRef.of('user', 'id'),
          ParamRef.of(0, { codec: { codecId: 'pg/int4@1' } }),
        ),
        NullCheckExpr.isNull(ColumnRef.of('user', 'deletedAt')),
      ]).not(),
    ).toEqual(
      new NotExpr(
        AndExpr.of([
          BinaryExpr.eq(
            ColumnRef.of('user', 'id'),
            ParamRef.of(0, { codec: { codecId: 'pg/int4@1' } }),
          ),
          NullCheckExpr.isNull(ColumnRef.of('user', 'deletedAt')),
        ]),
      ),
    );
    expect(ExistsExpr.exists(SelectAst.from(TableSource.named('user'))).not()).toEqual(
      new NotExpr(ExistsExpr.exists(SelectAst.from(TableSource.named('user')))),
    );
    expect(BinaryExpr.like(ColumnRef.of('user', 'email'), LiteralExpr.of('%a%')).not()).toEqual(
      new NotExpr(BinaryExpr.like(ColumnRef.of('user', 'email'), LiteralExpr.of('%a%'))),
    );
  });
});
