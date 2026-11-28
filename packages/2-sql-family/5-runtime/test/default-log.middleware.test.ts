import type { RuntimeLog } from '@internal/framework-components/runtime';
import { SelectAst, TableSource } from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { budgets } from '../src/middleware/budgets';
import { lints } from '../src/middleware/lints';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import { createSetup, meta } from './transaction-activity-fixtures';

function unboundedSelect(): SqlExecutionPlan {
  return {
    sql: 'select id from t',
    params: [],
    ast: SelectAst.from(TableSource.named('t')),
    meta,
  };
}

function boundedSelect(): SqlExecutionPlan {
  return {
    sql: 'select id from t limit 1',
    params: [],
    ast: SelectAst.from(TableSource.named('t')).withLimit(1),
    meta,
  };
}

const throwingLog: RuntimeLog = {
  info() {},
  warn() {
    throw new Error('logger failed');
  },
  error() {},
};

const warningMiddleware: ReadonlyArray<
  readonly [string, SqlMiddleware, () => SqlExecutionPlan, string]
> = [
  ['a lint', lints({ severities: { noLimit: 'warn' } }), unboundedSelect, 'LINT.NO_LIMIT'],
  [
    'a budget in permissive mode',
    budgets({ maxRows: 1, severities: { rowCount: 'warn' } }),
    boundedSelect,
    'BUDGET.ROWS_EXCEEDED',
  ],
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(warningMiddleware)('the warning of %s', (_name, middleware, plan, code) => {
  it('reaches console.warn when the runtime is given no log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { runtime } = createSetup({ mode: 'permissive', middleware: [middleware] });

    await runtime.query(plan()).toArray();

    expect(warn.mock.calls).toEqual(expect.arrayContaining([[expect.objectContaining({ code })]]));
  });

  it('does not fail the query when the log throws', async () => {
    const { runtime } = createSetup({
      mode: 'permissive',
      middleware: [middleware],
      log: throwingLog,
    });

    await expect(runtime.query(plan()).toArray()).resolves.toEqual(expect.any(Array));
  });
});
