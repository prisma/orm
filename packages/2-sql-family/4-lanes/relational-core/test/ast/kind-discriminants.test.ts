import { describe, expect, it } from 'vitest';
import {
  AggregateExpr,
  AndExpr,
  BinaryExpr,
  CaseExpr,
  CastExpr,
  DefaultValueExpr,
  DeleteAst,
  DerivedTableSource,
  DoNothingConflictAction,
  DoUpdateSetConflictAction,
  EqColJoinOn,
  ExistsExpr,
  FunctionCallExpr,
  InsertAst,
  InsertOnConflict,
  JoinAst,
  JsonArrayAggExpr,
  JsonObjectExpr,
  ListExpression,
  LiteralExpr,
  NativeJsonValueProjection,
  NullCheckExpr,
  OrderByItem,
  OrExpr,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  UpdateAst,
  WindowFuncExpr,
} from '../../src/exports/ast';
import { col, lowerExpr, param, table } from './test-helpers';

const minimalSelect = SelectAst.from(table('t'));

const allKindEntries: Array<[string, { kind: string }]> = [
  ['SelectAst', minimalSelect],
  ['InsertAst', InsertAst.into(table('t'))],
  ['UpdateAst', UpdateAst.table(table('t'))],
  ['DeleteAst', DeleteAst.from(table('t'))],
  ['TableSource', table('t')],
  ['DerivedTableSource', DerivedTableSource.as('sub', minimalSelect)],
  ['ColumnRef', col('t', 'id')],
  ['ParamRef', param(1)],
  ['DefaultValueExpr', new DefaultValueExpr()],
  ['LiteralExpr', LiteralExpr.of(42)],
  ['SubqueryExpr', SubqueryExpr.of(minimalSelect)],
  ['OperationExpr', lowerExpr(col('t', 'name'))],
  ['AggregateExpr', AggregateExpr.count()],
  [
    'WindowFuncExpr',
    WindowFuncExpr.rowNumber({
      partitionBy: [col('t', 'id')],
      orderBy: [OrderByItem.asc(col('t', 'id'))],
    }),
  ],
  ['FunctionCallExpr', FunctionCallExpr.of('lower', [col('t', 'name')])],
  ['CastExpr', CastExpr.as(col('t', 'value'), 'text')],
  [
    'CaseExpr',
    CaseExpr.of([
      {
        condition: BinaryExpr.eq(col('t', 'active'), LiteralExpr.of(true)),
        value: col('t', 'value'),
      },
    ]),
  ],
  [
    'JsonObjectExpr',
    JsonObjectExpr.fromEntries([{ key: 'k', value: new NativeJsonValueProjection(col('t', 'v')) }]),
  ],
  ['JsonArrayAggExpr', JsonArrayAggExpr.of(new NativeJsonValueProjection(col('t', 'v')))],
  ['ListExpression', ListExpression.of([param(1)])],
  ['BinaryExpr', BinaryExpr.eq(col('t', 'id'), param(1))],
  ['AndExpr', AndExpr.true()],
  ['OrExpr', OrExpr.false()],
  ['ExistsExpr', ExistsExpr.exists(minimalSelect)],
  ['NullCheckExpr', NullCheckExpr.isNull(col('t', 'id'))],
  ['EqColJoinOn', EqColJoinOn.of(col('a', 'id'), col('b', 'id'))],
  ['JoinAst', JoinAst.inner(table('b'), EqColJoinOn.of(col('a', 'id'), col('b', 'id')))],
  ['ProjectionItem', ProjectionItem.of('alias', col('t', 'id'))],
  ['OrderByItem', OrderByItem.asc(col('t', 'id'))],
  ['InsertOnConflict', InsertOnConflict.on([col('t', 'id')])],
  ['DoNothingConflictAction', new DoNothingConflictAction()],
  ['DoUpdateSetConflictAction', new DoUpdateSetConflictAction({ id: col('t', 'id') })],
];

describe('AST kind discriminants', () => {
  it('all kind tags are unique', () => {
    const kinds = allKindEntries.map(([, node]) => node.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});
