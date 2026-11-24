import type { MarkerReadResult } from '@internal/sql-relational-core/ast';
import { describe, expect, it, vi } from 'vitest';
import { buildRuntime, createPlan, markerRecord } from './marker-verification-fixture';

/**
 * Pins the per-result-kind branches of `verifyMarker` in `sql-runtime.ts`: absent marker
 * (warns CONTRACT.MARKER_MISSING), missing table (warns CONTRACT.MARKER_MISSING), storage-hash
 * mismatch (warns CONTRACT.MARKER_MISMATCH), profile-hash mismatch (warns CONTRACT.MARKER_MISMATCH),
 * matching marker (silent), verifyMarker: false (reader never called), and one-shot semantics
 * (at most one log per runtime lifetime).
 *
 * A marker that cannot be read, and a logger that throws, are covered by
 * `marker-read-failure.test.ts`; storage-hash mismatch ordering against middleware interceptors
 * by `marker-vs-intercept-ordering.test.ts`.
 */

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
});
