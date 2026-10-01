import type { Contract, PlanMeta } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  LiteralExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { runBeforeCompileChain } from '../src/middleware/before-compile-chain';
import type {
  DraftPlan,
  SqlMiddleware,
  SqlMiddlewareContext,
} from '../src/middleware/sql-middleware';
import { defineTestCodec } from './test-codec';
import { buildTestContractCodecs } from './utils';

function createContext(): SqlMiddlewareContext & {
  log: { debug: ReturnType<typeof vi.fn> };
} {
  const debug = vi.fn();
  return {
    contract: {} as Contract<SqlStorage>,
    mode: 'strict' as const,
    now: () => 0,
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug,
    },
    contentHash: async () => 'mock-hash',
    scope: 'runtime' as const,
    planExecutionId: 'test-fixture-plan-execution-id',
  };
}

const meta: PlanMeta = {
  target: 'postgres',
  storageHash: 'test',
  lane: 'dsl',
};

function createDraft(): DraftPlan {
  const users = TableSource.named('users');
  return {
    ast: SelectAst.from(users).withProjection([]),
    meta,
  };
}

describe('runBeforeCompileChain', () => {
  it(
    'returns the initial draft unchanged when no middleware rewrites',
    async () => {
      const draft = createDraft();
      const ctx = createContext();
      const mw: SqlMiddleware = {
        name: 'noop',
        familyId: 'sql',
        async beforeCompile() {
          return undefined;
        },
      };

      const result = await runBeforeCompileChain([mw], draft, ctx);

      expect(result).toBe(draft);
      expect(ctx.log.debug).not.toHaveBeenCalled();
    },
    timeouts.default,
  );

  it(
    'treats a returned draft with same ast reference as passthrough',
    async () => {
      const draft = createDraft();
      const ctx = createContext();
      const mw: SqlMiddleware = {
        name: 'sameRef',
        familyId: 'sql',
        async beforeCompile(d) {
          return { ...d };
        },
      };

      const result = await runBeforeCompileChain([mw], draft, ctx);

      expect(result.ast).toBe(draft.ast);
      expect(ctx.log.debug).not.toHaveBeenCalled();
    },
    timeouts.default,
  );

  it(
    'replaces the current draft when a middleware returns a new ast ref',
    async () => {
      const draft = createDraft();
      const ctx = createContext();
      const addWhere = BinaryExpr.eq(ColumnRef.of('users', 'deleted_at'), LiteralExpr.of(null));
      const mw: SqlMiddleware = {
        name: 'softDelete',
        familyId: 'sql',
        async beforeCompile(d) {
          if (d.ast.kind !== 'select') return;
          return { ...d, ast: d.ast.withWhere(addWhere) };
        },
      };

      const result = await runBeforeCompileChain([mw], draft, ctx);

      expect(result.ast).not.toBe(draft.ast);
      expect(result.ast.kind).toBe('select');
      expect((result.ast as SelectAst).where).toBe(addWhere);
    },
    timeouts.default,
  );

  it(
    'chains rewrites in registration order',
    async () => {
      const draft = createDraft();
      const ctx = createContext();
      const order: string[] = [];

      const predA = BinaryExpr.eq(ColumnRef.of('users', 'a'), LiteralExpr.of(1));
      const predB = BinaryExpr.eq(ColumnRef.of('users', 'b'), LiteralExpr.of(2));

      const mwA: SqlMiddleware = {
        name: 'addA',
        familyId: 'sql',
        async beforeCompile(d) {
          order.push('A');
          if (d.ast.kind !== 'select') return;
          return { ...d, ast: d.ast.withWhere(predA) };
        },
      };
      const mwB: SqlMiddleware = {
        name: 'addB',
        familyId: 'sql',
        async beforeCompile(d) {
          order.push('B');
          if (d.ast.kind !== 'select') return;
          const current = d.ast.where;
          const combined = current ? AndExpr.of([current, predB]) : predB;
          return { ...d, ast: d.ast.withWhere(combined) };
        },
      };

      const result = await runBeforeCompileChain([mwA, mwB], draft, ctx);

      expect(order).toEqual(['A', 'B']);
      expect(result.ast.kind).toBe('select');
      const where = (result.ast as SelectAst).where;
      expect(where?.kind).toBe('and');
    },
    timeouts.default,
  );

  it(
    'emits a debug log event per rewrite with middleware name and lane',
    async () => {
      const draft = createDraft();
      const ctx = createContext();
      const pred = BinaryExpr.eq(ColumnRef.of('users', 'a'), LiteralExpr.of(1));
      const mw: SqlMiddleware = {
        name: 'rewriteOne',
        familyId: 'sql',
        async beforeCompile(d) {
          if (d.ast.kind !== 'select') return;
          return { ...d, ast: d.ast.withWhere(pred) };
        },
      };

      await runBeforeCompileChain([mw, mw], draft, ctx);

      expect(ctx.log.debug).toHaveBeenCalledTimes(2);
      expect(ctx.log.debug).toHaveBeenCalledWith({
        event: 'middleware.rewrite',
        middleware: 'rewriteOne',
        lane: 'dsl',
      });
    },
    timeouts.default,
  );

  it(
    'skips middleware without beforeCompile',
    async () => {
      const draft = createDraft();
      const ctx = createContext();
      const observerOnly: SqlMiddleware = {
        name: 'observer',
        familyId: 'sql',
        async beforeQuery() {},
      };

      const result = await runBeforeCompileChain([observerOnly], draft, ctx);

      expect(result).toBe(draft);
      expect(ctx.log.debug).not.toHaveBeenCalled();
    },
    timeouts.default,
  );

  it(
    'surfaces middleware-introduced ParamRefs through the rewritten AST (no sidecar to re-derive)',
    async () => {
      const draft = createDraft();
      const ctx = createContext();
      const introducedParam = ParamRef.of(1, {
        name: 'mw_user_id',
        codec: { codecId: 'pg/int4@1' },
      });
      const idEqOne = BinaryExpr.eq(ColumnRef.of('users', 'id'), introducedParam);
      const mw: SqlMiddleware = {
        name: 'onlyAlice',
        familyId: 'sql',
        async beforeCompile(d) {
          if (d.ast.kind !== 'select') return;
          return { ...d, ast: d.ast.withWhere(idEqOne) };
        },
      };

      const result = await runBeforeCompileChain([mw], draft, ctx);

      expect(result.ast.collectParamRefs()).toEqual([introducedParam]);
    },
    timeouts.default,
  );

  it(
    'surfaces ParamRefs added by chained rewrites in traversal order',
    async () => {
      const draft = createDraft();
      const ctx = createContext();
      const gteRef = ParamRef.of(2, { name: 'mw_gte', codec: { codecId: 'pg/int4@1' } });
      const lteRef = ParamRef.of(3, { name: 'mw_lte', codec: { codecId: 'pg/int4@1' } });
      const gte2 = BinaryExpr.gte(ColumnRef.of('users', 'id'), gteRef);
      const lte3 = BinaryExpr.lte(ColumnRef.of('users', 'id'), lteRef);
      const lower: SqlMiddleware = {
        name: 'lower',
        familyId: 'sql',
        async beforeCompile(d) {
          if (d.ast.kind !== 'select') return;
          return { ...d, ast: d.ast.withWhere(gte2) };
        },
      };
      const upper: SqlMiddleware = {
        name: 'upper',
        familyId: 'sql',
        async beforeCompile(d) {
          if (d.ast.kind !== 'select') return;
          const cur = (d.ast as SelectAst).where;
          const combined = cur ? AndExpr.of([cur, lte3]) : lte3;
          return { ...d, ast: d.ast.withWhere(combined) };
        },
      };

      const result = await runBeforeCompileChain([lower, upper], draft, ctx);

      expect(result.ast.collectParamRefs()).toEqual([gteRef, lteRef]);
    },
    timeouts.default,
  );

  it(
    'leaves the meta object unchanged when no middleware rewrites the ast',
    async () => {
      const draft = createDraft();
      const ctx = createContext();
      const noop: SqlMiddleware = {
        name: 'noop',
        familyId: 'sql',
        async beforeCompile() {
          return undefined;
        },
      };

      const result = await runBeforeCompileChain([noop], draft, ctx);

      expect(result.meta).toBe(draft.meta);
    },
    timeouts.default,
  );

  it(
    'preserves meta fields untouched when middleware rewrites the ast',
    async () => {
      const baseDraft = createDraft();
      const draft: DraftPlan = {
        ast: baseDraft.ast,
        meta: {
          target: 'postgres',
          storageHash: 'test',
          lane: 'orm-client',
        },
      };
      const ctx = createContext();
      const pred = BinaryExpr.eq(
        ColumnRef.of('users', 'id'),
        ParamRef.of(7, { codec: { codecId: 'pg/int4@1' } }),
      );
      const mw: SqlMiddleware = {
        name: 'add-where',
        familyId: 'sql',
        async beforeCompile(d) {
          if (d.ast.kind !== 'select') return;
          return { ...d, ast: d.ast.withWhere(pred) };
        },
      };

      const result = await runBeforeCompileChain([mw], draft, ctx);

      expect(result.meta).toBe(draft.meta);
      expect(result.meta.lane).toBe('orm-client');
      expect(result.meta.target).toBe('postgres');
    },
    timeouts.default,
  );

  it(
    'propagates errors thrown inside beforeCompile',
    async () => {
      const draft = createDraft();
      const ctx = createContext();
      const mw: SqlMiddleware = {
        name: 'thrower',
        familyId: 'sql',
        async beforeCompile() {
          throw new Error('boom');
        },
      };

      await expect(runBeforeCompileChain([mw], draft, ctx)).rejects.toThrow('boom');
    },
    timeouts.default,
  );

  it(
    'beforeCompile alias-swap rewrites the AST and the decoder reads from it',
    async () => {
      const decoderRegistry = [
        defineTestCodec({
          typeId: 'pg/int4@1',
          targetTypes: ['int4'],
          encode: (v: number) => v,
          decode: (w: number) => w + 100,
        }),
      ];

      const initialAst = SelectAst.from(TableSource.named('users')).withProjection([
        ProjectionItem.of('id', ColumnRef.of('users', 'id'), { codecId: 'pg/int4@1' }),
      ]);
      const initial: DraftPlan = { ast: initialAst, meta };
      const ctx = createContext();

      const renameAlias: SqlMiddleware = {
        name: 'rename-alias',
        familyId: 'sql',
        async beforeCompile(d) {
          if (d.ast.kind !== 'select') return;
          const renamed = d.ast.projection.map((item) =>
            ProjectionItem.of('user_id', item.expr, item.codec),
          );
          return { ...d, ast: d.ast.withProjection(renamed) };
        },
      };

      const result = await runBeforeCompileChain([renameAlias], initial, ctx);

      expect(result.ast.kind).toBe('select');
      const select = result.ast as SelectAst;
      expect(select.projection.map((p) => p.alias)).toEqual(['user_id']);
      expect(select.projection[0]?.codec?.codecId).toBe('pg/int4@1');

      const { buildDecodeContext, decodeRow, sqlNativeArrayListDecoder } = await import(
        '../src/codecs/decoding'
      );
      const plan: SqlExecutionPlan = {
        sql: 'SELECT users.id AS user_id FROM users',
        params: [],
        ast: result.ast,
        meta: result.meta,
      };
      const row = await decodeRow(
        { user_id: 7 },
        buildDecodeContext(plan.ast, buildTestContractCodecs(decoderRegistry)),
        {},
        sqlNativeArrayListDecoder,
      );
      expect(row).toEqual({ user_id: 107 });
    },
    timeouts.default,
  );

  it(
    'decodes RETURNING values via ProjectionItem.codec on a mutation AST',
    async () => {
      const { InsertAst } = await import('@internal/sql-relational-core/ast');

      const decoderRegistry = [
        defineTestCodec({
          typeId: 'pg/int4@1',
          targetTypes: ['int4'],
          encode: (v: number) => v,
          decode: (w: number) => w + 100,
        }),
      ];

      const insert = InsertAst.into(TableSource.named('users'))
        .withRows([{ id: ParamRef.of(1, { name: 'id', codec: { codecId: 'pg/int4@1' } }) }])
        .withReturning([
          ProjectionItem.of('id', ColumnRef.of('users', 'id'), { codecId: 'pg/int4@1' }),
        ]);

      const { buildDecodeContext, decodeRow, sqlNativeArrayListDecoder } = await import(
        '../src/codecs/decoding'
      );
      const plan: SqlExecutionPlan = {
        sql: 'INSERT INTO users (id) VALUES ($1) RETURNING users.id',
        params: [1],
        ast: insert,
        meta,
      };
      const row = await decodeRow(
        { id: 7 },
        buildDecodeContext(plan.ast, buildTestContractCodecs(decoderRegistry)),
        {},
        sqlNativeArrayListDecoder,
      );
      expect(row).toEqual({ id: 107 });
    },
    timeouts.default,
  );
});
