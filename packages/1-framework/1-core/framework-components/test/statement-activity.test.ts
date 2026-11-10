import { describe, expect, it, vi } from 'vitest';
import { executeStatement, streamStatement } from '../src/execution/run-with-middleware';
import type {
  Activity,
  ActivityContext,
  ActivityEndedResult,
  RuntimeMiddleware,
} from '../src/execution/runtime-middleware';
import {
  collect,
  contextFields,
  exec,
  executeStatementWith,
  type MockExec,
  queryStatement,
  recorder,
  yieldRows,
} from './statement-fixtures';

describe('statement activity lifecycle', () => {
  describe('order', () => {
    it('runs a query on the driver path: started, beforeEncode, onQuery, onRow, ended, finalized', async () => {
      const events: string[] = [];

      const rows = await collect(
        queryStatement([recorder('A', events), recorder('B', events)], () =>
          yieldRows([{ id: 1 }]),
        ),
      );

      expect({ rows, events }).toEqual({
        rows: [{ id: 1 }],
        events: [
          'A:started:statement',
          'B:started:statement',
          'A:beforeEncode',
          'B:beforeEncode',
          'A:onQuery',
          'B:onQuery',
          'A:onRow',
          'B:onRow',
          'A:ended:statement:succeeded',
          'B:ended:statement:succeeded',
          'A:finalized:statement:committed',
          'B:finalized:statement:committed',
        ],
      });
    });

    it('runs an intercepted query: started, beforeEncode, onQuery, ended, finalized, without onRow', async () => {
      const events: string[] = [];
      const driver = vi.fn(() => yieldRows([{ id: 'driver' }]));
      const cache: RuntimeMiddleware<MockExec> = {
        ...recorder('cache', events),
        intercept: {
          async onQuery() {
            events.push('cache:onQuery');
            return { rows: [{ id: 'cached' }] };
          },
        },
      };

      const rows = await collect(queryStatement([cache], driver));

      expect({ rows, events }).toEqual({
        rows: [{ id: 'cached' }],
        events: [
          'cache:started:statement',
          'cache:beforeEncode',
          'cache:onQuery',
          'cache:ended:statement:succeeded',
          'cache:finalized:statement:committed',
        ],
      });
      expect(driver).not.toHaveBeenCalled();
    });

    it('runs an execute on the driver path: started, beforeEncode, onExecute, ended, finalized', async () => {
      const events: string[] = [];

      const stats = await executeStatementWith([recorder('A', events)], async () => ({
        affectedRows: 2,
      }));

      expect({ stats, events }).toEqual({
        stats: { affectedRows: 2 },
        events: [
          'A:started:statement',
          'A:beforeEncode',
          'A:onExecute',
          'A:ended:statement:succeeded',
          'A:finalized:statement:committed',
        ],
      });
    });

    it('runs an intercepted execute: started, beforeEncode, onExecute, ended, finalized', async () => {
      const events: string[] = [];
      const driver = vi.fn(async () => ({ affectedRows: 99 }));
      const interceptor: RuntimeMiddleware<MockExec> = {
        ...recorder('A', events),
        intercept: {
          async onExecute() {
            events.push('A:onExecute');
            return { stats: { affectedRows: 7 } };
          },
        },
      };

      const stats = await executeStatementWith([interceptor], driver);

      expect({ stats, events }).toEqual({
        stats: { affectedRows: 7 },
        events: [
          'A:started:statement',
          'A:beforeEncode',
          'A:onExecute',
          'A:ended:statement:succeeded',
          'A:finalized:statement:committed',
        ],
      });
      expect(driver).not.toHaveBeenCalled();
    });

    it('skips hooks a middleware does not implement', async () => {
      const events: string[] = [];
      const partial: RuntimeMiddleware<MockExec> = {
        name: 'partial',
        async onRow() {
          events.push('onRow');
        },
      };

      await collect(queryStatement([partial], () => yieldRows([{ id: 1 }])));

      expect(events).toEqual(['onRow']);
    });
  });

  describe('the statement activity', () => {
    it('describes the plan, what the caller asked for, and the plan annotations', async () => {
      const activities: Activity[] = [];
      const observer: RuntimeMiddleware<MockExec> = {
        name: 'observer',
        async activityStarted(activity) {
          activities.push(activity);
        },
      };
      const annotation = {
        __annotation: true,
        namespace: 'cache',
        value: { ttl: 1 },
        applicableTo: new Set(['read']),
      };
      const plan = {
        ...exec,
        meta: { ...exec.meta, annotations: { cache: annotation, codecs: {} } },
      };

      await collect(
        streamStatement(
          { middleware: [observer], plan, context: contextFields(), parent: undefined },
          async function* () {},
        ),
      );
      await executeStatement(
        { middleware: [observer], plan: exec, context: contextFields(), parent: undefined },
        async () => ({ affectedRows: 0 }),
      );

      const [query, execute] = activities;
      expect(query).toEqual({
        id: expect.any(String),
        kind: 'statement',
        returns: 'rows',
        plan,
        annotations: new Map([['cache', annotation]]),
      });
      expect(execute).toEqual({
        id: expect.any(String),
        kind: 'statement',
        returns: 'stats',
        plan: exec,
        annotations: new Map(),
      });
      expect(query?.id).not.toBe(execute?.id);
    });

    it('reads the plan annotations only when a hook reads the activity annotations', async () => {
      const ownKeys = vi.fn((target: object) => Reflect.ownKeys(target));
      const annotations = new Proxy<Record<string, unknown>>({ codecs: {} }, { ownKeys });
      const plan = { ...exec, meta: { ...exec.meta, annotations } };
      const run = (middleware: RuntimeMiddleware<MockExec>[]) =>
        executeStatement(
          { middleware, plan, context: contextFields(), parent: undefined },
          async () => ({ affectedRows: 0 }),
        );

      await run([]);
      expect(ownKeys).not.toHaveBeenCalled();

      await run([
        {
          name: 'reader',
          async activityStarted(activity) {
            void activity.annotations.size;
          },
        },
      ]);
      expect(ownKeys).toHaveBeenCalled();
    });

    it('passes the same activity and context to every hook', async () => {
      const seen: Array<{ readonly activity?: Activity; readonly ctx: ActivityContext }> = [];
      const observer: RuntimeMiddleware<MockExec> = {
        name: 'observer',
        async activityStarted(activity, ctx) {
          seen.push({ activity, ctx });
        },
        async beforeEncode(_plan, ctx) {
          seen.push({ ctx });
        },
        intercept: {
          async onQuery(_plan, ctx) {
            seen.push({ ctx });
            return undefined;
          },
        },
        async onRow(_row, _plan, ctx) {
          seen.push({ ctx });
        },
        async activityEnded(activity, _result, ctx) {
          seen.push({ activity, ctx });
        },
        async activityFinalized(activity, _result, ctx) {
          seen.push({ activity, ctx });
        },
      };

      await collect(queryStatement([observer], () => yieldRows([{ id: 1 }])));

      expect(seen).toHaveLength(6);
      const [first] = seen;
      expect(new Set(seen.map((entry) => entry.ctx))).toEqual(new Set([first?.ctx]));
      expect(new Set(seen.flatMap((entry) => entry.activity ?? []))).toEqual(
        new Set([first?.activity]),
      );
    });

    it('starts a fresh activity and context for each statement', async () => {
      const seen: Array<{ readonly id: string; readonly ctx: ActivityContext }> = [];
      const observer: RuntimeMiddleware<MockExec> = {
        name: 'observer',
        async activityStarted(activity, ctx) {
          seen.push({ id: activity.id, ctx });
        },
      };

      await collect(queryStatement([observer], () => yieldRows([])));
      await collect(queryStatement([observer], () => yieldRows([])));

      expect(seen[0]?.id).not.toBe(seen[1]?.id);
      expect(seen[0]?.ctx).not.toBe(seen[1]?.ctx);
    });

    it('builds the context from the fields the runtime supplies, with no parent outside a transaction', async () => {
      let observed: ActivityContext | undefined;
      const fields = contextFields({ scope: 'connection' });
      const observer: RuntimeMiddleware<MockExec> = {
        name: 'observer',
        async activityStarted(_activity, ctx) {
          observed = ctx;
        },
      };

      await collect(queryStatement([observer], () => yieldRows([]), { context: fields }));

      expect(observed).toMatchObject({ ...fields, parent: undefined });
      expect(observed?.inTransaction()).toBe(false);
    });
  });

  describe('the ended result', () => {
    function resultRecorder(results: ActivityEndedResult[]): RuntimeMiddleware<MockExec> {
      return {
        name: 'results',
        async activityEnded(_activity, result) {
          results.push(result);
        },
      };
    }

    it('reports the row count, latency and driver source of a query', async () => {
      const results: ActivityEndedResult[] = [];

      await collect(queryStatement([resultRecorder(results)], () => yieldRows([{}, {}])));

      expect(results).toEqual([
        {
          kind: 'statement',
          outcome: 'succeeded',
          returns: 'rows',
          rowCount: 2,
          latencyMs: expect.any(Number),
          source: 'driver',
        },
      ]);
    });

    it('reports the statistics of a successful execute', async () => {
      const results: ActivityEndedResult[] = [];

      await executeStatementWith([resultRecorder(results)], async () => ({ affectedRows: 4 }));

      expect(results).toEqual([
        {
          kind: 'statement',
          outcome: 'succeeded',
          returns: 'stats',
          stats: { affectedRows: 4 },
          latencyMs: expect.any(Number),
          source: 'driver',
        },
      ]);
    });

    it('omits statistics when an execute fails', async () => {
      const results: ActivityEndedResult[] = [];

      await expect(
        executeStatementWith([resultRecorder(results)], async () => {
          throw new Error('driver failed');
        }),
      ).rejects.toThrow('driver failed');

      expect(results).toEqual([
        {
          kind: 'statement',
          outcome: 'failed',
          returns: 'stats',
          latencyMs: expect.any(Number),
          source: 'driver',
        },
      ]);
    });

    it('reports the rows read so far when a query fails mid-stream', async () => {
      const results: ActivityEndedResult[] = [];
      const failure = new Error('driver failed');
      async function* failingDriver() {
        yield { id: 1 };
        throw failure;
      }

      await expect(collect(queryStatement([resultRecorder(results)], failingDriver))).rejects.toBe(
        failure,
      );

      expect(results).toMatchObject([{ outcome: 'failed', returns: 'rows', rowCount: 1 }]);
    });
  });
});
