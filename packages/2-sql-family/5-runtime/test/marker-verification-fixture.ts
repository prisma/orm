import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import {
  type ExecutionStackInstance,
  instantiateExecutionStack,
  type RuntimeDriverInstance,
  type RuntimeExtensionInstance,
} from '@internal/framework-components/execution';
import type { RuntimeLog } from '@internal/framework-components/runtime';
import { SqlStorage } from '@internal/sql-contract/types';
import type {
  Codec,
  MarkerReadResult,
  SqlDriver,
  SqlExecuteRequest,
} from '@internal/sql-relational-core/ast';
import { SelectAst, TableSource } from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { applicationDomainOf } from '@repo/test-utils';
import { vi } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type {
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeAdapterInstance,
  SqlRuntimeTargetDescriptor,
} from '../src/sql-context';
import { createExecutionContext, createSqlExecutionStack } from '../src/sql-context';
import { defineTestCodec } from './test-codec';
import { createTestRuntime as createRuntime, descriptorsFromCodecs } from './utils';

const testContract: Contract<SqlStorage> = {
  targetFamily: 'sql',
  target: 'postgres',
  profileHash: profileHash('test-profile'),
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

export function markerRecord(overrides: Partial<ContractMarkerRecord> = {}): ContractMarkerRecord {
  return {
    storageHash: 'test',
    profileHash: 'test-profile',
    contractJson: null,
    canonicalVersion: 1,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    appTag: null,
    meta: {},
    invariants: [],
    ...overrides,
  };
}

function createStubAdapter(
  codecs: ReadonlyArray<Codec<string>>,
  markerResult: MarkerReadResult,
  readMarkerSpy?: ReturnType<typeof vi.fn>,
) {
  const readMarkerImpl = async () => markerResult;
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
      readMarker: readMarkerSpy ?? readMarkerImpl,
    },
    lower(ast: SelectAst) {
      return Object.freeze({ sql: JSON.stringify(ast), params: [] });
    },
  };
}

export function createDriver(): SqlDriver {
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

function createTargetDescriptor(): SqlRuntimeTargetDescriptor<'postgres'> {
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

function createAdapterDescriptor(
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

type SqlTestStackInstance = ExecutionStackInstance<
  'sql',
  'postgres',
  SqlRuntimeAdapterInstance<'postgres'>,
  RuntimeDriverInstance<'sql', 'postgres'>,
  RuntimeExtensionInstance<'sql', 'postgres'>
>;

interface BuildRuntimeOptions {
  readonly markerResult: MarkerReadResult;
  readonly verifyMarker?: 'onFirstUse' | false;
  readonly log?: RuntimeLog;
  readonly driver?: SqlDriver;
  readonly readMarkerSpy?: ReturnType<typeof vi.fn>;
}

export function buildRuntime({
  markerResult,
  verifyMarker,
  log,
  driver,
  readMarkerSpy,
}: BuildRuntimeOptions) {
  const codecs = createCodecs();
  const adapter = createStubAdapter(codecs, markerResult, readMarkerSpy);
  const target = createTargetDescriptor();
  const adapterDesc = createAdapterDescriptor(adapter);
  const stack = createSqlExecutionStack({
    target,
    adapter: adapterDesc,
    extensions: [],
  });
  const stackInstance = instantiateExecutionStack(stack) as SqlTestStackInstance;
  const context = createExecutionContext({
    contract: testContract,
    stack: { target, adapter: adapterDesc, extensions: [] },
  });
  return createRuntime({
    stackInstance,
    context,
    driver: driver ?? createDriver(),
    ...(verifyMarker !== undefined ? { verifyMarker } : {}),
    ...(log ? { log } : {}),
  });
}

export function createPlan(): SqlExecutionPlan {
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

export const expectedHashes = { storageHash: 'test', profileHash: 'test-profile' };
