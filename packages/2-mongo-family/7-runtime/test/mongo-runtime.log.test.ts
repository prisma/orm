import type { RuntimeLog } from '@internal/framework-components/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MongoMiddleware } from '../src/mongo-middleware';
import { createMongoRuntime } from '../src/mongo-runtime';
import {
  createMockAdapter,
  createMockDriver,
  createPlan,
  makeExecution,
} from './mongo-middleware-fixtures';

const failingFinalizer: MongoMiddleware = {
  name: 'failing-finalizer',
  async activityFinalized() {
    throw new Error('finalizer failed');
  },
};

const hookError = expect.objectContaining({
  event: 'middleware.activityFinalized.error',
  middleware: 'failing-finalizer',
});

const logsAtEveryLevel: MongoMiddleware = {
  name: 'logs-at-every-level',
  async beforeEncode(_plan, ctx) {
    ctx.log.debug?.({ event: 'test.debug' });
    ctx.log.info({ event: 'test.info' });
  },
};

async function queryWith(log: RuntimeLog | undefined): Promise<void> {
  const runtime = createMongoRuntime({
    ...makeExecution(createMockAdapter()),
    driver: createMockDriver([{ _id: '1' }]),
    middleware: [failingFinalizer, logsAtEveryLevel],
    ...(log ? { log } : {}),
  });
  for await (const _row of runtime.query(createPlan())) {
    void _row;
  }
}

describe('the Mongo runtime log', () => {
  let consoleCalls: () => Record<'debug' | 'info' | 'warn' | 'error', unknown[][]>;

  beforeEach(() => {
    const spies = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
    consoleCalls = () => ({
      debug: spies.debug.mock.calls,
      info: spies.info.mock.calls,
      warn: spies.warn.mock.calls,
      error: spies.error.mock.calls,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports an error a middleware hook throws on console.error when given no log', async () => {
    await queryWith(undefined);

    expect(consoleCalls()).toEqual({
      debug: [],
      info: [[{ event: 'test.info' }]],
      warn: [],
      error: [[hookError]],
    });
  });

  it('reports it to the log it is given, and not to the console', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await queryWith(log);

    expect(log.error.mock.calls).toEqual([[hookError]]);
    expect(consoleCalls()).toEqual({ debug: [], info: [], warn: [], error: [] });
  });

  it('does not fail the query when the log throws', async () => {
    const fails = () => {
      throw new Error('logger failed');
    };

    await expect(queryWith({ info: fails, warn: fails, error: fails })).resolves.toBeUndefined();
  });

  it('writes nothing to the console when given a silent log', async () => {
    await queryWith({ info() {}, warn() {}, error() {} });

    expect(consoleCalls()).toEqual({ debug: [], info: [], warn: [], error: [] });
  });
});
