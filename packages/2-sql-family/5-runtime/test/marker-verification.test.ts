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
import { structuredError } from '@internal/utils/structured-error';
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
import { createTestRuntime as createRuntime, descriptorsFromCodecs } from './utils';

/**
 * Pins the per-result-kind branches of `verifyMarker` in `sql-runtime.ts`: absent marker
 * (warns CONTRACT.MARKER_MISSING), missing table (warns CONTRACT.MARKER_MISSING), storage-hash
 * mismatch (warns CONTRACT.MARKER_MISMATCH), profile-hash mismatch (warns CONTRACT.MARKER_MISMATCH),
 * matching marker (silent), a marker that cannot be read or decoded (warns
 * CONTRACT.MARKER_READ_FAILED or CONTRACT.MARKER_ROW_CORRUPT, the query still runs),
 * verifyMarker: false (reader never called), and one-shot semantics (at most one log per
 * runtime lifetime).
 *
 * Storage-hash mismatch ordering against middleware interceptors is covered by
 * `marker-vs-intercept-ordering.test.ts`.
 */

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

function markerRecord(overrides: Partial<ContractMarkerRecord> = {}): ContractMarkerRecord {
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

function createDriver(): SqlDriver {
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

function buildRuntime({
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

describe('verifyMarker', () => {
  it('warns with CONTRACT.MARKER_MISSING when the marker is absent', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runtime = buildRuntime({ markerResult: { kind: 'absent' }, log });

    await runtime.execute(createPlan());

    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CONTRACT.MARKER_MISSING',
        scope: 'marker-verification',
        expected: {
          storageHash: 'test',
          profileHash: 'test-profile',
        },
        actual: null,
      }),
    );
  });

  it('warns with CONTRACT.MARKER_MISSING when the marker table is missing', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runtime = buildRuntime({ markerResult: { kind: 'no-table' }, log });

    await runtime.query(createPlan()).toArray();

    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CONTRACT.MARKER_MISSING',
        scope: 'marker-verification',
        actual: null,
      }),
    );
  });

  it('emits no log when the marker record matches the contract', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runtime = buildRuntime({
      markerResult: { kind: 'present', record: markerRecord() },
      log,
    });

    await runtime.query(createPlan()).toArray();

    expect(log.warn).not.toHaveBeenCalled();
  });

  it('warns with CONTRACT.MARKER_MISMATCH when the storage hash differs', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runtime = buildRuntime({
      markerResult: {
        kind: 'present',
        record: markerRecord({ storageHash: 'stale' }),
      },
      log,
    });

    await runtime.query(createPlan()).toArray();

    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CONTRACT.MARKER_MISMATCH',
        scope: 'marker-verification',
        expected: {
          storageHash: 'test',
          profileHash: 'test-profile',
        },
        actual: expect.objectContaining({ storageHash: 'stale' }),
      }),
    );
  });

  it('warns with CONTRACT.MARKER_MISMATCH when the profile hash differs', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runtime = buildRuntime({
      markerResult: {
        kind: 'present',
        record: markerRecord({ profileHash: 'other-profile' }),
      },
      log,
    });

    await runtime.query(createPlan()).toArray();

    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CONTRACT.MARKER_MISMATCH',
        scope: 'marker-verification',
        expected: expect.objectContaining({ profileHash: 'test-profile' }),
        actual: expect.objectContaining({ profileHash: 'other-profile' }),
      }),
    );
  });

  it('skips the marker reader entirely when verifyMarker is false', async () => {
    const readMarkerSpy = vi.fn().mockResolvedValue({ kind: 'present', record: markerRecord() });
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runtime = buildRuntime({
      markerResult: { kind: 'present', record: markerRecord() },
      verifyMarker: false,
      log,
      readMarkerSpy,
    });

    await runtime.query(createPlan()).toArray();
    await runtime.query(createPlan()).toArray();

    expect(readMarkerSpy).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('emits at most one warning per runtime lifetime regardless of query count', async () => {
    const readMarkerSpy = vi.fn().mockResolvedValue({ kind: 'absent' });
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runtime = buildRuntime({
      markerResult: { kind: 'absent' },
      log,
      readMarkerSpy,
    });

    await runtime.query(createPlan()).toArray();
    await runtime.query(createPlan()).toArray();
    await runtime.query(createPlan()).toArray();

    expect(readMarkerSpy).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('single-flights the marker read under concurrent first queries', async () => {
    // Hold the marker read open until we have N concurrent query() calls
    // sitting at the verifyMarker gate. Without single-flight, each one would
    // call readMarker() and emit a log line independently.
    let releaseMarker: (result: MarkerReadResult) => void = () => {};
    const markerPromise = new Promise<MarkerReadResult>((resolve) => {
      releaseMarker = resolve;
    });
    const readMarkerSpy = vi.fn().mockImplementation(() => markerPromise);
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runtime = buildRuntime({
      markerResult: { kind: 'absent' },
      log,
      readMarkerSpy,
    });

    const inflight = [
      runtime.query(createPlan()).toArray(),
      runtime.query(createPlan()).toArray(),
      runtime.query(createPlan()).toArray(),
      runtime.query(createPlan()).toArray(),
    ];

    releaseMarker({ kind: 'absent' });
    await Promise.all(inflight);

    expect(readMarkerSpy).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  describe('when the marker cannot be read', () => {
    const expected = { storageHash: 'test', profileHash: 'test-profile' };

    function failingRuntime(failure: unknown, driver?: SqlDriver) {
      const readMarkerSpy = vi.fn().mockRejectedValue(failure);
      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const runtime = buildRuntime({
        markerResult: { kind: 'absent' },
        log,
        readMarkerSpy,
        ...(driver ? { driver } : {}),
      });
      return { runtime, log, readMarkerSpy };
    }

    it('warns with CONTRACT.MARKER_READ_FAILED and runs the query', async () => {
      const { runtime, log } = failingRuntime(
        structuredError(
          'CONTRACT.MARKER_READ_FAILED',
          'Database error while reading contract marker',
          {
            why: 'permission denied for table _prisma_marker',
          },
        ),
      );

      const rows = await runtime.query(createPlan()).toArray();

      expect(rows).toEqual([{}]);
      expect(log.warn.mock.calls).toEqual([
        [
          {
            code: 'CONTRACT.MARKER_READ_FAILED',
            scope: 'marker-verification',
            expected,
            actual: null,
            message: 'Contract marker could not be read from database',
            error: {
              code: 'CONTRACT.MARKER_READ_FAILED',
              message: 'Database error while reading contract marker',
              why: 'permission denied for table _prisma_marker',
            },
          },
        ],
      ]);
    });

    it('warns with CONTRACT.MARKER_ROW_CORRUPT and runs the query when the marker row cannot be decoded', async () => {
      const { runtime, log } = failingRuntime(
        structuredError('CONTRACT.MARKER_ROW_CORRUPT', 'Marker row is corrupt', {
          why: 'storage_hash is not a string',
        }),
      );

      const rows = await runtime.query(createPlan()).toArray();

      expect(rows).toEqual([{}]);
      expect(log.warn.mock.calls).toEqual([
        [
          {
            code: 'CONTRACT.MARKER_ROW_CORRUPT',
            scope: 'marker-verification',
            expected,
            actual: null,
            message: 'Contract marker in database could not be decoded',
            error: {
              code: 'CONTRACT.MARKER_ROW_CORRUPT',
              message: 'Marker row is corrupt',
              why: 'storage_hash is not a string',
            },
          },
        ],
      ]);
    });

    it('warns with CONTRACT.MARKER_READ_FAILED and runs the statement when a driver error passes through', async () => {
      const { runtime, log } = failingRuntime(
        structuredError('DRIVER.QUERY_FAILED', 'relation "_prisma_marker" is locked'),
      );

      await expect(runtime.execute(createPlan())).resolves.toEqual({ affectedRows: 0 });

      expect(log.warn.mock.calls).toEqual([
        [
          {
            code: 'CONTRACT.MARKER_READ_FAILED',
            scope: 'marker-verification',
            expected,
            actual: null,
            message: 'Contract marker could not be read from database',
            error: { code: 'DRIVER.QUERY_FAILED', message: 'relation "_prisma_marker" is locked' },
          },
        ],
      ]);
    });

    it('warns with CONTRACT.MARKER_READ_FAILED when the read throws something other than an Error', async () => {
      const { runtime, log } = failingRuntime('socket hang up');

      await runtime.query(createPlan()).toArray();

      expect(log.warn.mock.calls).toEqual([
        [
          {
            code: 'CONTRACT.MARKER_READ_FAILED',
            scope: 'marker-verification',
            expected,
            actual: null,
            message: 'Contract marker could not be read from database',
            error: { message: 'socket hang up' },
          },
        ],
      ]);
    });

    it('does not repeat a failed check on later queries', async () => {
      const { runtime, log, readMarkerSpy } = failingRuntime(new Error('connection reset'));

      await runtime.query(createPlan()).toArray();
      await runtime.query(createPlan()).toArray();
      await runtime.execute(createPlan());

      expect(readMarkerSpy).toHaveBeenCalledOnce();
      expect(log.warn).toHaveBeenCalledOnce();
    });

    it("warns, then rejects the query with the driver's own error when the database cannot be reached", async () => {
      const unreachable = structuredError(
        'DRIVER.CONNECTION_FAILED',
        'connect ECONNREFUSED 127.0.0.1:5432',
      );
      const driver = createDriver();
      vi.mocked(driver.query).mockImplementation(() => {
        throw unreachable;
      });
      const { runtime, log } = failingRuntime(unreachable, driver);

      await expect(runtime.query(createPlan()).toArray()).rejects.toBe(unreachable);

      expect(log.warn.mock.calls).toEqual([
        [
          {
            code: 'CONTRACT.MARKER_READ_FAILED',
            scope: 'marker-verification',
            expected,
            actual: null,
            message: 'Contract marker could not be read from database',
            error: {
              code: 'DRIVER.CONNECTION_FAILED',
              message: 'connect ECONNREFUSED 127.0.0.1:5432',
            },
          },
        ],
      ]);
    });

    it('single-flights a failing marker read under concurrent first queries', async () => {
      let failMarker: (error: Error) => void = () => {};
      const markerPromise = new Promise<MarkerReadResult>((_, reject) => {
        failMarker = reject;
      });
      const readMarkerSpy = vi.fn().mockImplementation(() => markerPromise);
      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const runtime = buildRuntime({ markerResult: { kind: 'absent' }, log, readMarkerSpy });

      const inflight = [
        runtime.query(createPlan()).toArray(),
        runtime.query(createPlan()).toArray(),
        runtime.execute(createPlan()),
      ];

      failMarker(new Error('connection reset'));
      await expect(Promise.all(inflight)).resolves.toEqual([[{}], [{}], { affectedRows: 0 }]);

      expect(readMarkerSpy).toHaveBeenCalledOnce();
      expect(log.warn).toHaveBeenCalledOnce();
    });
  });
});
