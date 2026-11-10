import { SelectAst, TableSource } from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import { budgets } from '../src/middleware/budgets';
import { createSetup, meta } from './transaction-activity-fixtures';

function boundedSelect(): SqlExecutionPlan {
  return {
    sql: 'select id from t limit 1',
    params: [],
    ast: SelectAst.from(TableSource.named('t')).withLimit(1),
    meta,
  };
}

describe('the observed-row budget through the SQL runtime', () => {
  it('fails the row stream once the observed rows exceed maxRows with error severity', async () => {
    const { runtime } = createSetup({ middleware: [budgets({ maxRows: 1 })] });

    await expect(runtime.query(boundedSelect()).toArray()).rejects.toMatchObject({
      code: 'BUDGET.ROWS_EXCEEDED',
      details: { source: 'observed', observedRows: 2, maxRows: 1 },
    });
  });

  it('logs one warning and keeps streaming with warn severity in permissive mode', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { runtime } = createSetup({
      log,
      mode: 'permissive',
      middleware: [budgets({ maxRows: 1, severities: { rowCount: 'warn' } })],
    });

    const rows = await runtime.query(boundedSelect()).toArray();

    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'BUDGET.ROWS_EXCEEDED',
        details: { source: 'observed', observedRows: 2, maxRows: 1 },
      }),
    );
  });

  it('counts rows per statement', async () => {
    const { runtime } = createSetup({ middleware: [budgets({ maxRows: 2 })] });

    await runtime.query(boundedSelect()).toArray();

    await expect(runtime.query(boundedSelect()).toArray()).resolves.toHaveLength(2);
  });
});
