import { SqlConnectionError, SqlQueryError } from '@internal/sql-errors';
import type { MarkerReadResult, SqlDriver } from '@internal/sql-relational-core/ast';
import { structuredError } from '@internal/utils/structured-error';
import { describe, expect, it, vi } from 'vitest';
import {
  buildRuntime,
  createDriver,
  createPlan,
  expectedHashes as expected,
  markerRecord,
} from './marker-verification-fixture';

/**
 * Pins how `verifyMarker` in `sql-runtime.ts` treats a marker it cannot use: a read that reached
 * the database and failed, or a row that cannot be decoded, logs one warning, uses up the check
 * and lets the query run; a read that could not reach the database rejects the call with the
 * driver's own error and leaves the check for the next call. A `log.warn` that throws never
 * affects a call.
 */

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

function unreachableDriver(failure: unknown): SqlDriver {
  const driver = createDriver();
  vi.mocked(driver.query).mockImplementation(() => {
    throw failure;
  });
  return driver;
}

describe('when the marker cannot be read', () => {
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

  it('warns with CONTRACT.MARKER_READ_FAILED, runs the statement and reads no more when a driver error about the statement passes through', async () => {
    const { runtime, log, readMarkerSpy } = failingRuntime(
      structuredError('DRIVER.QUERY_FAILED', 'relation "_prisma_marker" is locked'),
    );

    await expect(runtime.execute(createPlan())).resolves.toEqual({ affectedRows: 0 });
    await expect(runtime.execute(createPlan())).resolves.toEqual({ affectedRows: 0 });

    expect(readMarkerSpy).toHaveBeenCalledOnce();
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

  it('warns with CONTRACT.MARKER_READ_FAILED, runs the query and reads no more when the read statement fails on the database', async () => {
    const { runtime, log, readMarkerSpy } = failingRuntime(
      new SqlQueryError('column marker.invariants does not exist', { sqlState: '42703' }),
    );

    await expect(runtime.query(createPlan()).toArray()).resolves.toEqual([{}]);
    await expect(runtime.query(createPlan()).toArray()).resolves.toEqual([{}]);

    expect(readMarkerSpy).toHaveBeenCalledOnce();
    expect(log.warn.mock.calls).toEqual([
      [
        {
          code: 'CONTRACT.MARKER_READ_FAILED',
          scope: 'marker-verification',
          expected,
          actual: null,
          message: 'Contract marker could not be read from database',
          error: { message: 'column marker.invariants does not exist' },
        },
      ],
    ]);
  });

  it('warns and reads no more when the marker reader wrapped a statement error in CONTRACT.MARKER_READ_FAILED', async () => {
    const statementError = new SqlQueryError('permission denied for table marker', {
      sqlState: '42501',
    });
    const { runtime, log, readMarkerSpy } = failingRuntime(
      structuredError(
        'CONTRACT.MARKER_READ_FAILED',
        'Database error while reading contract marker',
        {
          why: statementError.message,
          cause: statementError,
        },
      ),
    );

    await expect(runtime.query(createPlan()).toArray()).resolves.toEqual([{}]);
    await expect(runtime.query(createPlan()).toArray()).resolves.toEqual([{}]);

    expect(readMarkerSpy).toHaveBeenCalledOnce();
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
            why: 'permission denied for table marker',
          },
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

describe('when the marker read cannot reach the database', () => {
  const refused = new SqlConnectionError('connect ECONNREFUSED 127.0.0.1:5432', {
    transient: false,
  });
  const notConnected = structuredError('DRIVER.NOT_CONNECTED', 'Postgres driver is not connected');
  const connectionFailed = structuredError(
    'DRIVER.CONNECTION_FAILED',
    'Database connection failed',
  );
  const connectionFailures = [
    ['a SqlConnectionError', refused, refused],
    [
      'a SqlConnectionError the marker reader wrapped in CONTRACT.MARKER_READ_FAILED',
      refused,
      structuredError(
        'CONTRACT.MARKER_READ_FAILED',
        'Database error while reading contract marker',
        {
          why: refused.message,
          cause: refused,
        },
      ),
    ],
    ['DRIVER.NOT_CONNECTED', notConnected, notConnected],
    ['DRIVER.CONNECTION_FAILED', connectionFailed, connectionFailed],
  ] as const;

  it.each(connectionFailures)(
    'rejects the call with the driver error unchanged after %s and warns about nothing',
    async (_, driverError, readFailure) => {
      const driver = unreachableDriver(driverError);
      const { runtime, log } = failingRuntime(readFailure, driver);

      await expect(runtime.query(createPlan()).toArray()).rejects.toBe(driverError);
      expect(driver.query).not.toHaveBeenCalled();

      expect(log.warn).not.toHaveBeenCalled();
    },
  );

  it.each(connectionFailures)(
    'checks the marker again on the next call after %s',
    async (_, driverError, readFailure) => {
      const readMarkerSpy = vi
        .fn()
        .mockRejectedValueOnce(readFailure)
        .mockResolvedValue({ kind: 'present', record: markerRecord({ storageHash: 'stale' }) });
      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const runtime = buildRuntime({ markerResult: { kind: 'absent' }, log, readMarkerSpy });

      await expect(runtime.query(createPlan()).toArray()).rejects.toBe(driverError);
      await expect(runtime.query(createPlan()).toArray()).resolves.toEqual([{}]);
      await expect(runtime.query(createPlan()).toArray()).resolves.toEqual([{}]);

      expect(readMarkerSpy).toHaveBeenCalledTimes(2);
      expect(log.warn.mock.calls).toEqual([
        [
          {
            code: 'CONTRACT.MARKER_MISMATCH',
            scope: 'marker-verification',
            expected,
            actual: { storageHash: 'stale', profileHash: 'test-profile' },
            message: 'Contract marker hash does not match runtime contract',
          },
        ],
      ]);
    },
  );

  it('rejects every concurrent first call with the same error after one read', async () => {
    const failure = new SqlConnectionError('Connection terminated due to connection timeout');
    const { runtime, log, readMarkerSpy } = failingRuntime(failure);

    const results = await Promise.allSettled([
      runtime.query(createPlan()).toArray(),
      runtime.execute(createPlan()),
    ]);

    expect(results).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    expect(readMarkerSpy).toHaveBeenCalledOnce();
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe('when log.warn throws', () => {
  const warningCases = [
    ['a missing marker', { kind: 'absent' }],
    ['a mismatched marker', { kind: 'present', record: markerRecord({ storageHash: 'stale' }) }],
  ] as const;

  function throwingLog() {
    return {
      info: vi.fn(),
      warn: vi.fn().mockImplementationOnce(() => {
        throw new Error('logger exploded');
      }),
      error: vi.fn(),
    };
  }

  it.each(warningCases)('runs the first and later queries for %s', async (_, markerResult) => {
    const readMarkerSpy = vi.fn().mockResolvedValue(markerResult);
    const log = throwingLog();
    const runtime = buildRuntime({ markerResult, log, readMarkerSpy });

    await expect(runtime.query(createPlan()).toArray()).resolves.toEqual([{}]);
    await expect(runtime.query(createPlan()).toArray()).resolves.toEqual([{}]);

    expect(readMarkerSpy).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it.each([
    ['a read failure', new Error('permission denied for table _prisma_marker')],
    [
      'a corrupt marker row',
      structuredError('CONTRACT.MARKER_ROW_CORRUPT', 'Marker row is corrupt'),
    ],
  ] as const)('runs the first and later queries for %s', async (_, failure) => {
    const readMarkerSpy = vi.fn().mockRejectedValue(failure);
    const log = throwingLog();
    const runtime = buildRuntime({ markerResult: { kind: 'absent' }, log, readMarkerSpy });

    await expect(runtime.query(createPlan()).toArray()).resolves.toEqual([{}]);
    await expect(runtime.query(createPlan()).toArray()).resolves.toEqual([{}]);

    expect(readMarkerSpy).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledOnce();
  });
});
