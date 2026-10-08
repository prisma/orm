import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import {
  type ExecutionStackInstance,
  instantiateExecutionStack,
  type RuntimeDriverInstance,
  type RuntimeExtensionInstance,
} from '@internal/framework-components/execution';
import type { RuntimeLog } from '@internal/framework-components/runtime';
import { SqlStorage } from '@internal/sql-contract/types';
import type { Codec, SqlDriver, SqlExecuteRequest } from '@internal/sql-relational-core/ast';
import { SelectAst, TableSource } from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import type {
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeAdapterInstance,
  SqlRuntimeTargetDescriptor,
} from '../src/sql-context';
import { createExecutionContext, createSqlExecutionStack } from '../src/sql-context';
import { defineTestCodec } from './test-codec';
import { createTestRuntime as createRuntime, descriptorsFromCodecs } from './utils';

/**
 * Pins the ordering invariant: marker verification runs upstream of `runWithMiddleware`, so the
 * CONTRACT.MARKER_MISMATCH warning is emitted before any `interceptQuery` hook is invoked.
 *
 * If a future refactor moves marker verification into the orchestrator or after `runWithMiddleware`,
 * this test fails — surfacing the regression that cache middleware could interceptQuery a query before
 * the runtime has checked for schema drift.
 */

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

function createCodecs(): ReadonlyArray<Codec<string>> {
  return [
    defineTestCodec({
      typeId: 'pg/int4@1',
      toWire: (v: number) => v,
      fromWire: (w: number) => w,
    }),
  ];
}

function createStubAdapter(codecs: ReadonlyArray<Codec<string>>) {
  return {
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    profile: {
      id: 'test-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return codecs;
      },
      // Stub returns a marker whose `storageHash` does not match the contract's, simulating a database whose schema is out of date relative to the running runtime.
      readMarker: async () =>
        ({
          kind: 'present',
          record: {
            storageHash: 'stale',
            profileHash: 'test',
            contractJson: null,
            canonicalVersion: 1,
            updatedAt: new Date('2026-01-01T00:00:00Z'),
            appTag: null,
            meta: {},
            invariants: [],
          },
        }) as const,
    },
    lower(ast: SelectAst) {
      return Object.freeze({ sql: JSON.stringify(ast), params: [] });
    },
  };
}

function createStubDriver(): SqlDriver {
  const query = vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
    yield {} as Record<string, unknown>;
  });

  return {
    execute: vi.fn().mockResolvedValue({ affectedRows: 0 }),
    query,
    connect: vi.fn().mockImplementation(async (_binding?: undefined) => undefined),
    acquireConnection: vi.fn().mockRejectedValue(new Error('not used in this test')),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createTestTargetDescriptor(): SqlRuntimeTargetDescriptor<'postgres'> {
  return {
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
}

function createTestAdapterDescriptor(
  adapter: ReturnType<typeof createStubAdapter>,
): SqlRuntimeAdapterDescriptor<'postgres'> {
  const descriptors = descriptorsFromCodecs(adapter.profile.codecs());
  return {
    kind: 'adapter',
    rawCodecInferer: { inferCodec: () => 'pg/text' },
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => descriptors,
    create() {
      return Object.assign(
        { familyId: 'sql' as const, targetId: 'postgres' as const },
        adapter,
      ) as SqlRuntimeAdapterInstance<'postgres'>;
    },
  };
}

function createTestSetup(middleware: readonly SqlMiddleware[], log?: RuntimeLog) {
  const codecs = createCodecs();
  const adapter = createStubAdapter(codecs);
  const driver = createStubDriver();

  const targetDescriptor = createTestTargetDescriptor();
  const adapterDescriptor = createTestAdapterDescriptor(adapter);

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

  const runtime = createRuntime({
    stackInstance,
    context,
    driver,
    ...(log ? { log } : {}),
    middleware,
  });

  return { runtime, driver };
}

function createPlan(): SqlExecutionPlan {
  const ast = SelectAst.from(TableSource.named('users'));
  return {
    sql: 'select * from users',
    params: [],
    ast,
    meta: {
      target: testContract.target,
      targetFamily: testContract.targetFamily,
      storageHash: testContract.storage.storageHash,
      lane: 'raw',
    },
  };
}

describe('marker verification runs before interceptQuery', () => {
  it('logs CONTRACT.MARKER_MISMATCH before invoking the interceptQueryor when the marker is stale', async () => {
    const callOrder: string[] = [];

    const log: RuntimeLog = {
      info: () => {},
      warn: vi.fn(() => {
        callOrder.push('verify');
      }),
      error: () => {},
    };

    const interceptQuery = vi.fn((_plan: unknown, _ctx: unknown) => {
      callOrder.push('interceptQuery');
      return Promise.resolve({ operation: 'query' as const, rows: [{ id: 1 }] });
    });
    const interceptQueryor: SqlMiddleware = {
      name: 'mock-cache',
      familyId: 'sql',
      interceptQuery,
    };

    const { runtime, driver } = createTestSetup([interceptQueryor], log);

    await runtime.query(createPlan()).toArray();

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CONTRACT.MARKER_MISMATCH',
        scope: 'marker-verification',
      }),
    );
    expect(interceptQuery).toHaveBeenCalled();
    expect(driver.execute).not.toHaveBeenCalled();
    expect(callOrder).toEqual(['verify', 'interceptQuery']);
  });
});
