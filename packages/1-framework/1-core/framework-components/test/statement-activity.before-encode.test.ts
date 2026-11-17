import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import type {
  ActivityContext,
  ParamRefMutator,
  RuntimeMiddleware,
} from '../src/execution/runtime-middleware';
import {
  collect,
  contextFields,
  exec,
  executeStatementWith,
  type MockExec,
  queryStatement,
  yieldRows,
} from './statement-fixtures';

const mutator = blindCast<ParamRefMutator, 'an opaque mutator stand-in'>({});

describe('beforeEncode', () => {
  it('receives the draft plan, the activity context and the mutator', async () => {
    const seen: Array<{
      plan: MockExec;
      ctx: ActivityContext;
      params: ParamRefMutator | undefined;
    }> = [];
    let startedCtx: ActivityContext | undefined;
    const observer: RuntimeMiddleware<MockExec> = {
      name: 'observer',
      async activityStarted(_activity, ctx) {
        startedCtx = ctx;
      },
      async beforeEncode(plan, ctx, params) {
        seen.push({ plan, ctx, params });
      },
    };

    await collect(queryStatement([observer], () => yieldRows([]), { params: mutator }));

    expect(seen).toEqual([{ plan: exec, ctx: startedCtx, params: mutator }]);
    expect(seen[0]?.ctx).toBe(startedCtx);
    expect(seen[0]?.params).toBe(mutator);
  });

  it('runs every middleware in registration order with the same mutator', async () => {
    const seen: Array<{ label: string; params: ParamRefMutator | undefined }> = [];
    const mw = (label: string): RuntimeMiddleware<MockExec> => ({
      name: label,
      async beforeEncode(_plan, _ctx, params) {
        seen.push({ label, params });
      },
    });

    await executeStatementWith([mw('A'), mw('B'), mw('C')], async () => ({ affectedRows: 0 }), {
      params: mutator,
    });

    expect(seen.map((entry) => entry.label)).toEqual(['A', 'B', 'C']);
    expect(seen.every((entry) => entry.params === mutator)).toBe(true);
  });

  it('accepts a synchronous hook', async () => {
    const seen: string[] = [];
    const sync: RuntimeMiddleware<MockExec> = {
      name: 'sync',
      beforeEncode() {
        seen.push('sync');
      },
    };

    await collect(queryStatement([sync], () => yieldRows([])));

    expect(seen).toEqual(['sync']);
  });

  it('fails with RUNTIME.ABORTED before running a hook when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const seen: string[] = [];
    const observer: RuntimeMiddleware<MockExec> = {
      name: 'observer',
      async beforeEncode() {
        seen.push('beforeEncode');
      },
    };

    await expect(
      collect(
        queryStatement([observer], () => yieldRows([]), {
          context: contextFields({ signal: controller.signal }),
        }),
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'beforeEncode' },
    });
    expect(seen).toEqual([]);
  });

  it('races a hook that ignores the signal against it', async () => {
    const controller = new AbortController();
    const blocking: RuntimeMiddleware<MockExec> = {
      name: 'blocking',
      async beforeEncode() {
        await new Promise(() => {});
      },
    };

    const pending = executeStatementWith([blocking], async () => ({ affectedRows: 0 }), {
      context: contextFields({ signal: controller.signal }),
    });
    const reason = new Error('cancelled');
    queueMicrotask(() => controller.abort(reason));

    await expect(pending).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'beforeEncode' },
      cause: reason,
    });
  });
});
