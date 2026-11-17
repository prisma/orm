import {
  ColumnRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import { queryPlanRows } from '../src/query-plan-rows';

describe('execute query plan', () => {
  it('forwards SQL query plans to runtime.query', () => {
    const query = vi.fn();
    const executor = { query, execute: vi.fn() };
    const plan: SqlQueryPlan<{ id: number }> = {
      ast: SelectAst.from(TableSource.named('users')).withProjection([
        ProjectionItem.of('id', ColumnRef.of('users', 'id')),
      ]),
      params: [],
      meta: {
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'storage-hash',
        lane: 'orm-client',
      },
    };

    queryPlanRows(executor, plan);

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toBe(plan);
    expect(executor.execute).not.toHaveBeenCalled();
  });
});
