import {
  AggregateExpr,
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  CaseExpr,
  CastExpr,
  ColumnRef,
  collectOrderedParamRefs,
  DerivedTableSource,
  ExistsExpr,
  FunctionCallExpr,
  FunctionSource,
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
  PreparedParamRef,
  ProjectionItem,
  RawExpr,
  SelectAst,
  SubqueryExpr,
  TableSource,
  WindowFuncExpr,
} from '@internal/sql-relational-core/ast';
import { type Expression, expressionMarker } from '@internal/sql-relational-core/expression';
import { describe, expect, it, vi } from 'vitest';
import { bindWhereExpr } from '../src/where-binding';
import { createCollectionFor } from './collection-fixtures';
import { getTestContract } from './helpers';

function parameter<C extends string, N extends boolean>(
  name: string,
  codecId: C,
  nullable: N,
): Expression<{ codecId: C; nullable: N }> {
  const ast = PreparedParamRef.of(name, { codecId }, nullable);
  return { [expressionMarker]: true, returnType: { codecId, nullable }, buildAst: () => ast };
}

const id = parameter('id', 'pg/int4@1', false);
const email = parameter('email', 'pg/text@1', false);
const optional = parameter('optional', 'pg/int4@1', true);
const column = ColumnRef.of('users', 'id');
const contract = getTestContract();
const invalid = () => BinaryExpr.eq(column, optional.buildAst());
const select = (expr: AnyExpression) =>
  SelectAst.from(TableSource.named('users'))
    .withProjection([ProjectionItem.of('id', column)])
    .withWhere(expr);
const raw = (expr: AnyExpression) =>
  new RawExpr({ parts: ['(', expr, ')'], returns: { codecId: 'pg/bool@1', nullable: false } });

it('preserves prepared refs and stable slots in shorthand, callback, relations, terminal filters and mixed fixed lists', () => {
  const { collection } = createCollectionFor('User');
  const descriptions = [
    collection.where({ id }).select('id').prepared.all(),
    collection
      .where((user) => user.id.eq(id))
      .select('id')
      .prepared.all(),
    collection.select('id').prepared.first({ id }),
    collection.select('id').prepared.first((user) => user.id.eq(id)),
    collection
      .where((user) => user.posts.some((post) => post.id.eq(id)))
      .select('id')
      .prepared.all(),
    collection
      .where((user) => user.posts.some({ id }))
      .select('id')
      .prepared.all(),
    collection
      .include('posts', (posts) => posts.where({ id }).select('id'))
      .select('id')
      .prepared.all(),
  ];
  for (const description of descriptions) {
    const refs = collectOrderedParamRefs(description.ast);
    expect(refs).toEqual([id.buildAst()]);
    expect(refs[0]).toBe(id.buildAst());
  }
  const mixed = collection
    .where((user) =>
      AndExpr.of([
        user.id.in([id, 2, id]),
        user.id.notIn([3, id]),
        user.email.like(email),
        user.invitedById.eq(id),
      ]),
    )
    .select('id')
    .prepared.all();
  expect(
    collectOrderedParamRefs(mixed.ast).map((ref) =>
      ref.kind === 'prepared-param-ref' ? ['prepared', ref.name] : ['literal', ref.value],
    ),
  ).toEqual([
    ['prepared', 'id'],
    ['literal', 2],
    ['literal', 3],
    ['prepared', 'email'],
  ]);
});

it('binds codec input objects without invoking their buildAst method', () => {
  const { collection } = createCollectionFor('Post');
  const buildAst = vi.fn(() => {
    throw new Error('not a SQL expression');
  });
  const value = Object.assign([1, 2, 3], { buildAst });
  const query = collection.where({ embedding: value }).select('id').prepared.all();
  expect(query.params).toEqual([value]);
  expect(query.params[0]).toBe(value);
  expect(buildAst).not.toHaveBeenCalled();
});

const wrappers: ReadonlyArray<readonly [string, (expr: AnyExpression) => AnyExpression]> = [
  ['direct', (expr) => expr],
  ['and', (expr) => AndExpr.of([expr])],
  ['or', (expr) => OrExpr.of([expr])],
  ['not', (expr) => new NotExpr(expr)],
  ['null-check', (expr) => NullCheckExpr.isNull(expr)],
  ['cast', (expr) => CastExpr.as(expr, 'boolean')],
  ['function', (expr) => FunctionCallExpr.of('coalesce', [expr, LiteralExpr.of(false)])],
  ['case condition', (expr) => CaseExpr.of([{ condition: expr, value: LiteralExpr.of(true) }])],
  ['case value', (expr) => CaseExpr.of([{ condition: AndExpr.true(), value: expr }])],
  [
    'case else',
    (expr) => CaseExpr.of([{ condition: AndExpr.true(), value: LiteralExpr.of(true) }], expr),
  ],
  [
    'operation self',
    (expr) =>
      new OperationExpr({
        method: 'identity',
        self: expr,
        args: undefined,
        returns: { codecId: 'pg/bool@1', nullable: false },
        lowering: { targetFamily: 'sql', strategy: 'function', template: 'identity({0})' },
      }),
  ],
  ['aggregate', (expr) => AggregateExpr.max(expr)],
  ['window', (expr) => WindowFuncExpr.rowNumber({ partitionBy: [expr] })],
  [
    'json object',
    (expr) =>
      JsonObjectExpr.fromEntries([
        JsonObjectExpr.entry('value', new NativeJsonValueProjection(expr)),
      ]),
  ],
  ['json array', (expr) => JsonArrayAggExpr.of(new NativeJsonValueProjection(expr))],
  ['list', (expr) => ListExpression.of([expr])],
  ['exists', (expr) => ExistsExpr.exists(select(expr))],
  ['subquery', (expr) => SubqueryExpr.of(select(expr))],
  [
    'derived source',
    (expr) => ExistsExpr.exists(SelectAst.from(DerivedTableSource.as('nested', select(expr)))),
  ],
  [
    'projection',
    (expr) =>
      ExistsExpr.exists(select(AndExpr.true()).withProjection([ProjectionItem.of('value', expr)])),
  ],
  ['having', (expr) => ExistsExpr.exists(select(AndExpr.true()).withHaving(expr))],
  [
    'join',
    (expr) =>
      ExistsExpr.exists(
        select(AndExpr.true()).withJoins([JoinAst.inner(TableSource.named('posts'), expr)]),
      ),
  ],
  [
    'function source',
    (expr) => ExistsExpr.exists(SelectAst.from(FunctionSource.of('unnest', [expr]))),
  ],
  [
    'order',
    (expr) => ExistsExpr.exists(select(AndExpr.true()).withOrderBy([OrderByItem.asc(expr)])),
  ],
];

const scalarSelect = (expr: AnyExpression) =>
  select(AndExpr.true())
    .withProjection([ProjectionItem.of('value', expr)])
    .withLimit(1);
const scalar = (expr: AnyExpression) => SubqueryExpr.of(scalarSelect(expr));

const scalarOperands: ReadonlyArray<readonly [string, AnyExpression]> = [
  ['right operand', BinaryExpr.eq(column, scalar(optional.buildAst()))],
  ['left operand', BinaryExpr.eq(scalar(optional.buildAst()), column)],
  [
    'fixed list',
    BinaryExpr.in(column, ListExpression.of([id.buildAst(), scalar(optional.buildAst())])),
  ],
  [
    'nested result wrappers',
    BinaryExpr.eq(
      column,
      scalar(
        CastExpr.as(
          FunctionCallExpr.of('coalesce', [scalar(optional.buildAst()), id.buildAst()]),
          'int4',
        ),
      ),
    ),
  ],
];

const unrelatedSelect = scalarSelect(id.buildAst())
  .withWhere(NullCheckExpr.isNull(optional.buildAst()))
  .withHaving(NullCheckExpr.isNull(optional.buildAst()))
  .withOrderBy([OrderByItem.asc(optional.buildAst())])
  .withGroupBy([optional.buildAst()])
  .withDistinctOn([optional.buildAst()]);
const unrelatedProjection = ExistsExpr.exists(scalarSelect(optional.buildAst()));
const independentContexts: ReadonlyArray<readonly [string, AnyExpression]> = [
  ['required scalar result', BinaryExpr.eq(column, scalar(id.buildAst()))],
  ['unrelated scalar projection', NullCheckExpr.isNull(scalar(optional.buildAst()))],
  ['EXISTS result', unrelatedProjection],
  ['unrelated SELECT clauses', BinaryExpr.eq(column, SubqueryExpr.of(unrelatedSelect))],
  [
    'source projection',
    BinaryExpr.eq(
      column,
      SubqueryExpr.of(
        scalarSelect(id.buildAst()).withFrom(
          DerivedTableSource.as('nested', scalarSelect(optional.buildAst())),
        ),
      ),
    ),
  ],
  [
    'function source argument',
    BinaryExpr.eq(
      column,
      SubqueryExpr.of(
        scalarSelect(id.buildAst()).withFrom(FunctionSource.of('unnest', [optional.buildAst()])),
      ),
    ),
  ],
  [
    'following sibling',
    AndExpr.of([BinaryExpr.eq(column, scalar(id.buildAst())), unrelatedProjection]),
  ],
  [
    'preceding sibling',
    AndExpr.of([unrelatedProjection, BinaryExpr.eq(column, scalar(id.buildAst()))]),
  ],
  ['EXISTS inside operand', BinaryExpr.eq(unrelatedProjection, LiteralExpr.of(true))],
  ['raw result payload', BinaryExpr.eq(column, scalar(raw(invalid())))],
  ['raw enclosing scalar', raw(BinaryExpr.eq(column, scalar(optional.buildAst())))],
];

describe('scalar-subquery comparison context at compilation', () => {
  it.each(scalarOperands)('rejects nullable %s before execution', (_name, expr) => {
    const { collection, runtime } = createCollectionFor('User');
    const query = collection.where({ toWhereExpr: () => expr }).select('id');
    expect(() => query.prepared.all()).toThrow(/nullable prepared parameter/i);
    expect(runtime.executions).toEqual([]);
  });
  it.each(independentContexts)('preserves %s', (_name, expr) => {
    const { collection, runtime } = createCollectionFor('User');
    const query = collection.where({ toWhereExpr: () => expr }).select('id');
    expect(query.prepared.all().ast).toBeDefined();
    expect(runtime.executions).toEqual([]);
  });
});

describe('structured nullable prepared comparisons', () => {
  it.each(wrappers)('rejects inside %s', (_name, wrap) => {
    expect(() => bindWhereExpr(contract, wrap(invalid()))).toThrow(/nullable prepared parameter/i);
  });
  it.each(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'like', 'in', 'notIn'] as const)(
    'rejects both operands of %s',
    (op) => {
      expect(() =>
        bindWhereExpr(contract, new BinaryExpr(op, optional.buildAst(), id.buildAst())),
      ).toThrow(/nullable prepared parameter/i);
      expect(() =>
        bindWhereExpr(
          contract,
          new BinaryExpr(op, column, ListExpression.of([id.buildAst(), optional.buildAst()])),
        ),
      ).toThrow(/nullable prepared parameter/i);
    },
  );
  it('rejects nullable refs nested in structured operands but not raw payloads', () => {
    expect(() =>
      bindWhereExpr(contract, BinaryExpr.eq(column, CastExpr.as(optional.buildAst(), 'int4'))),
    ).toThrow(/nullable prepared parameter/i);
    const opaque = raw(invalid());
    expect(bindWhereExpr(contract, opaque)).toBe(opaque);
    expect(
      bindWhereExpr(contract, BinaryExpr.eq(raw(optional.buildAst()), id.buildAst())),
    ).toBeDefined();
    expect(() =>
      bindWhereExpr(contract, BinaryExpr.eq(raw(optional.buildAst()), optional.buildAst())),
    ).toThrow(/nullable prepared parameter/i);
    expect(bindWhereExpr(contract, NullCheckExpr.isNull(optional.buildAst()))).toBeDefined();
  });
  it('rejects structured ToWhereExpr during compilation before runtime query', () => {
    const { collection, runtime } = createCollectionFor('User');
    const query = collection
      .where({ toWhereExpr: () => CastExpr.as(invalid(), 'boolean') })
      .select('id');
    expect(() => query.prepared.all()).toThrow(/nullable prepared parameter/i);
    expect(runtime.executions).toEqual([]);
  });
  it('rejects nullable operands through shorthand, callbacks, first and relation/include paths', () => {
    const { collection, runtime } = createCollectionFor('User');
    const unchecked = optional as unknown as number;
    const attempts = [
      () => collection.where({ invitedById: unchecked }).select('id').prepared.all(),
      () =>
        collection
          .where((user) => user.invitedById.eq(unchecked))
          .select('id')
          .prepared.all(),
      () => collection.select('id').prepared.first({ id: unchecked }),
      () => collection.select('id').prepared.first((user) => user.id.eq(unchecked)),
      () =>
        collection
          .where((user) => user.id.in([1, unchecked]))
          .select('id')
          .prepared.all(),
      () =>
        collection
          .where((user) => user.posts.some({ id: unchecked }))
          .select('id')
          .prepared.all(),
      () =>
        collection
          .include('posts', (posts) => posts.where({ id: unchecked }).select('id'))
          .select('id')
          .prepared.all(),
    ];
    for (const attempt of attempts) expect(attempt).toThrow(/nullable prepared parameter/i);
    expect(runtime.executions).toEqual([]);
  });
  it('retains literal null semantics and nullable columns with required refs', () => {
    const { collection } = createCollectionFor('User');
    const description = collection
      .where({ invitedById: null })
      .where((user) => user.invitedById.eq(id))
      .select('id')
      .prepared.all();
    expect(collectOrderedParamRefs(description.ast)).toEqual([id.buildAst()]);
    expect(description.ast).toMatchObject({
      where: {
        kind: 'and',
        exprs: [
          { kind: 'null-check', isNull: true },
          { kind: 'binary', op: 'eq' },
        ],
      },
    });
  });
});
