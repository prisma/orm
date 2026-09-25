import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  DerivedTableSource,
  type SelectAst,
  SubqueryExpr,
} from '@internal/sql-relational-core/ast';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import { resolveIncludeRelation } from '../src/collection-contract';
import { compileSelectWithIncludes } from '../src/query-plan-select';
import type { CollectionState } from '../src/types';
import {
  buildCompositeForeignKeyContract,
  buildTestContextFromContract,
  createMockRuntime,
  isSelectAst,
} from './helpers';

const contract = buildCompositeForeignKeyContract();
const context = buildTestContextFromContract(contract);
const customers = new Collection({ runtime: createMockRuntime(), context }, 'Customer', {
  namespaceId: 'public',
});
const orders = new Collection({ runtime: createMockRuntime(), context }, 'Order', {
  namespaceId: 'public',
});

function compile(tableName: string, state: CollectionState): SqlQueryPlan {
  return compileSelectWithIncludes(
    contract,
    context.aggregateDescriptors,
    'public',
    tableName,
    state,
  );
}

function expectSelectAst(ast: unknown): asserts ast is SelectAst {
  expect(isSelectAst(ast)).toBe(true);
}

function expectSubqueryExpr(expr: unknown): asserts expr is SubqueryExpr {
  expect(expr).toBeInstanceOf(SubqueryExpr);
}

function expectDerivedTableSource(source: unknown): asserts source is DerivedTableSource {
  expect(source).toBeInstanceOf(DerivedTableSource);
}

function includeSubquery(plan: SqlQueryPlan, relationName: string): SelectAst {
  expectSelectAst(plan.ast);
  const projection = plan.ast.projection.find((item) => item.alias === relationName);
  expectSubqueryExpr(projection?.expr);
  return projection.expr.query;
}

function rowIncludeWhere(plan: SqlQueryPlan, relationName: string): AnyExpression | undefined {
  const rows = includeSubquery(plan, relationName).from;
  expectDerivedTableSource(rows);
  return rows.query.where;
}

describe('include over a composite foreign key', () => {
  it('resolveIncludeRelation() pairs every key column in both directions', () => {
    expect(resolveIncludeRelation(contract, 'public', 'Order', 'customer')).toEqual({
      relatedModelName: 'Customer',
      relatedNamespaceId: 'public',
      relatedTableName: 'customers',
      localTableName: 'orders',
      targetColumns: ['tenant_id', 'id'],
      localColumns: ['tenant_id', 'customer_id'],
      cardinality: 'N:1',
    });
    expect(resolveIncludeRelation(contract, 'public', 'Customer', 'orders')).toEqual({
      relatedModelName: 'Order',
      relatedNamespaceId: 'public',
      relatedTableName: 'orders',
      localTableName: 'customers',
      targetColumns: ['tenant_id', 'customer_id'],
      localColumns: ['tenant_id', 'id'],
      cardinality: '1:N',
    });
  });

  it('correlates a to-one include on every key column', () => {
    const plan = compile('orders', orders.include('customer').state);

    expect(rowIncludeWhere(plan, 'customer')).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('customers', 'tenant_id'), ColumnRef.of('orders', 'tenant_id')),
        BinaryExpr.eq(ColumnRef.of('customers', 'id'), ColumnRef.of('orders', 'customer_id')),
      ]),
    );
  });

  it('correlates a to-many include on every key column', () => {
    const plan = compile('customers', customers.include('orders').state);

    expect(rowIncludeWhere(plan, 'orders')).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('orders', 'tenant_id'), ColumnRef.of('customers', 'tenant_id')),
        BinaryExpr.eq(ColumnRef.of('orders', 'customer_id'), ColumnRef.of('customers', 'id')),
      ]),
    );
  });

  it('correlates a count() include on every key column', () => {
    // A contract built with the DSL types relation cardinality as a union, so the type of the
    // include refinement drops count() even though `orders` is to-many.
    const countRelated = (related: unknown): unknown =>
      (related as { count: () => unknown }).count();
    const plan = compile(
      'customers',
      customers.include('orders', (o) => countRelated(o) as never).state,
    );

    expect(includeSubquery(plan, 'orders').where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('orders', 'tenant_id'), ColumnRef.of('customers', 'tenant_id')),
        BinaryExpr.eq(ColumnRef.of('orders', 'customer_id'), ColumnRef.of('customers', 'id')),
      ]),
    );
  });

  it('rejects an include whose join column lists differ in length', () => {
    const state = orders.include('customer').state;
    const include = state.includes[0]!;

    expect(() =>
      compile('orders', { ...state, includes: [{ ...include, targetColumns: ['tenant_id'] }] }),
    ).toThrow("Include 'customer' has mismatched join column counts: 2 local, 1 target");
  });
});
