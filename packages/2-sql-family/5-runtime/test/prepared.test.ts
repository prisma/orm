import { instantiateExecutionStack } from '@internal/framework-components/execution';
import type {
  PreparedExecuteRequest,
  SqlDriver,
  SqlExecuteRequest,
} from '@internal/sql-relational-core/ast';
import {
  BinaryExpr,
  ColumnRef,
  collectOrderedParamRefs,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { Expression, ScopeField } from '@internal/sql-relational-core/expression';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import { createSqlExecutionStack } from '../src/sql-context';
import {
  createTestRuntime as createRuntime,
  createStubAdapter,
  createTestAdapterDescriptor,
  createTestContext,
  createTestContract,
  createTestTargetDescriptor,
} from './utils';

const testContract = createTestContract({
  targetFamily: 'sql',
  target: 'postgres',
});

interface DriverSpies {
  execute: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  acquireConnection: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function createMockDriver(rows: ReadonlyArray<Record<string, unknown>>): SqlDriver & {
  __spies: DriverSpies;
} {
  const query = vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
    for (const row of rows) yield row;
  });
  const execute = vi.fn().mockResolvedValue({ affectedRows: 0 });
  const close = vi.fn().mockResolvedValue(undefined);
  const acquireConnection = vi.fn();

  const driver: SqlDriver = {
    execute,
    query,
    connect: vi.fn().mockResolvedValue(undefined),
    acquireConnection,
    close,
  };
  return Object.assign(driver, {
    __spies: { execute, query, acquireConnection, close },
  });
}

function createSetup(options?: {
  rows?: ReadonlyArray<Record<string, unknown>>;
  middleware?: readonly SqlMiddleware[];
}) {
  const adapter = createStubAdapter();
  const lowerSpy = vi.spyOn(adapter, 'lower');
  const driver = createMockDriver(options?.rows ?? []);
  const targetDescriptor = createTestTargetDescriptor();
  const adapterDescriptor = createTestAdapterDescriptor(adapter);
  const stack = createSqlExecutionStack({
    target: targetDescriptor,
    adapter: adapterDescriptor,
    extensions: [],
  });
  const stackInstance = instantiateExecutionStack(stack);
  const context = createTestContext(testContract, adapter);
  const runtime = createRuntime({
    stackInstance,
    context,
    driver,
    verifyMarker: false,
    ...(options?.middleware ? { middleware: options.middleware } : {}),
  });
  return { runtime, driver, adapter: Object.assign(adapter, { lower: lowerSpy }) };
}

const meta = {
  target: testContract.target,
  storageHash: testContract.storage.storageHash,
  lane: 'dsl' as const,
};

function buildEqUserIdPlan(userId: Expression<ScopeField>): SqlQueryPlan<{ id: number }> {
  const users = TableSource.named('users');
  const ast = SelectAst.from(users)
    .withProjection([
      ProjectionItem.of('id', ColumnRef.of('id', 'users'), { codecId: 'pg/int4@1' }),
    ])
    .withWhere(BinaryExpr.eq(ColumnRef.of('id', 'users'), userId.buildAst()));
  return Object.freeze({
    ast,
    params: collectOrderedParamRefs(ast).map((r) => (r.kind === 'param-ref' ? r.value : undefined)),
    meta,
  });
}

type Params<D extends Record<string, unknown>> = {
  readonly [K in keyof D]: Expression<ScopeField>;
};

describe('runtime.prepare', () => {
  it('returns a PreparedStatement with a query method', async () => {
    const { runtime } = createSetup();
    const ps = await runtime.prepare({ userId: 'pg/int4@1' as const }, (params) =>
      buildEqUserIdPlan((params as Params<{ userId: unknown }>).userId),
    );
    expect(ps).toBeDefined();
    expect('execute' in ps).toBe(false);
    expect(typeof ps.query).toBe('function');
  });

  it('performs no driver I/O at prepare time', async () => {
    const { runtime, driver } = createSetup();
    await runtime.prepare({ userId: 'pg/int4@1' as const }, (params) =>
      buildEqUserIdPlan((params as Params<{ userId: unknown }>).userId),
    );
    expect(driver.__spies.execute).not.toHaveBeenCalled();
    expect(driver.__spies.query).not.toHaveBeenCalled();
    expect(driver.__spies.acquireConnection).not.toHaveBeenCalled();
  });

  it('lowers the AST exactly once at prepare time', async () => {
    const { runtime, adapter } = createSetup();
    await runtime.prepare({ userId: 'pg/int4@1' as const }, (params) =>
      buildEqUserIdPlan((params as Params<{ userId: unknown }>).userId),
    );
    expect(adapter.lower).toHaveBeenCalledTimes(1);
  });

  it('hands the driver an initially-unset handle slot on first statement.query call', async () => {
    const { runtime, driver } = createSetup({ rows: [] });
    let firstHandleGet: unknown = 'unobserved';
    driver.__spies.query.mockImplementation(async function* (req: PreparedExecuteRequest) {
      firstHandleGet = req.preparedStatementHandle.get();
      yield* [];
    });
    const ps = await runtime.prepare({ userId: 'pg/int4@1' as const }, (params) =>
      buildEqUserIdPlan((params as Params<{ userId: unknown }>).userId),
    );
    await ps.query(runtime, { userId: 1 }).toArray();
    expect(firstHandleGet).toBeUndefined();
  });

  it('queries prepared rows through the explicit runtime operation', async () => {
    const { runtime, driver } = createSetup({ rows: [{ id: 1 }] });
    const ps = await runtime.prepare({ userId: 'pg/int4@1' as const }, (params) =>
      buildEqUserIdPlan((params as Params<{ userId: unknown }>).userId),
    );

    await expect(ps.query(runtime, { userId: 1 }).toArray()).resolves.toEqual([{ id: 1 }]);

    expect(driver.__spies.query).toHaveBeenCalledOnce();
    expect(driver.__spies.execute).not.toHaveBeenCalled();
  });

  it('threads typeParams from the declaration onto PreparedParamRef.codec', async () => {
    const { runtime } = createSetup();
    const ps = await runtime.prepare(
      { userId: { codecId: 'pg/int4@1' as const, typeParams: { item: 'pg/int4@1' } } },
      (params) => buildEqUserIdPlan((params as Params<{ userId: unknown }>).userId),
    );

    const slot = ps.slots[0];
    if (slot?.kind !== 'bind') throw new Error('expected bind slot');
    expect(slot.name).toBe('userId');

    // The bind-site PreparedParamRef on the captured AST carries the full
    // CodecRef, not just the codecId — so parameterized codecs survive.
    const refs = ps.ast.collectParamRefs();
    const preparedRef = refs.find((r) => r.kind === 'prepared-param-ref');
    if (preparedRef?.kind !== 'prepared-param-ref') {
      throw new Error('expected one prepared-param-ref');
    }
    expect(preparedRef.codec).toEqual({
      codecId: 'pg/int4@1',
      typeParams: { item: 'pg/int4@1' },
    });
  });

  it('throws RUNTIME.PREPARE_UNUSED_PARAM when a declared name is not referenced', async () => {
    const { runtime } = createSetup();
    await expect(
      runtime.prepare(
        // userId IS used; email is declared but never referenced
        { userId: 'pg/int4@1' as const, email: 'pg/text@1' as const },
        (params) => buildEqUserIdPlan((params as Params<{ userId: unknown }>).userId),
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.PREPARE_UNUSED_PARAM',
      details: { unused: ['email'] },
    });
  });

  it('runs the beforeCompile middleware chain exactly once at prepare time', async () => {
    const beforeCompile = vi.fn().mockResolvedValue(undefined);
    const beforeEncode = vi.fn().mockResolvedValue(undefined);
    const onQuery = vi.fn().mockResolvedValue(undefined);
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const middleware: readonly SqlMiddleware[] = [
      {
        name: 'counter',
        familyId: 'sql',
        beforeCompile,
        beforeEncode,
        intercept: { onQuery, onExecute },
      },
    ];
    const { runtime } = createSetup({ middleware, rows: [] });

    const ps = await runtime.prepare({ userId: 'pg/int4@1' as const }, (params) =>
      buildEqUserIdPlan((params as Params<{ userId: unknown }>).userId),
    );
    expect(beforeCompile).toHaveBeenCalledTimes(1);
    expect(beforeEncode).toHaveBeenCalledTimes(0);

    // Each statement.query() runs beforeEncode but NOT beforeCompile.
    await ps.query(runtime, { userId: 1 }).toArray();
    await ps.query(runtime, { userId: 2 }).toArray();
    expect(beforeCompile).toHaveBeenCalledTimes(1);
    expect(beforeEncode).toHaveBeenCalledTimes(2);
    expect(onQuery).toHaveBeenCalledTimes(2);
    expect(onExecute).not.toHaveBeenCalled();
  });

  it('routes statement.query through driver.query with a prepared handle and reuses lowered SQL', async () => {
    const { runtime, driver, adapter } = createSetup({ rows: [{ id: 1 }] });
    const ps = await runtime.prepare({ userId: 'pg/int4@1' as const }, (params) =>
      buildEqUserIdPlan((params as Params<{ userId: unknown }>).userId),
    );

    expect(adapter.lower).toHaveBeenCalledTimes(1);
    await ps.query(runtime, { userId: 1 }).toArray();
    await ps.query(runtime, { userId: 2 }).toArray();

    // No additional lower() calls — the lowered SQL is reused.
    expect(adapter.lower).toHaveBeenCalledTimes(1);
    expect(driver.__spies.query).toHaveBeenCalledTimes(2);
    expect(driver.__spies.execute).not.toHaveBeenCalled();
  });

  it('substitutes user-supplied values at bind-site positions', async () => {
    const { runtime, driver } = createSetup({ rows: [] });
    const ps = await runtime.prepare({ userId: 'pg/int4@1' as const }, (params) =>
      buildEqUserIdPlan((params as Params<{ userId: unknown }>).userId),
    );
    await ps.query(runtime, { userId: 42 }).toArray();
    const lastCall = driver.__spies.query.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    const req = lastCall?.[0] as PreparedExecuteRequest;
    expect(req.params).toEqual([42]);
    const params = req.params;
    if (params === undefined) throw new Error('expected params');
    // No slot markers leak into the wire-format params.
    for (const p of params) {
      expect(p).not.toMatchObject({ __preparedSlotMarker: true });
    }
  });

  it('persists handle.set(value) across statement.query calls (round-trip via the slot wrapper)', async () => {
    const { runtime, driver } = createSetup({ rows: [] });
    const observed: unknown[] = [];
    driver.__spies.query.mockImplementation(async function* (req: PreparedExecuteRequest) {
      // Simulate a driver allocating a handle on first call and observing
      // the persisted value on subsequent calls.
      observed.push(req.preparedStatementHandle.get());
      if (req.preparedStatementHandle.get() === undefined) {
        req.preparedStatementHandle.set('pn_42');
      }
      yield* [];
    });
    const ps = await runtime.prepare({ userId: 'pg/int4@1' as const }, (params) =>
      buildEqUserIdPlan((params as Params<{ userId: unknown }>).userId),
    );
    await ps.query(runtime, { userId: 1 }).toArray();
    await ps.query(runtime, { userId: 2 }).toArray();
    expect(observed).toEqual([undefined, 'pn_42']);
  });

  it('produces independent results for two statement.query calls on the same handle', async () => {
    const { runtime, driver } = createSetup();
    const captured: Array<readonly unknown[]> = [];
    driver.__spies.query.mockImplementation(async function* (req: PreparedExecuteRequest) {
      const params = req.params;
      if (params === undefined) throw new Error('expected params');
      captured.push(params);
      yield { id: params[0] };
    });
    const ps = await runtime.prepare({ userId: 'pg/int4@1' as const }, (params) =>
      buildEqUserIdPlan((params as Params<{ userId: unknown }>).userId),
    );
    const a = await ps.query(runtime, { userId: 1 }).toArray();
    const b = await ps.query(runtime, { userId: 2 }).toArray();
    expect(captured).toEqual([[1], [2]]);
    expect(a).toEqual([{ id: 1 }]);
    expect(b).toEqual([{ id: 2 }]);
  });

  it('throws RUNTIME.PREPARE_MISSING_PARAM when statement.query omits a declared key', async () => {
    const { runtime } = createSetup();
    const ps = await runtime.prepare({ userId: 'pg/int4@1' as const }, (params) =>
      buildEqUserIdPlan((params as Params<{ userId: unknown }>).userId),
    );
    await expect(ps.query(runtime, {} as { userId: number }).toArray()).rejects.toMatchObject({
      code: 'RUNTIME.PREPARE_MISSING_PARAM',
      details: { name: 'userId' },
    });
  });

  it("beforeEncode's param mutator can override prepared param values before encode", async () => {
    const captured: unknown[] = [];
    const middleware: readonly SqlMiddleware[] = [
      {
        name: 'override-userId',
        familyId: 'sql',
        async beforeEncode(_plan, _ctx, params) {
          if (!params) return;
          for (const entry of params.entries()) {
            captured.push(entry.value);
            if (entry.codecId === 'pg/int4@1') {
              params.replaceValue(entry.ref, 999);
            }
          }
        },
      },
    ];
    const { runtime, driver } = createSetup({ middleware, rows: [] });
    const ps = await runtime.prepare({ userId: 'pg/int4@1' as const }, (p) =>
      buildEqUserIdPlan((p as Params<{ userId: unknown }>).userId),
    );

    await ps.query(runtime, { userId: 42 }).toArray();

    // The mutator surfaces the pre-encode user value, not the encoded one.
    expect(captured).toEqual([42]);
    // The replacement reaches the driver — encode runs after mutation.
    const lastCall = driver.__spies.query.mock.calls.at(-1);
    const req = lastCall?.[0] as PreparedExecuteRequest;
    expect(req.params).toEqual([999]);
  });

  it('does not supply a prepared handle for an ad-hoc query', async () => {
    const { runtime, driver } = createSetup({ rows: [{ id: 1 }] });
    const ref = ParamRef.of(7, { codec: { codecId: 'pg/int4@1' } });
    const users = TableSource.named('users');
    const ast = SelectAst.from(users)
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('id', 'users'), { codecId: 'pg/int4@1' }),
      ])
      .withWhere(BinaryExpr.eq(ColumnRef.of('id', 'users'), ref));
    const plan: SqlQueryPlan<{ id: number }> = Object.freeze({
      ast,
      params: collectOrderedParamRefs(ast).map((r) =>
        r.kind === 'param-ref' ? r.value : undefined,
      ),
      meta,
    });
    await runtime.query(plan).toArray();
    expect(driver.__spies.query).toHaveBeenCalledTimes(1);
    expect(driver.__spies.query).toHaveBeenCalledWith(
      expect.not.objectContaining({ preparedStatementHandle: expect.anything() }),
    );
    expect(driver.__spies.execute).not.toHaveBeenCalled();
  });
});
