import { SelectAst, TableSource } from '@internal/sql-relational-core/ast';
import type { RuntimeScope } from '@internal/sql-relational-core/types';
import { describe, expect, it, vi } from 'vitest';
import {
  delegatingActivitySource,
  findActivitySource,
  lazyActivitySource,
  startActivityOn,
} from '../src/activity-handle';
import type { SqlMiddleware, SqlMiddlewareContext } from '../src/middleware/sql-middleware';
import { testCall } from './client-activity-kinds';
import { createSetup, meta } from './transaction-activity-fixtures';

const queryPlan = () => ({ ast: SelectAst.from(TableSource.named('users')), params: [], meta });

describe('delegatingActivitySource', () => {
  it('starts each activity on the queryable the target returns at that call', async () => {
    const { runtime, events } = createSetup();
    const outer = await startActivityOn(runtime, testCall);
    let current: RuntimeScope = runtime;
    const source = delegatingActivitySource(() => current);

    const onRuntime = await source.startActivity(testCall);
    await onRuntime.end({ outcome: 'succeeded' });
    current = outer;
    const onHandle = await source.startActivity(testCall);
    await onHandle.end({ outcome: 'succeeded' });
    await outer.end({ outcome: 'succeeded' });

    const started = events.filter((event) => event.name === 'started:test-call');
    expect(started.map((event) => event.ctx?.parent)).toEqual([
      undefined,
      undefined,
      started[0]?.ctx,
    ]);
  });

  it('hashes each plan with the scope and parent of the queryable the target returns at that call', async () => {
    const contexts: SqlMiddlewareContext[] = [];
    const observer: SqlMiddleware = {
      name: 'compile',
      familyId: 'sql',
      async beforeCompile(_draft, ctx) {
        contexts.push(ctx);
        return undefined;
      },
    };
    const { runtime, events } = createSetup({ middleware: [observer] });
    const connection = await runtime.connection();
    const call = await startActivityOn(connection, testCall);
    let current: RuntimeScope = runtime;
    const source = delegatingActivitySource(() => current);

    await source.planContentHash(queryPlan());
    current = call;
    await source.planContentHash(queryPlan());
    await call.end({ outcome: 'succeeded' });
    await connection.release();

    const callCtx = events.find((event) => event.name === 'started:test-call')?.ctx;
    expect(contexts.map((ctx) => [ctx.scope, ctx.parent])).toEqual([
      ['runtime', undefined],
      ['connection', callCtx],
    ]);
  });
});

describe('lazyActivitySource', () => {
  it('looks up the source at each call, not when it is created', async () => {
    const { runtime } = createSetup();
    const runtimeSource = findActivitySource(runtime);
    if (runtimeSource === undefined) throw new Error('the runtime has no activity source');
    const lookup = vi.fn(() => runtimeSource);

    const source = lazyActivitySource(lookup);
    expect(lookup).not.toHaveBeenCalled();

    const handle = await source.startActivity(testCall);
    await handle.end({ outcome: 'succeeded' });
    await source.planContentHash(queryPlan());

    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
