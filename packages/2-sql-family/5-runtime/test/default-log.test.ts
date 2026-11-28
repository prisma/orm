import type { RuntimeLog } from '@internal/framework-components/runtime';
import type { MarkerReadResult } from '@internal/sql-relational-core/ast';
import { structuredError } from '@internal/utils/structured-error';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import { buildRuntime, createPlan, markerRecord } from './marker-verification-fixture';

const consoleMethods = ['debug', 'info', 'warn', 'error'] as const;
type ConsoleMethod = (typeof consoleMethods)[number];

let spies: Record<ConsoleMethod, ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  spies = {
    debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    info: vi.spyOn(console, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

function consoleCalls(): Record<ConsoleMethod, unknown[][]> {
  return {
    debug: spies.debug.mock.calls,
    info: spies.info.mock.calls,
    warn: spies.warn.mock.calls,
    error: spies.error.mock.calls,
  };
}

const silent: RuntimeLog = { info() {}, warn() {}, error() {} };

const markerResults: ReadonlyArray<readonly [string, MarkerReadResult, string]> = [
  [
    'a marker for another contract',
    { kind: 'present', record: markerRecord({ storageHash: 'stale' }) },
    'CONTRACT.MARKER_MISMATCH',
  ],
  ['a missing marker', { kind: 'absent' }, 'CONTRACT.MARKER_MISSING'],
];

function failingFinalizer(): SqlMiddleware {
  return {
    name: 'failing-finalizer',
    familyId: 'sql',
    async activityFinalized() {
      throw new Error('finalizer failed');
    },
  };
}

function logsAtEveryLevel(): SqlMiddleware {
  return {
    name: 'logs-at-every-level',
    familyId: 'sql',
    async beforeEncode(_plan, ctx) {
      ctx.log.debug?.({ event: 'test.debug' });
      ctx.log.info({ event: 'test.info' });
    },
  };
}

describe('a runtime given no log', () => {
  it.each(markerResults)('warns of %s on console.warn once', async (_name, markerResult, code) => {
    const runtime = buildRuntime({ markerResult });

    await runtime.query(createPlan()).toArray();
    await runtime.query(createPlan()).toArray();

    expect(consoleCalls()).toEqual({
      debug: [],
      info: [],
      warn: [[expect.objectContaining({ code, scope: 'marker-verification' })]],
      error: [],
    });
  });

  it('warns of a marker it cannot read on console.warn once', async () => {
    const readMarkerSpy = vi
      .fn()
      .mockRejectedValue(
        structuredError(
          'CONTRACT.MARKER_READ_FAILED',
          'Database error while reading contract marker',
        ),
      );
    const runtime = buildRuntime({ markerResult: { kind: 'absent' }, readMarkerSpy });

    await runtime.query(createPlan()).toArray();

    expect(spies.warn.mock.calls).toEqual([
      [expect.objectContaining({ code: 'CONTRACT.MARKER_READ_FAILED' })],
    ]);
  });

  it('reports an error a middleware hook throws on console.error', async () => {
    const runtime = buildRuntime({
      markerResult: { kind: 'present', record: markerRecord() },
      middleware: [failingFinalizer()],
    });

    await runtime.query(createPlan()).toArray();

    expect(spies.error.mock.calls).toEqual([
      [
        expect.objectContaining({
          event: 'middleware.activityFinalized.error',
          middleware: 'failing-finalizer',
        }),
      ],
    ]);
  });

  it('writes a middleware info event to console.info and drops its debug event', async () => {
    const runtime = buildRuntime({
      markerResult: { kind: 'present', record: markerRecord() },
      middleware: [logsAtEveryLevel()],
    });

    await runtime.query(createPlan()).toArray();

    expect(consoleCalls()).toEqual({
      debug: [],
      info: [[{ event: 'test.info' }]],
      warn: [],
      error: [],
    });
  });
});

describe('a runtime given a silent log', () => {
  it('writes nothing to the console', async () => {
    const runtime = buildRuntime({
      markerResult: { kind: 'absent' },
      log: silent,
      middleware: [failingFinalizer(), logsAtEveryLevel()],
    });

    await runtime.query(createPlan()).toArray();

    expect(consoleCalls()).toEqual({ debug: [], info: [], warn: [], error: [] });
  });
});

class RecordingLog {
  readonly warnings: unknown[] = [];
  info(): void {}
  warn(event: unknown): void {
    this.warnings.push(event);
  }
  error(): void {}
}

describe('a runtime given a log', () => {
  it('calls its methods with the log as this', async () => {
    const log = new RecordingLog();
    const runtime = buildRuntime({ markerResult: { kind: 'absent' }, log });

    await runtime.query(createPlan()).toArray();

    expect(log.warnings).toEqual([expect.objectContaining({ code: 'CONTRACT.MARKER_MISSING' })]);
  });

  it('looks each method up when it logs', async () => {
    const log: RuntimeLog = { info() {}, warn() {}, error() {} };
    const runtime = buildRuntime({ markerResult: { kind: 'absent' }, log });
    const replacement = vi.fn();
    log.warn = replacement;

    await runtime.query(createPlan()).toArray();

    expect(replacement.mock.calls).toEqual([
      [expect.objectContaining({ code: 'CONTRACT.MARKER_MISSING' })],
    ]);
  });
});
