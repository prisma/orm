import {
  AggregateExpr,
  type AndExpr,
  BinaryExpr,
  ColumnRef,
  type DerivedTableSource,
  type InsertAst,
  LiteralExpr,
  ParamRef,
  type SelectAst,
  type SubqueryExpr,
  type UpdateAst,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  compileDeleteReturning,
  compileGroupedAggregate,
  compileInsertReturning,
  compileSelectWithIncludes,
  compileUpdateReturning,
  compileUpsertReturning,
} from '../src/query-plan';
import { emptyState } from '../src/types';
import { baseContract, createCollectionFor } from './collection-fixtures';
import { getTestAggregates } from './helpers';

describe('SQL ORM rich AST query plans', () => {
  it('compiles include plans with AST classes and limit annotations', () => {
    const { collection } = createCollectionFor('User');
    const state = collection
      .where(() =>
        BinaryExpr.eq(
          ColumnRef.of('users', 'name'),
          ParamRef.of('Alice', { name: 'name', codec: { codecId: 'pg/text@1' } }),
        ),
      )
      .include('posts', (posts) =>
        posts.where(() =>
          BinaryExpr.gte(
            ColumnRef.of('posts', 'views'),
            ParamRef.of(100, { name: 'views', codec: { codecId: 'pg/int4@1' } }),
          ),
        ),
      )
      .take(5).state;

    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      'users',
      state,
    );

    expect(plan.ast.kind).toBe('select');
    expect(plan.params).toEqual([100, 'Alice']);
    expect((plan.ast as SelectAst).limit).toBe(5);

    const ast = plan.ast as SelectAst;
    expect(ast.where?.kind).toBe('binary');

    const postsProjection = ast.projection.find((item) => item.alias === 'posts');
    expect(postsProjection?.expr.kind).toBe('subquery');
    const aggregateQuery = (postsProjection!.expr as SubqueryExpr).query;
    expect(aggregateQuery.from?.kind).toBe('derived-table-source');

    const rowsQuery = (aggregateQuery.from as DerivedTableSource).query;
    expect(rowsQuery.where?.kind).toBe('and');
    const childFilter = (rowsQuery.where as AndExpr).exprs[1] as BinaryExpr;
    expect(childFilter.right.kind).toBe('param-ref');
    expect((childFilter.right as ParamRef).value).toBe(100);
  });

  it('compiles insert, upsert, update, delete, and grouped aggregate plans with rich nodes', () => {
    const insertPlan = compileInsertReturning(
      baseContract,
      'public',
      'users',
      [{ id: 1, name: 'Alice', email: 'a@example.com' }],
      ['id'],
    );
    expect(insertPlan.ast.kind).toBe('insert');

    const upsertPlan = compileUpsertReturning(
      baseContract,
      'public',
      'users',
      { id: 1, name: 'Alice', email: 'a@example.com' },
      { name: 'Alice Updated' },
      ['email'],
      ['id'],
    );
    expect(upsertPlan.ast.kind).toBe('insert');
    expect((upsertPlan.ast as InsertAst).onConflict?.action.kind).toBe('do-update-set');

    const updatePlan = compileUpdateReturning(
      baseContract,
      'public',
      'users',
      { email: 'b@example.com' },
      [BinaryExpr.eq(ColumnRef.of('users', 'id'), LiteralExpr.of(1))],
      ['id'],
    );
    expect(updatePlan.ast.kind).toBe('update');
    expect((updatePlan.ast as UpdateAst).where?.kind).toBe('binary');

    const deletePlan = compileDeleteReturning(
      baseContract,
      'public',
      'users',
      [BinaryExpr.eq(ColumnRef.of('users', 'id'), LiteralExpr.of(1))],
      ['id'],
    );
    expect(deletePlan.ast.kind).toBe('delete');

    const groupedPlan = compileGroupedAggregate(
      baseContract,
      getTestAggregates(),
      'public',
      'posts',
      emptyState(),
      ['user_id'],
      {
        postCount: { kind: 'aggregate', fn: 'count' },
        totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' },
      },
      BinaryExpr.gt(AggregateExpr.count(), LiteralExpr.of(1)),
    );
    expect(groupedPlan.ast.kind).toBe('select');
    const groupedAst = groupedPlan.ast as SelectAst;
    expect(groupedAst.groupBy).toEqual([ColumnRef.of('posts', 'user_id')]);
    expect(groupedAst.having?.kind).toBe('binary');
  });
});
