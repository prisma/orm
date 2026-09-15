import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import {
  type ExecutionStackInstance,
  instantiateExecutionStack,
  type RuntimeDriverInstance,
  type RuntimeExtensionInstance,
} from '@internal/framework-components/execution';
import { SqlStorage } from '@internal/sql-contract/types';
import type {
  Codec,
  SqlCodecCallContext,
  SqlDriver,
  SqlExecuteRequest,
} from '@internal/sql-relational-core/ast';
import {
  ColumnRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type {
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeAdapterInstance,
  SqlRuntimeTargetDescriptor,
} from '../src/sql-context';
import { createExecutionContext, createSqlExecutionStack } from '../src/sql-context';
import { defineTestCodec } from './test-codec';
import { createTestRuntime as createRuntime, descriptorsFromCodecs, stubAst } from './utils';

const testContract: Contract<SqlStorage> = {
  targetFamily: 'sql',
  target: 'postgres',
  profileHash: profileHash('test'),
  domain: applicationDomainOf({ models: {} }),
  roots: {},
  storage: new SqlStorage({
    storageHash: coreHash('test'),
    namespaces: {
      __unbound__: createTestSqlNamespace({ id: '__unbound__', entries: { table: {} } }),
    },
  }),
  extensions: {},
  capabilities: {},
  meta: {},
};

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createStubCodecs(extras: readonly Codec<string>[] = []): ReadonlyArray<Codec<string>> {
  return [...extras];
}

interface DriverOptions {
  rows?: readonly Record<string, unknown>[];
  rowGate?: () => Promise<void>;
}

function createControlledDriver(options?: DriverOptions): SqlDriver & {
  __executeMock: ReturnType<typeof vi.fn>;
  __statsMock: ReturnType<typeof vi.fn>;
} {
  const rows = options?.rows ?? [{ id: 1 }];
  const rowGate = options?.rowGate;

  const query = vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
    for (const row of rows) {
      if (rowGate) await rowGate();
      yield row;
    }
  });

  const execute = vi.fn().mockResolvedValue({ affectedRows: 0 });
  const driver: SqlDriver = {
    execute,
    query,
    connect: vi.fn().mockResolvedValue(undefined),
    acquireConnection: vi.fn().mockResolvedValue({
      execute: vi.fn().mockResolvedValue({ affectedRows: 0 }),
      query,
      release: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      beginTransaction: vi.fn(),
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return Object.assign(driver, { __executeMock: query, __statsMock: execute });
}

function createStubAdapter(extraCodecs: readonly Codec<string>[] = []) {
  const codecs = createStubCodecs(extraCodecs);
  return {
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    __codecs: codecs,
    profile: {
      id: 'test-profile',
      target: 'postgres',
      capabilities: {},
      readMarker: async () => ({ kind: 'absent' as const }),
    },
    lower(ast: unknown) {
      return Object.freeze({ sql: JSON.stringify(ast), params: [] });
    },
  };
}

function createTestSetup(extras: readonly Codec<string>[] = [], driverOptions?: DriverOptions) {
  const adapter = createStubAdapter(extras);
  const driver = createControlledDriver(driverOptions);

  const targetDescriptor: SqlRuntimeTargetDescriptor<'postgres'> = {
    kind: 'target',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => [],
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };

  const codecRegistry = adapter.__codecs;
  const adapterDescriptor: SqlRuntimeAdapterDescriptor<'postgres'> = {
    kind: 'adapter',
    rawCodecInferer: { inferCodec: () => 'pg/text' },
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => descriptorsFromCodecs(codecRegistry),
    create() {
      return Object.assign(
        { familyId: 'sql' as const, targetId: 'postgres' as const },
        adapter,
      ) as SqlRuntimeAdapterInstance<'postgres'>;
    },
  };

  const stack = createSqlExecutionStack({
    target: targetDescriptor,
    adapter: adapterDescriptor,
    extensions: [],
  });
  type SqlTestStackInstance = ExecutionStackInstance<
    'sql',
    'postgres',
    SqlRuntimeAdapterInstance<'postgres'>,
    RuntimeDriverInstance<'sql', 'postgres'>,
    RuntimeExtensionInstance<'sql', 'postgres'>
  >;
  const stackInstance = instantiateExecutionStack(stack) as SqlTestStackInstance;

  const context = createExecutionContext({
    contract: testContract,
    stack: { target: targetDescriptor, adapter: adapterDescriptor, extensions: [] },
  });

  return { stackInstance, context, driver };
}

function rawExecutionPlan(overrides?: Partial<SqlExecutionPlan>): SqlExecutionPlan {
  return {
    sql: 'select 1',
    params: [],
    ast: stubAst(),
    ...overrides,
    meta: {
      target: testContract.target,
      targetFamily: testContract.targetFamily,
      storageHash: testContract.storage.storageHash,
      lane: 'raw',
      ...overrides?.meta,
    },
  };
}

function projectingExecutionPlan(
  alias: string,
  table: string,
  column: string,
  codecId: string,
): SqlExecutionPlan {
  const ast = SelectAst.from(TableSource.named(table)).withProjection([
    ProjectionItem.of(alias, ColumnRef.of(table, column), { codecId }),
  ]);
  return {
    sql: 'select 1',
    params: [],
    ast,
    meta: {
      target: testContract.target,
      targetFamily: testContract.targetFamily,
      storageHash: testContract.storage.storageHash,
      lane: 'dsl',
    },
  };
}

describe('SqlRuntime operations with signals — abort semantics', () => {
  it('regression — omitting options is bit-for-bit identical to today (no signal supplied)', async () => {
    const { stackInstance, context, driver } = createTestSetup();
    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verifyMarker: false,
    });
    const rows = await runtime.query(rawExecutionPlan()).toArray();
    expect(rows).toEqual([{ id: 1 }]);
  });

  it('already-aborted signal at entry rejects on first next() with RUNTIME.ABORTED { phase: stream }', async () => {
    const { stackInstance, context, driver } = createTestSetup();
    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verifyMarker: false,
    });

    const controller = new AbortController();
    const reason = new Error('caller aborted before execute');
    controller.abort(reason);

    await expect(
      runtime.query(rawExecutionPlan(), { signal: controller.signal }).toArray(),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'stream' },
      cause: reason,
    });

    expect(driver.__executeMock).not.toHaveBeenCalled();
  });

  it('rejects an already-aborted statistics execution before driver delegation', async () => {
    const { stackInstance, context, driver } = createTestSetup();
    const runtime = createRuntime({ stackInstance, context, driver, verifyMarker: false });
    const controller = new AbortController();
    const reason = new Error('caller aborted before statistics execution');
    controller.abort(reason);

    await expect(
      runtime.execute(rawExecutionPlan(), { signal: controller.signal }),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'stream' },
      cause: reason,
    });

    expect(driver.__statsMock).not.toHaveBeenCalled();
  });

  it('between-rows abort exits the stream loop with RUNTIME.ABORTED { phase: stream } before pulling the next row', async () => {
    const yieldGate = deferred<void>();
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    let yielded = 0;
    const driverOptions: DriverOptions = {
      rows,
      rowGate: async () => {
        if (yielded === 1) {
          // After the first row, hold the next yield until released.
          await yieldGate.promise;
        }
        yielded += 1;
      },
    };

    const { stackInstance, context, driver } = createTestSetup([], driverOptions);
    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verifyMarker: false,
    });

    const controller = new AbortController();
    const reason = new Error('mid-stream abort');

    const result = runtime.query(rawExecutionPlan(), {
      signal: controller.signal,
    });
    const collected: unknown[] = [];
    const collector = (async () => {
      for await (const row of result) {
        collected.push(row);
        if (collected.length === 1) {
          // Simulate user cancellation between rows.
          controller.abort(reason);
          // Release the driver's next yield so the gate doesn't deadlock.
          yieldGate.resolve();
        }
      }
    })();

    await expect(collector).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'stream' },
      cause: reason,
    });
    expect(collected).toEqual([{ id: 1 }]);
  });

  it('forwards the query signal into synchronous decoding', async () => {
    let observedSignal: AbortSignal | undefined;

    const observingCodec = defineTestCodec({
      typeId: 'test/observe-signal@1',
      targetTypes: ['text'],
      encode: (v: string) => v,
      decode: (w: string, ctx?: SqlCodecCallContext) => {
        observedSignal = ctx?.signal;
        return w;
      },
    });

    const { stackInstance, context, driver } = createTestSetup([observingCodec]);
    const runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verifyMarker: false,
    });

    const plan = projectingExecutionPlan('name', 'users', 'name', 'test/observe-signal@1');
    driver.__executeMock.mockImplementationOnce(async function* () {
      yield { name: 'alice' };
    });

    const controller = new AbortController();
    const rows = await runtime.query(plan, { signal: controller.signal }).toArray();

    expect(rows).toEqual([{ name: 'alice' }]);
    expect(observedSignal).toBe(controller.signal);
  });
});
