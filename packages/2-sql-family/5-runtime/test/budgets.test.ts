import type { Contract, PlanMeta } from '@internal/contract/types';
import type { StatementActivity, StatementEnded } from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  AggregateExpr,
  ColumnRef,
  DeleteAst,
  DerivedTableSource,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { budgets } from '../src/middleware/budgets';
import type { SqlMiddlewareContext } from '../src/middleware/sql-middleware';

const userTable = TableSource.named('user');
const idCol = ColumnRef.of('user', 'id');

function createMiddlewareContext(overrides?: Partial<SqlMiddlewareContext>): SqlMiddlewareContext {
  return {
    contract: {} as Contract<SqlStorage>,
    mode: 'strict' as const,
    now: () => Date.now(),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    contentHash: async () => 'mock-hash',
    scope: 'runtime' as const,
    parent: undefined,
    state: mapState(),
    inTransaction: () => false,
    ...overrides,
  };
}

function mapState(): SqlMiddlewareContext['state'] {
  const states = new Map<string | symbol, Record<string | symbol, unknown>>();
  return (key) => {
    const state = states.get(key) ?? {};
    states.set(key, state);
    return state;
  };
}

function statementOf(plan: SqlExecutionPlan): StatementActivity {
  return { id: 'statement', kind: 'statement', returns: 'rows', plan, annotations: new Map() };
}

function ended(latencyMs: number): StatementEnded {
  return {
    kind: 'statement',
    outcome: 'succeeded',
    returns: 'rows',
    rowCount: 1,
    latencyMs,
    source: 'driver',
  };
}

const baseMeta: PlanMeta = {
  target: 'postgres',
  storageHash: 'test',
  lane: 'dsl',
};

type PlanOverrides = Partial<Omit<SqlExecutionPlan, 'meta'>> & { meta?: Partial<PlanMeta> };

function createPlan(overrides: PlanOverrides): SqlExecutionPlan {
  const { meta: metaOverrides, ...rest } = overrides;
  return {
    sql: 'SELECT 1',
    params: [],
    meta: { ...baseMeta, ...(metaOverrides ?? {}) } as unknown as PlanMeta,
    ...rest,
  } as unknown as SqlExecutionPlan;
}

describe('budgets middleware', () => {
  describe('observed row count (onRow)', () => {
    it(
      'throws when observed rows exceed budget',
      async () => {
        const mw = budgets({ maxRows: 2 });
        const plan = createPlan({
          sql: 'INSERT INTO "user" (id) VALUES ($1)',
        });
        const ctx = createMiddlewareContext();

        await mw.beforeEncode?.(plan, ctx);
        await mw.onRow?.({}, plan, ctx);
        await mw.onRow?.({}, plan, ctx);
        await expect(mw.onRow?.({}, plan, ctx)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
          details: expect.objectContaining({ source: 'observed' }),
        });
      },
      timeouts.default,
    );

    it(
      'tracks row counts independently per statement activity',
      async () => {
        const mw = budgets({ maxRows: 2 });
        const planA = createPlan({ sql: 'INSERT INTO "user" (id) VALUES ($1)' });
        const planB = createPlan({ sql: 'INSERT INTO "user" (id) VALUES ($2)' });
        const ctxA = createMiddlewareContext();
        const ctxB = createMiddlewareContext();

        await mw.beforeEncode?.(planA, ctxA);
        await mw.beforeEncode?.(planB, ctxB);

        await mw.onRow?.({}, planA, ctxA);
        await mw.onRow?.({}, planB, ctxB);
        await mw.onRow?.({}, planA, ctxA);
        await mw.onRow?.({}, planB, ctxB);

        await expect(mw.onRow?.({}, planA, ctxA)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
        });
        await expect(mw.onRow?.({}, planB, ctxB)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
        });
      },
      timeouts.default,
    );
  });

  describe('latency budget (activityEnded)', () => {
    it(
      'warns when latency exceeds budget in non-strict mode',
      async () => {
        const mw = budgets({ maxLatencyMs: 100, severities: { latency: 'warn' } });
        const plan = createPlan({ sql: 'SELECT 1 LIMIT 1' });
        const ctx = createMiddlewareContext({ mode: 'permissive' });
        const result = ended(200);

        await mw.activityEnded?.(statementOf(plan), result, ctx);
        expect(ctx.log.warn).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'BUDGET.TIME_EXCEEDED' }),
        );
      },
      timeouts.default,
    );

    it(
      'throws when latency exceeds budget in strict mode with error severity',
      async () => {
        const mw = budgets({ maxLatencyMs: 100, severities: { latency: 'error' } });
        const plan = createPlan({ sql: 'SELECT 1 LIMIT 1' });
        const ctx = createMiddlewareContext({ mode: 'strict' });
        const result = ended(200);

        await expect(mw.activityEnded?.(statementOf(plan), result, ctx)).rejects.toMatchObject({
          code: 'BUDGET.TIME_EXCEEDED',
          category: 'BUDGET',
        });
      },
      timeouts.default,
    );

    it(
      'throws when latency exceeds budget in strict mode even with warn severity',
      async () => {
        const mw = budgets({ maxLatencyMs: 100, severities: { latency: 'warn' } });
        const plan = createPlan({ sql: 'SELECT 1 LIMIT 1' });
        const ctx = createMiddlewareContext({ mode: 'strict' });
        const result = ended(200);

        await expect(mw.activityEnded?.(statementOf(plan), result, ctx)).rejects.toMatchObject({
          code: 'BUDGET.TIME_EXCEEDED',
          category: 'BUDGET',
        });
      },
      timeouts.default,
    );

    it(
      'throws when latency exceeds budget with error severity in permissive mode',
      async () => {
        const mw = budgets({ maxLatencyMs: 100, severities: { latency: 'error' } });
        const plan = createPlan({ sql: 'SELECT 1 LIMIT 1' });
        const ctx = createMiddlewareContext({ mode: 'permissive' });
        const result = ended(200);

        await expect(mw.activityEnded?.(statementOf(plan), result, ctx)).rejects.toMatchObject({
          code: 'BUDGET.TIME_EXCEEDED',
          category: 'BUDGET',
        });
      },
      timeouts.default,
    );

    it(
      'warns by default when latency exceeds budget in permissive mode',
      async () => {
        const mw = budgets({ maxLatencyMs: 100 });
        const plan = createPlan({ sql: 'SELECT 1 LIMIT 1' });
        const ctx = createMiddlewareContext({ mode: 'permissive' });
        const result = ended(200);

        await mw.activityEnded?.(statementOf(plan), result, ctx);
        expect(ctx.log.warn).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'BUDGET.TIME_EXCEEDED' }),
        );
      },
      timeouts.default,
    );

    it(
      'does not warn when latency is within budget',
      async () => {
        const mw = budgets({ maxLatencyMs: 1000 });
        const plan = createPlan({ sql: 'SELECT 1 LIMIT 1' });
        const ctx = createMiddlewareContext();
        const result = ended(50);

        await mw.activityEnded?.(statementOf(plan), result, ctx);
        expect(ctx.log.warn).not.toHaveBeenCalled();
      },
      timeouts.default,
    );
  });

  describe('activityEnded on a transaction', () => {
    it(
      'is ignored',
      async () => {
        const mw = budgets({ maxLatencyMs: 1 });
        const ctx = createMiddlewareContext();

        await mw.activityEnded?.(
          { id: 'transaction', kind: 'transaction', annotations: new Map() },
          { kind: 'transaction', outcome: 'succeeded' },
          ctx,
        );
        expect(ctx.log.warn).not.toHaveBeenCalled();
      },
      timeouts.default,
    );
  });

  describe('severity configuration', () => {
    it(
      'warns instead of throwing when rowCount severity is warn and mode is permissive',
      async () => {
        const ast = SelectAst.from(userTable).withProjection([ProjectionItem.of('id', idCol)]);
        const plan = createPlan({ ast });
        const mw = budgets({
          maxRows: 50,
          defaultTableRows: 10_000,
          severities: { rowCount: 'warn' },
        });
        const ctx = createMiddlewareContext({ mode: 'permissive' });

        await mw.beforeEncode?.(plan, ctx);
        expect(ctx.log.warn).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'BUDGET.ROWS_EXCEEDED' }),
        );
      },
      timeouts.default,
    );
  });

  describe('AST-based row budget', () => {
    it(
      'allows bounded SelectAst with limit within budget',
      async () => {
        const ast = SelectAst.from(userTable)
          .withProjection([ProjectionItem.of('id', idCol)])
          .withLimit(5);
        const plan = createPlan({ ast });
        const mw = budgets({ maxRows: 10_000, defaultTableRows: 10_000 });
        const ctx = createMiddlewareContext();

        await mw.beforeEncode?.(plan, ctx);
        expect(ctx.log.warn).not.toHaveBeenCalled();
      },
      timeouts.default,
    );

    it(
      'throws for unbounded SelectAst without limit',
      async () => {
        const ast = SelectAst.from(userTable).withProjection([ProjectionItem.of('id', idCol)]);
        const plan = createPlan({ ast });
        const mw = budgets({ maxRows: 50, defaultTableRows: 10_000 });
        const ctx = createMiddlewareContext();

        await expect(mw.beforeEncode?.(plan, ctx)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
          category: 'BUDGET',
          details: expect.objectContaining({ source: 'ast' }),
        });
      },
      timeouts.default,
    );

    it(
      'reads the table from the AST (FROM clause), not from sidecar metadata',
      async () => {
        const ast = SelectAst.from(userTable)
          .withProjection([ProjectionItem.of('id', idCol)])
          .withLimit(10);
        const plan = createPlan({ ast });
        const mw = budgets({
          maxRows: 4,
          defaultTableRows: 10_000,
          tableRows: { user: 5 },
        });
        const ctx = createMiddlewareContext();

        // estimatedRows: 5 can only come from tableRows[ast.from.name].
        // If FROM lookup fell back to defaultTableRows (10_000), the limit
        // would dominate Math.min and surface estimatedRows: 10 instead.
        await expect(mw.beforeEncode?.(plan, ctx)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
          category: 'BUDGET',
          details: expect.objectContaining({ source: 'ast', estimatedRows: 5 }),
        });
      },
      timeouts.default,
    );

    it(
      'does not check row budget for non-SelectAst (e.g. DeleteAst)',
      async () => {
        const ast = DeleteAst.from(userTable);
        const plan = createPlan({ ast });
        const mw = budgets({ maxRows: 1 });
        const ctx = createMiddlewareContext();

        await mw.beforeEncode?.(plan, ctx);
      },
      timeouts.default,
    );

    it(
      'estimates 1 row for aggregate without GROUP BY',
      async () => {
        const ast = SelectAst.from(userTable).withProjection([
          ProjectionItem.of('count', AggregateExpr.count()),
        ]);
        const plan = createPlan({ ast });
        const mw = budgets({ maxRows: 1, defaultTableRows: 10_000 });
        const ctx = createMiddlewareContext();

        await mw.beforeEncode?.(plan, ctx);
        expect(ctx.log.warn).not.toHaveBeenCalled();
      },
      timeouts.default,
    );

    it(
      'does not reduce estimate for aggregate with GROUP BY',
      async () => {
        const ast = SelectAst.from(userTable)
          .withProjection([ProjectionItem.of('count', AggregateExpr.count())])
          .withGroupBy([idCol]);
        const plan = createPlan({ ast });
        const mw = budgets({ maxRows: 50, defaultTableRows: 10_000 });
        const ctx = createMiddlewareContext();

        await expect(mw.beforeEncode?.(plan, ctx)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
          details: expect.objectContaining({ source: 'ast' }),
        });
      },
      timeouts.default,
    );

    it(
      'flags unbounded SELECTs even when the estimate is below the row budget',
      async () => {
        const ast = SelectAst.from(userTable).withProjection([ProjectionItem.of('id', idCol)]);
        const plan = createPlan({ ast });
        const mw = budgets({ maxRows: 100_000, defaultTableRows: 100 });
        const ctx = createMiddlewareContext();

        await expect(mw.beforeEncode?.(plan, ctx)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
          details: { source: 'ast', maxRows: 100_000 },
        });
      },
      timeouts.default,
    );

    it(
      'reads the alias from a derived table source when estimating rows',
      async () => {
        const inner = SelectAst.from(userTable)
          .withProjection([ProjectionItem.of('id', idCol)])
          .withLimit(1);
        const ast = SelectAst.from(DerivedTableSource.as('top_users', inner))
          .withProjection([ProjectionItem.of('id', ColumnRef.of('top_users', 'id'))])
          .withLimit(10);
        const plan = createPlan({ ast });
        const mw = budgets({
          maxRows: 4,
          defaultTableRows: 10_000,
          tableRows: { top_users: 5 },
        });
        const ctx = createMiddlewareContext();

        await expect(mw.beforeEncode?.(plan, ctx)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
          details: expect.objectContaining({ source: 'ast', estimatedRows: 5 }),
        });
      },
      timeouts.default,
    );
  });
});
