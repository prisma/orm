import {
  BinaryExpr,
  ColumnRef,
  LiteralExpr,
  ParamRef,
  SelectAst,
  type ToWhereExpr,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { bindWhereExpr } from '../src/where-binding';
import { baseContract, createCollectionFor } from './collection-fixtures';
import { publicTables } from './helpers';

describe('SQL ORM collections with rich AST plans', () => {
  it('stores direct where expressions and bound where payloads in collection state', () => {
    const { collection } = createCollectionFor('User');

    const direct = collection.where(BinaryExpr.eq(ColumnRef.of('users', 'id'), LiteralExpr.of(1)));
    expect(direct.state.filters[0]).toBeInstanceOf(BinaryExpr);
    expect(
      bindWhereExpr(
        baseContract,
        BinaryExpr.eq(ColumnRef.of('users', 'id'), LiteralExpr.of(1)),
        publicTables('users'),
      ),
    ).toEqual(direct.state.filters[0]);

    const bound = collection.where({
      toWhereExpr: () =>
        BinaryExpr.eq(
          ColumnRef.of('users', 'email'),
          ParamRef.of('a@example.com', { name: 'email', codec: { codecId: 'pg/text@1' } }),
        ),
    } satisfies ToWhereExpr);
    expect(bound.state.filters[0]).toEqual(
      BinaryExpr.eq(
        ColumnRef.of('users', 'email'),
        ParamRef.of('a@example.com', { name: 'email', codec: { codecId: 'pg/text@1' } }),
      ),
    );
  });

  it('dispatches select plans with SelectAst limits and annotations', async () => {
    const { collection, runtime } = createCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@example.com' }]]);

    const row = await collection.where((user) => user['id']!.eq(1)).first();
    expect(row).toMatchObject({ id: 1, name: 'Alice' });

    const plan = runtime.executions[0]?.plan;
    expect(plan?.ast).toBeInstanceOf(SelectAst);
    expect((plan!.ast as SelectAst).limit).toBe(1);
  });

  it('executes grouped aggregates backed by aggregate expressions', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ user_id: 1, postCount: 2, totalViews: 30 }]]);

    const rows = await collection
      .groupBy('userId')
      .having((having) => having.count().gt(1))
      .aggregate((aggregate) => ({
        postCount: aggregate.count(),
        totalViews: aggregate.sum('views'),
      }));

    expect(rows).toEqual([{ userId: 1, postCount: 2, totalViews: 30 }]);

    const plan = runtime.executions[0]?.plan;
    expect(plan?.ast).toBeInstanceOf(SelectAst);
    const ast = plan?.ast as SelectAst;
    expect(ast.having?.kind).toBe('binary');
    expect((ast.having as BinaryExpr).left.kind).toBe('aggregate');
  });
});
