import { describe, expect, it } from 'vitest';
import {
  BinaryExpr,
  DerivedTableSource,
  EqColJoinOn,
  ExistsExpr,
  FunctionSource,
  JoinAst,
  OrderByItem,
  ProjectionItem,
  SelectAst,
} from '../../src/exports/ast';
import { col, lowerExpr, param, shiftParamRef, simpleSelect, table } from './test-helpers';

describe('ast/select', () => {
  it('creates select ASTs with from and project', () => {
    const selectAst = SelectAst.from(table('user'))
      .addProjection('id', col('user', 'id'))
      .addProjection('email', col('user', 'email'));

    expect(selectAst).toMatchObject({
      from: table('user'),
      projection: [
        { alias: 'id', expr: col('user', 'id') },
        { alias: 'email', expr: col('user', 'email') },
      ],
      joins: undefined,
      where: undefined,
      orderBy: undefined,
      limit: undefined,
      selectAllIntent: undefined,
    });
  });

  it('supports fluent optional clauses immutably', () => {
    const base = SelectAst.from(table('user')).addProjection('id', col('user', 'id'));
    const where = BinaryExpr.eq(col('user', 'id'), param(0, 'userId'));
    const selectAst = base
      .withJoins([
        JoinAst.left(table('post'), EqColJoinOn.of(col('user', 'id'), col('post', 'userId'))),
      ])
      .withWhere(where)
      .withOrderBy([OrderByItem.asc(col('user', 'id'))])
      .withLimit(10)
      .withDistinct()
      .withDistinctOn([col('user', 'email')])
      .withGroupBy([col('user', 'id')])
      .withHaving(BinaryExpr.gt(col('user', 'id'), param(1, 'minId')))
      .withOffset(3)
      .withSelectAllIntent({ table: 'user' });

    expect(base).toMatchObject({ joins: undefined, where: undefined });
    expect(selectAst).toMatchObject({
      where,
      orderBy: [OrderByItem.asc(col('user', 'id'))],
      limit: 10,
      distinct: true,
      distinctOn: [col('user', 'email')],
      groupBy: [col('user', 'id')],
      having: BinaryExpr.gt(col('user', 'id'), param(1, 'minId')),
      offset: 3,
      selectAllIntent: { table: 'user' },
    });
    expect(selectAst.joins).toHaveLength(1);
  });

  it('stores operation and exists expressions inside project and where clauses', () => {
    const subquery = simpleSelect('post', ['id']);
    const selectAst = SelectAst.from(table('user'))
      .addProjection('result', lowerExpr(col('user', 'email')))
      .withWhere(ExistsExpr.exists(subquery));

    expect(selectAst.projection[0]?.expr).toEqual(lowerExpr(col('user', 'email')));
    expect((selectAst.where as ExistsExpr).subquery).toEqual(subquery);
  });

  it('rewrites nested selects, joins, and expressions', () => {
    const derived = DerivedTableSource.as('posts', simpleSelect('post', ['userId']));
    const selectAst = SelectAst.from(table('user'))
      .addProjection('email', lowerExpr(col('user', 'email')))
      .withJoins([
        JoinAst.inner(derived, EqColJoinOn.of(col('user', 'id'), col('posts', 'userId')), true),
      ])
      .withWhere(BinaryExpr.eq(col('user', 'id'), param(0, 'userId')));

    const rewritten = selectAst.rewrite({
      tableSource: (source) => (source.name === 'user' ? table('member') : source),
      columnRef: (expr) => (expr.table === 'user' ? col('member', expr.column) : expr),
      paramRef: shiftParamRef(1),
    });

    expect(rewritten.from).toEqual(table('member'));
    expect(rewritten.projection[0]?.expr).toEqual(lowerExpr(col('member', 'email')));
    expect(rewritten.where).toEqual(BinaryExpr.eq(col('member', 'id'), param(1, 'userId')));
    expect((rewritten.joins![0]!.source as DerivedTableSource).query.projection).toEqual([
      ProjectionItem.of('userId', col('post', 'userId')),
    ]);
  });

  it('drops empty optional collections back to undefined', () => {
    const selectAst = SelectAst.from(table('user'))
      .addProjection('id', col('user', 'id'))
      .withJoins([])
      .withOrderBy([])
      .withDistinctOn([])
      .withGroupBy([]);

    expect(selectAst).toMatchObject({
      joins: undefined,
      orderBy: undefined,
      distinctOn: undefined,
      groupBy: undefined,
    });
  });

  it('collectParamRefs returns params from where clause', () => {
    const whereParam = param(42, 'userId');
    const selectAst = SelectAst.from(table('user'))
      .addProjection('id', col('user', 'id'))
      .withWhere(BinaryExpr.eq(col('user', 'id'), whereParam));

    expect(selectAst.collectParamRefs()).toEqual([whereParam]);
  });

  it('collectParamRefs returns empty array without where', () => {
    const selectAst = SelectAst.from(table('user')).addProjection('id', col('user', 'id'));

    expect(selectAst.collectParamRefs()).toEqual([]);
  });

  it('collectParamRefs traverses in deterministic clause order: from, where, having, joins', () => {
    const fromParam = param('from_val', 'from_p');
    const whereParam = param('where_val', 'where_p');
    const havingParam = param('having_val', 'having_p');
    const joinParam = param('join_val', 'join_p');

    const subquery = SelectAst.from(table('post'))
      .addProjection('id', col('post', 'id'))
      .withWhere(BinaryExpr.eq(col('post', 'id'), fromParam));

    const joinSubquery = SelectAst.from(table('comment'))
      .addProjection('id', col('comment', 'id'))
      .withWhere(BinaryExpr.eq(col('comment', 'postId'), joinParam));

    const ast = SelectAst.from(DerivedTableSource.as('sub', subquery))
      .addProjection('id', col('sub', 'id'))
      .withWhere(BinaryExpr.eq(col('sub', 'id'), whereParam))
      .withHaving(BinaryExpr.gt(col('sub', 'id'), havingParam))
      .withGroupBy([col('sub', 'id')])
      .withJoins([
        JoinAst.left(
          DerivedTableSource.as('comments', joinSubquery),
          EqColJoinOn.of(col('sub', 'id'), col('comments', 'id')),
        ),
      ]);

    expect(ast.collectParamRefs()).toEqual([fromParam, whereParam, havingParam, joinParam]);
  });

  it('rejects empty FunctionSource column aliases with a structured error', () => {
    expect(() =>
      FunctionSource.of('json_each', [], {
        alias: 'entry',
        columnAliases: [],
      }),
    ).toThrow(
      expect.objectContaining({
        name: 'StructuredError',
        code: 'RUNTIME.AST_INVALID',
        message: 'FunctionSource column aliases must not be empty',
        meta: { kind: 'function-source', field: 'columnAliases' },
      }),
    );
  });

  it('collectParamRefs traverses FunctionSource args in top-level from and in joins', () => {
    const fromArg = param('tbl', 'from_fn_p');
    const joinArg = param('col', 'join_fn_p');

    const ast = SelectAst.from(
      FunctionSource.of('pragma_table_info', [fromArg], {
        alias: 'pti',
        columnAliases: ['name', 'ord'],
      }).withOrdinality(),
    )
      .addProjection('name', col('pti', 'name'))
      .withJoins([
        JoinAst.inner(
          FunctionSource.of('some_fn', [joinArg], {
            alias: 'fn',
            columnAliases: ['col'],
          }),
          EqColJoinOn.of(col('pti', 'name'), col('fn', 'col')),
        ),
      ]);

    expect(ast.collectParamRefs()).toEqual([fromArg, joinArg]);
  });

  it('collectColumnRefs traverses FunctionSource args in top-level from and in joins', () => {
    const fromCol = col('outer', 'tbl');
    const joinCol = col('outer', 'col');

    const ast = SelectAst.from(
      FunctionSource.of('pragma_table_info', [fromCol], {
        alias: 'pti',
        columnAliases: ['name', 'ord'],
      }).withOrdinality(),
    )
      .addProjection('name', col('pti', 'name'))
      .withJoins([
        JoinAst.inner(
          FunctionSource.of('some_fn', [joinCol], {
            alias: 'fn',
            columnAliases: ['col'],
          }),
          EqColJoinOn.of(col('pti', 'name'), col('fn', 'col')),
        ),
      ]);

    expect(ast.collectColumnRefs()).toContainEqual(fromCol);
    expect(ast.collectColumnRefs()).toContainEqual(joinCol);
  });

  describe('limit and offset values', () => {
    const base = SelectAst.from(table('user')).addProjection('id', col('user', 'id'));

    const invalidArgument = (argument: 'limit' | 'offset', value: number) =>
      expect.objectContaining({
        name: 'StructuredError',
        code: 'ORM.ARGUMENT_INVALID',
        message: `${argument} must be an integer from 0 to ${Number.MAX_SAFE_INTEGER}, got ${String(value)}`,
        meta: { argument },
      });

    const rejected = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -1,
      1.5,
      1e21,
      Number.MAX_SAFE_INTEGER + 1,
    ];

    it.each([0, 25, Number.MAX_SAFE_INTEGER])('accepts %s', (value) => {
      expect(base.withLimit(value).withOffset(value)).toMatchObject({
        limit: value,
        offset: value,
      });
    });

    it('accepts expressions', () => {
      const take = param(0, 'take');
      const skip = param(1, 'skip');
      expect(base.withLimit(take).withOffset(skip)).toMatchObject({ limit: take, offset: skip });
    });

    it.each(rejected)('withLimit rejects %s', (value) => {
      expect(() => base.withLimit(value)).toThrow(invalidArgument('limit', value));
    });

    it.each(rejected)('withOffset rejects %s', (value) => {
      expect(() => base.withOffset(value)).toThrow(invalidArgument('offset', value));
    });

    it('the constructor rejects an invalid limit and an invalid offset', () => {
      const options = {
        from: table('user'),
        joins: undefined,
        projection: [ProjectionItem.of('id', col('user', 'id'))],
        where: undefined,
        orderBy: undefined,
        distinct: undefined,
        distinctOn: undefined,
        groupBy: undefined,
        having: undefined,
        limit: undefined,
        offset: undefined,
        selectAllIntent: undefined,
      };
      expect(() => new SelectAst({ ...options, limit: -5 })).toThrow(invalidArgument('limit', -5));
      expect(() => new SelectAst({ ...options, offset: 2.5 })).toThrow(
        invalidArgument('offset', 2.5),
      );
    });
  });
});
