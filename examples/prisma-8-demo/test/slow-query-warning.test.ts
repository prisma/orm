/**
 * Offline unit tests for the custom `slowQueryWarning` middleware example.
 *
 * Drives the middleware's `beforeEncode` and `activityEnded` hooks directly with a hand-built execution plan, statement activity and context — no database required. The plan's `ast` and `meta` come from a real DSL build so the shapes match what the runtime hands to middleware.
 */
import type {
  SqlMiddlewareContext,
  StatementActivity,
  StatementEnded,
} from '@prisma/orm-postgres/family-runtime';
import { describe, expect, it } from 'vitest';
import { db } from '../src/prisma/db';
import { slowQueryWarning } from '../src/prisma/slow-query-warning';

function makeContext(warnEvents: unknown[]): SqlMiddlewareContext {
  const states = new Map<string | symbol, Record<string | symbol, unknown>>();
  return {
    contract: db.contract,
    mode: 'strict',
    now: () => Date.now(),
    log: {
      info: () => {},
      warn: (event) => {
        warnEvents.push(event);
      },
      error: () => {},
    },
    contentHash: async () => 'test-content-hash',
    scope: 'runtime',
    parent: undefined,
    state(key) {
      const state = states.get(key) ?? {};
      states.set(key, state);
      return state;
    },
    inTransaction: () => false,
  };
}

function makeExecutionPlan() {
  const built = db.sql.public.user.select('id', 'email').limit(1).build();
  return {
    sql: 'SELECT "id", "email" FROM "user" LIMIT 1',
    params: [],
    ast: built.ast,
    meta: built.meta,
  };
}

function makeActivity(): StatementActivity {
  return {
    id: 'test-activity',
    kind: 'statement',
    returns: 'rows',
    plan: makeExecutionPlan(),
    annotations: new Map(),
  };
}

function makeResult(latencyMs: number): StatementEnded {
  return {
    kind: 'statement',
    outcome: 'succeeded',
    returns: 'rows',
    rowCount: 1,
    latencyMs,
    source: 'driver',
  };
}

async function runStatement(
  middleware: ReturnType<typeof slowQueryWarning>,
  latencyMs: number,
  warnEvents: unknown[],
): Promise<void> {
  const ctx = makeContext(warnEvents);
  await middleware.beforeEncode?.(makeExecutionPlan(), ctx);
  await middleware.activityEnded?.(makeActivity(), makeResult(latencyMs), ctx);
}

describe('slowQueryWarning middleware', () => {
  it('logs a warning when latency exceeds the threshold', async () => {
    const warnEvents: unknown[] = [];

    await runStatement(slowQueryWarning({ thresholdMs: 250 }), 900, warnEvents);

    expect(warnEvents).toHaveLength(1);
    expect(warnEvents[0]).toMatchObject({
      code: 'APP.SLOW_QUERY',
      details: {
        sql: 'SELECT "id", "email" FROM "user" LIMIT 1',
        latencyMs: 900,
        rowCount: 1,
        source: 'driver',
        activityId: 'test-activity',
      },
    });
  });

  it('stays silent at or below the threshold', async () => {
    const warnEvents: unknown[] = [];

    await runStatement(slowQueryWarning({ thresholdMs: 250 }), 250, warnEvents);

    expect(warnEvents).toHaveLength(0);
  });

  it('defaults the threshold to 250ms', async () => {
    const warnEvents: unknown[] = [];

    await runStatement(slowQueryWarning(), 251, warnEvents);

    expect(warnEvents).toHaveLength(1);
  });

  it('ignores the end of a transaction', async () => {
    const warnEvents: unknown[] = [];

    await slowQueryWarning({ thresholdMs: 0 }).activityEnded?.(
      { id: 'tx', kind: 'transaction', annotations: new Map() },
      { kind: 'transaction', outcome: 'succeeded' },
      makeContext(warnEvents),
    );

    expect(warnEvents).toHaveLength(0);
  });
});
