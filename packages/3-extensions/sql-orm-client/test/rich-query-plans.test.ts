import {
  type AndExpr,
  BinaryExpr,
  ColumnRef,
  type DerivedTableSource,
  ParamRef,
  type SelectAst,
  type SubqueryExpr,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { compileSelectWithIncludes } from '../src/query-plan';
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
      .limit(5).state;

    const plan = compileSelectWithIncludes(baseContract, getTestAggregates(), 'User', state);

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
});
