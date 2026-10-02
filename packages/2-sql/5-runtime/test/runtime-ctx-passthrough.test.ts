import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import {
  type ExecutionStackInstance,
  instantiateExecutionStack,
  type RuntimeDriverInstance,
  type RuntimeExtensionInstance,
} from '@internal/framework-components/execution';
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
 * Pins that the SQL runtime's middleware ctx exposes a working `now()` clock and `contentHash()` plan hasher even when no `log` was supplied (default noop log path).
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
      encode: (v: number) => v,
      decode: (w: number) => w,
    }),
  ];
}

function createStubAdapter() {
  const codecs = createCodecs();
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
      readMarker: async () => ({ kind: 'absent' as const }),
    },
    lower(ast: SelectAst) {
      return Object.freeze({ sql: JSON.stringify(ast), params: [] });
    },
  };
}

function createDriver(): SqlDriver {
  return {
    execute: vi.fn().mockResolvedValue({ affectedRows: 0 }),
    query: vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
      yield {} as Record<string, unknown>;
    }),
    connect: vi.fn().mockImplementation(async (_binding?: undefined) => undefined),
    acquireConnection: vi.fn().mockRejectedValue(new Error('not used')),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SQL middleware context surface', () => {
  it('exposes now() and contentHash() to middleware on a runtime with the default noop log', async () => {
    const adapter = createStubAdapter();
    const target: SqlRuntimeTargetDescriptor<'postgres'> = {
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
    const adapterDesc: SqlRuntimeAdapterDescriptor<'postgres'> = {
      kind: 'adapter',
      rawCodecInferer: { inferCodec: () => 'pg/text' },
      id: 'test-adapter',
      version: '0.0.1',
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      codecs: () => descriptorsFromCodecs(adapter.profile.codecs()),
      create() {
        return Object.assign(
          { familyId: 'sql' as const, targetId: 'postgres' as const },
          adapter,
        ) as SqlRuntimeAdapterInstance<'postgres'>;
      },
    };
    const stack = createSqlExecutionStack({ target, adapter: adapterDesc, extensions: [] });
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
      stack: { target, adapter: adapterDesc, extensions: [] },
    });

    let observedNow: number | undefined;
    let observedHash: string | undefined;
    const probe: SqlMiddleware = {
      name: 'probe',
      familyId: 'sql' as const,
      async beforeQuery(plan, ctx) {
        observedNow = ctx.now();
        observedHash = await ctx.contentHash(plan as unknown as SqlExecutionPlan);
      },
    };

    const runtime = createRuntime({
      stackInstance,
      context,
      driver: createDriver(),
      verifyMarker: false,
      middleware: [probe],
    });

    const ast = SelectAst.from(TableSource.named('users'));
    const plan: SqlExecutionPlan = {
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

    await runtime.query(plan).toArray();

    expect(observedNow).toBeTypeOf('number');
    expect(observedHash).toBeTypeOf('string');
  });
});
