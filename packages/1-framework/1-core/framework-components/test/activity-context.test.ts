import { describe, expect, it } from 'vitest';
import type { ActivityContext, RuntimeMiddleware } from '../src/execution/runtime-middleware';
import { startTransactionActivity } from '../src/execution/transaction-activity';
import {
  collect,
  contextFields,
  executeStatementWith,
  type MockExec,
  queryStatement,
  yieldRows,
} from './statement-fixtures';

const key = Symbol('test');

describe('ActivityContext.state', () => {
  it('creates an empty object on first use and returns the same object afterwards', async () => {
    const seen: Array<Record<string | symbol, unknown>> = [];
    const observer: RuntimeMiddleware<MockExec> = {
      name: 'observer',
      async activityStarted(_activity, ctx) {
        seen.push({ ...ctx.state(key) });
        ctx.state(key)['startedAt'] = 1;
      },
      async activityEnded(_activity, _result, ctx) {
        seen.push(ctx.state(key));
      },
    };

    await collect(queryStatement([observer], () => yieldRows([])));

    expect(seen).toEqual([{}, { startedAt: 1 }]);
  });

  it('isolates state between activities', async () => {
    const seen: unknown[] = [];
    const counter: RuntimeMiddleware<MockExec> = {
      name: 'counter',
      async activityStarted(_activity, ctx) {
        const state = ctx.state(key);
        seen.push(state['count']);
        state['count'] = 1;
      },
    };

    await collect(queryStatement([counter], () => yieldRows([])));
    await executeStatementWith([counter], async () => ({ affectedRows: 0 }));

    expect(seen).toEqual([undefined, undefined]);
  });

  it('shares the object between middleware that use the same key, and separates other keys', async () => {
    let shared: boolean | undefined;
    let separate: unknown;
    const writer: RuntimeMiddleware<MockExec> = {
      name: 'writer',
      async activityStarted(_activity, ctx) {
        ctx.state('shared')['value'] = 'written';
      },
    };
    const reader: RuntimeMiddleware<MockExec> = {
      name: 'reader',
      async activityStarted(_activity, ctx) {
        shared = ctx.state('shared')['value'] === 'written';
        separate = ctx.state(Symbol('shared'))['value'];
      },
    };

    await collect(queryStatement([writer, reader], () => yieldRows([])));

    expect({ shared, separate }).toEqual({ shared: true, separate: undefined });
  });

  it('drops the state once the activity is finalized', async () => {
    let ctxOfStatement: ActivityContext | undefined;
    const observer: RuntimeMiddleware<MockExec> = {
      name: 'observer',
      async activityStarted(_activity, ctx) {
        ctx.state(key)['value'] = 1;
        ctxOfStatement = ctx;
      },
    };

    await collect(queryStatement([observer], () => yieldRows([])));
    expect(ctxOfStatement?.state(key)).toEqual({});
  });
});

describe('ActivityContext.parent and inTransaction', () => {
  it('gives a statement started beneath a transaction the transaction context as parent', async () => {
    const transaction = await startTransactionActivity({
      holdFinishedChildren: true,
      parent: undefined,
      middleware: [],
      context: contextFields(),
    });
    let observed: ActivityContext | undefined;
    const observer: RuntimeMiddleware<MockExec> = {
      name: 'observer',
      async activityStarted(_activity, ctx) {
        observed = ctx;
      },
    };

    await collect(queryStatement([observer], () => yieldRows([]), { parent: transaction }));

    expect(observed?.parent).toBe(transaction.ctx);
    expect(observed?.inTransaction()).toBe(true);
    expect(transaction.ctx.parent).toBeUndefined();
    expect(transaction.ctx.inTransaction()).toBe(false);
  });

  it('lets a child read its parent state through ctx.parent', async () => {
    const tracing = Symbol('tracing');
    const transaction = await startTransactionActivity({
      holdFinishedChildren: true,
      parent: undefined,
      middleware: [
        {
          name: 'tracer',
          async activityStarted(_activity, ctx) {
            ctx.state(tracing)['span'] = 'transaction-span';
          },
        },
      ],
      context: contextFields(),
    });
    let parentSpan: unknown;
    const tracer: RuntimeMiddleware<MockExec> = {
      name: 'tracer',
      async activityStarted(_activity, ctx) {
        parentSpan = ctx.parent?.state(tracing)['span'];
      },
    };

    await executeStatementWith([tracer], async () => ({ affectedRows: 0 }), {
      parent: transaction,
    });

    expect(parentSpan).toBe('transaction-span');
  });
});
