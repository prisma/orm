import { describe, expect, it } from 'vitest';
import type { MongoMiddleware, MongoMiddlewareContext } from '../src/mongo-middleware';
import { createMongoRuntime } from '../src/mongo-runtime';
import {
  createMockAdapter,
  createMockDriver,
  createPlan,
  makeExecution,
} from './mongo-middleware-fixtures';

describe('MongoRuntime statement activity identity', () => {
  interface Observation {
    readonly hook: 'activityStarted' | 'beforeEncode' | 'activityEnded';
    readonly id: string | undefined;
    readonly ctx: MongoMiddlewareContext;
  }

  function observerMiddleware(log: Observation[]): MongoMiddleware {
    return {
      name: 'observer',
      async activityStarted(activity, ctx) {
        log.push({ hook: 'activityStarted', id: activity.id, ctx });
      },
      async beforeEncode(_plan, ctx) {
        log.push({ hook: 'beforeEncode', id: undefined, ctx });
      },
      async activityEnded(activity, _result, ctx) {
        log.push({ hook: 'activityEnded', id: activity.id, ctx });
      },
    };
  }

  it('gives every hook of one query the same activity id and context', async () => {
    const log: Observation[] = [];
    const runtime = createMongoRuntime({
      ...makeExecution(createMockAdapter()),
      driver: createMockDriver([{ _id: '1' }]),
      middleware: [observerMiddleware(log)],
    });

    for await (const _row of runtime.query(createPlan())) {
      void _row;
    }

    expect(log.map((o) => o.hook)).toEqual(['activityStarted', 'beforeEncode', 'activityEnded']);
    expect(log[0]?.id).toBeTypeOf('string');
    expect(log[0]?.id).toBe(log[2]?.id);
    expect(new Set(log.map((o) => o.ctx)).size).toBe(1);
  });

  it('gives two queries of the same plan instance distinct activities', async () => {
    const log: Observation[] = [];
    const runtime = createMongoRuntime({
      ...makeExecution(createMockAdapter()),
      driver: createMockDriver([{ _id: '1' }]),
      middleware: [observerMiddleware(log)],
    });

    const plan = createPlan();
    for await (const _row of runtime.query(plan)) {
      void _row;
    }
    for await (const _row of runtime.query(plan)) {
      void _row;
    }

    expect(log).toHaveLength(6);
    expect(log[0]?.id).toBe(log[2]?.id);
    expect(log[3]?.id).toBe(log[5]?.id);
    expect(log[0]?.id).not.toBe(log[3]?.id);
    expect(log[0]?.ctx).not.toBe(log[3]?.ctx);
  });
});

describe('MongoRuntime middleware compatibility validation', () => {
  it('accepts a generic middleware (no familyId)', () => {
    const middleware: MongoMiddleware = { name: 'generic' };
    expect(() =>
      createMongoRuntime({
        ...makeExecution(createMockAdapter()),
        driver: createMockDriver(),
        middleware: [middleware],
      }),
    ).not.toThrow();
  });

  it('accepts a mongo middleware', () => {
    const middleware: MongoMiddleware = { name: 'mongo-specific', familyId: 'mongo' };
    expect(() =>
      createMongoRuntime({
        ...makeExecution(createMockAdapter()),
        driver: createMockDriver(),
        middleware: [middleware],
      }),
    ).not.toThrow();
  });

  it('rejects a SQL middleware with a clear error', () => {
    // Intentionally misconfigured to verify the runtime rejects mismatched familyId. The static type narrows familyId to 'mongo' | undefined, so we cast to bypass the type check and exercise the runtime path.
    const middleware = {
      name: 'sql-lints',
      familyId: 'sql' as const,
    } as unknown as MongoMiddleware;
    expect(() =>
      createMongoRuntime({
        ...makeExecution(createMockAdapter()),
        driver: createMockDriver(),
        middleware: [middleware],
      }),
    ).toThrow(
      "Middleware 'sql-lints' requires family 'sql' but the runtime is configured for family 'mongo'",
    );
  });
});
