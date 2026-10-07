import {
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  type ExistsExpr,
  LiteralExpr,
  NotExpr,
  NullCheckExpr,
  ParamRef,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { bindCollectionTables } from '../src/collection-tables';
import { all, and, not, or } from '../src/filters';
import { createModelAccessor } from '../src/model-accessor';
import { normalizeWhereArg } from '../src/where-interop';
import { combineWhereExprs } from '../src/where-utils';
import { getTestContext, getTestContract, publicTables } from './helpers';

function collectParamValues(expr: AnyExpression): unknown[] {
  return expr.fold<unknown[]>({
    empty: [],
    combine: (a, b) => [...a, ...b],
    paramRef: (param) => [param.value],
    list: (list) =>
      list.values.flatMap((value) => (value instanceof ParamRef ? [value.value] : [])),
  });
}

describe('SQL ORM rich AST filters', () => {
  const contract = getTestContract();
  const context = getTestContext();

  it('builds scalar and relation filters as AST instances', () => {
    const user = createModelAccessor(
      context,
      'public',
      'User',
      bindCollectionTables(context.contract, 'public', 'User'),
    );
    const expr = and(
      user['name']!.eq('Alice'),
      user['posts']!.some((post) => post['views']!.gt(10)),
    );

    expect(expr.kind).toBe('and');
    const [nameFilter, postsFilter] = expr.exprs;
    expect(nameFilter?.kind).toBe('binary');
    expect(nameFilter).toMatchObject({
      op: 'eq',
      left: ColumnRef.of('users', 'name'),
      right: ParamRef.of('Alice', {
        codec: { codecId: 'pg/text@1' },
      }),
    });

    expect(postsFilter?.kind).toBe('exists');
    const exists = postsFilter as ExistsExpr;
    expect(exists.subquery.kind).toBe('select');
    expect(exists.subquery.from?.kind).toBe('table-source');
    expect(exists.subquery.where?.kind).toBe('and');
  });

  it('normalizes, combines, and negates bound filters', () => {
    const normalized = normalizeWhereArg(
      {
        toWhereExpr: () =>
          BinaryExpr.eq(
            ColumnRef.of('users', 'id'),
            ParamRef.of(1, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
          ),
      },
      { contract, tables: publicTables('users') },
    );

    expect(normalized.kind).toBe('binary');
    expect(collectParamValues(normalized as BinaryExpr)).toEqual([1]);

    const combined = combineWhereExprs([
      BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
      BinaryExpr.eq(
        ColumnRef.of('users', 'id'),
        ParamRef.of(1, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
      ),
    ]);
    expect(combined?.kind).toBe('and');

    expect(not(NullCheckExpr.isNull(ColumnRef.of('users', 'email')))).toEqual(
      new NotExpr(NullCheckExpr.isNull(ColumnRef.of('users', 'email'))),
    );
    expect(or(BinaryExpr.eq(ColumnRef.of('users', 'id'), LiteralExpr.of(1))).kind).toBe('or');
    expect(all().kind).toBe('and');
  });
});
