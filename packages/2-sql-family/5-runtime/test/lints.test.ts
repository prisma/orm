import type { Contract, PlanMeta } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  DerivedTableSource,
  ParamRef,
  ProjectionItem,
  RawQueryAst,
  SelectAst,
  TableSource,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { lints } from '../src/middleware/lints';
import type { SqlMiddlewareContext } from '../src/middleware/sql-middleware';

function createMiddlewareContext(): SqlMiddlewareContext {
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
    state: () => ({}),
    inTransaction: () => false,
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
    meta: { ...baseMeta, ...(metaOverrides ?? {}) } as PlanMeta,
    ...rest,
  } as SqlExecutionPlan;
}

const userTable = TableSource.named('user');
const idCol = ColumnRef.of('user', 'id');

describe('lints middleware', () => {
  it(
    'blocks delete without where',
    async () => {
      const plan = createPlan({ ast: DeleteAst.from(userTable) });
      const mw = lints();
      const ctx = createMiddlewareContext();

      await expect(mw.beforeEncode?.(plan, ctx)).rejects.toMatchObject({
        code: 'LINT.DELETE_WITHOUT_WHERE',
        details: { table: 'user' },
      });
    },
    timeouts.default,
  );

  it(
    'blocks update without where',
    async () => {
      const plan = createPlan({
        ast: UpdateAst.table(userTable).withSet({
          email: ParamRef.of('new@example.com', { name: 'email', codec: { codecId: 'pg/text@1' } }),
        }),
      });
      const mw = lints();
      const ctx = createMiddlewareContext();

      await expect(mw.beforeEncode?.(plan, ctx)).rejects.toMatchObject({
        code: 'LINT.UPDATE_WITHOUT_WHERE',
        details: { table: 'user' },
      });
    },
    timeouts.default,
  );

  it(
    'warns for unbounded selects and selectAll intent',
    async () => {
      const ast = SelectAst.from(userTable)
        .withProjection([ProjectionItem.of('id', idCol)])
        .withSelectAllIntent({ table: 'user' });
      const plan = createPlan({ ast });
      const mw = lints();
      const ctx = createMiddlewareContext();

      await mw.beforeEncode?.(plan, ctx);
      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'LINT.NO_LIMIT', details: { table: 'user' } }),
      );
      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'LINT.SELECT_STAR', details: { table: 'user' } }),
      );
    },
    timeouts.default,
  );

  it(
    'uses derived table aliases when reporting unbounded selects',
    async () => {
      const derived = DerivedTableSource.as(
        'user_ids',
        SelectAst.from(userTable).withProjection([ProjectionItem.of('id', idCol)]),
      );
      const ast = SelectAst.from(derived).withProjection([
        ProjectionItem.of('id', ColumnRef.of('user_ids', 'id')),
      ]);
      const plan = createPlan({ ast });
      const mw = lints();
      const ctx = createMiddlewareContext();

      await mw.beforeEncode?.(plan, ctx);
      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'LINT.NO_LIMIT',
          details: { table: 'user_ids' },
        }),
      );
    },
    timeouts.default,
  );

  it(
    'allows bounded selects and guarded mutations',
    async () => {
      const selectPlan = createPlan({
        ast: SelectAst.from(userTable)
          .withProjection([ProjectionItem.of('id', idCol)])
          .withWhere(BinaryExpr.eq(idCol, ParamRef.of(42, { codec: { codecId: 'pg/int4@1' } })))
          .withLimit(10),
      });
      const updatePlan = createPlan({
        ast: UpdateAst.table(userTable)
          .withSet({
            email: ParamRef.of('new@example.com', {
              name: 'email',
              codec: { codecId: 'pg/text@1' },
            }),
          })
          .withWhere(
            BinaryExpr.eq(idCol, ParamRef.of(1, { name: 'id', codec: { codecId: 'pg/int4@1' } })),
          ),
      });
      const mw = lints();
      const ctx = createMiddlewareContext();

      await mw.beforeEncode?.(selectPlan, ctx);
      await mw.beforeEncode?.(updatePlan, ctx);
      expect(ctx.log.warn).not.toHaveBeenCalled();
    },
    timeouts.default,
  );

  it(
    'honors configured severity overrides for every AST-level lint code',
    async () => {
      const cases = [
        {
          code: 'LINT.DELETE_WITHOUT_WHERE',
          plan: () => createPlan({ ast: DeleteAst.from(userTable) }),
          severities: { deleteWithoutWhere: 'warn' as const },
        },
        {
          code: 'LINT.UPDATE_WITHOUT_WHERE',
          plan: () =>
            createPlan({
              ast: UpdateAst.table(userTable).withSet({
                email: ParamRef.of('x', { name: 'email', codec: { codecId: 'pg/text@1' } }),
              }),
            }),
          severities: { updateWithoutWhere: 'warn' as const },
        },
        {
          code: 'LINT.NO_LIMIT',
          plan: () =>
            createPlan({
              ast: SelectAst.from(userTable).withProjection([ProjectionItem.of('id', idCol)]),
            }),
          severities: { noLimit: 'error' as const },
        },
        {
          code: 'LINT.SELECT_STAR',
          plan: () =>
            createPlan({
              ast: SelectAst.from(userTable)
                .withProjection([ProjectionItem.of('id', idCol)])
                .withLimit(1)
                .withSelectAllIntent({ table: 'user' }),
            }),
          severities: { selectStar: 'error' as const },
        },
      ];

      for (const { code, plan, severities } of cases) {
        const mw = lints({ severities });
        const ctx = createMiddlewareContext();
        const wantsError = Object.values(severities)[0] === 'error';
        const promise = mw.beforeEncode?.(plan(), ctx);
        if (wantsError) {
          await expect(promise).rejects.toMatchObject({ code });
        } else {
          await promise;
          expect(ctx.log.warn).toHaveBeenCalledWith(expect.objectContaining({ code }));
        }
      }
    },
    timeouts.default,
  );

  it(
    'returns undefined severity for codes outside the configured map',
    async () => {
      const ast = SelectAst.from(userTable)
        .withProjection([ProjectionItem.of('id', idCol)])
        .withLimit(1)
        .withSelectAllIntent({ table: 'user' });
      const mw = lints({ severities: { deleteWithoutWhere: 'warn' } });
      const ctx = createMiddlewareContext();

      await mw.beforeEncode?.(createPlan({ ast }), ctx);
      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'LINT.SELECT_STAR' }),
      );
    },
    timeouts.default,
  );

  it(
    'falls back to raw guardrail evaluation when ast is missing (default fallback: raw)',
    async () => {
      const plan = createPlan({ sql: 'SELECT * FROM "user"' });
      const mw = lints();
      const ctx = createMiddlewareContext();

      await expect(mw.beforeEncode?.(plan, ctx)).rejects.toMatchObject({
        code: 'LINT.SELECT_STAR',
      });
    },
    timeouts.default,
  );

  it(
    'warns from raw fallback when severity override downgrades a default-error code',
    async () => {
      const plan = createPlan({ sql: 'SELECT * FROM "user"' });
      const mw = lints({ severities: { selectStar: 'warn' } });
      const ctx = createMiddlewareContext();

      await mw.beforeEncode?.(plan, ctx);
      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'LINT.SELECT_STAR' }),
      );
    },
    timeouts.default,
  );

  it(
    'routes raw-query plans through the raw guardrails when an ast is present',
    async () => {
      const plan = createPlan({
        sql: 'SELECT * FROM "user"',
        ast: RawQueryAst.rows(['SELECT * FROM "user"'], {
          id: { codecId: 'pg/int4@1', nullable: false },
        }),
      });
      const mw = lints();
      const ctx = createMiddlewareContext();

      await expect(mw.beforeEncode?.(plan, ctx)).rejects.toMatchObject({
        code: 'LINT.SELECT_STAR',
      });
    },
    timeouts.default,
  );

  it(
    'skips raw fallback evaluation when fallbackWhenAstMissing is set to skip',
    async () => {
      const plan = createPlan({ sql: 'SELECT * FROM "user"' });
      const mw = lints({ fallbackWhenAstMissing: 'skip' });
      const ctx = createMiddlewareContext();

      await mw.beforeEncode?.(plan, ctx);
      expect(ctx.log.warn).not.toHaveBeenCalled();
    },
    timeouts.default,
  );
});
