import {
  type Activity,
  type ActivityFinalizedResult,
  assertAnnotationsApplicable,
  type ClientActivity,
  type StatementActivity,
} from '@internal/framework-components/runtime';
import { describe, expect, it } from 'vitest';
import { cacheAnnotation, invalidateAnnotation } from '../src/cache-annotation';
import { type CacheMiddleware, createCacheMiddleware } from '../src/cache-middleware';
import { makeCall, makeCtx, makeExec, runMiss, spyStore } from './middleware-fixtures';

function finalize(
  mw: CacheMiddleware,
  activity: Activity,
  outcome: ActivityFinalizedResult['outcome'],
): Promise<void> {
  return mw.activityFinalized?.(activity, { outcome }, makeCtx()) ?? Promise.resolve();
}

function annotatedWrite(target: Parameters<typeof invalidateAnnotation>[0]): ClientActivity {
  return makeCall({ 'cache-invalidate': invalidateAnnotation(target) });
}

function annotatedStatement(target: Parameters<typeof invalidateAnnotation>[0]): StatementActivity {
  const exec = makeExec('update users', { 'cache-invalidate': invalidateAnnotation(target) });
  return {
    id: 'statement',
    kind: 'statement',
    returns: 'stats',
    plan: exec,
    annotations: new Map([['cache-invalidate', invalidateAnnotation(target)]]),
  };
}

describe('createCacheMiddleware — a write annotated with invalidateAnnotation', () => {
  it('invalidates its keys and meta when the write is finalized committed', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });

    await finalize(
      mw,
      annotatedWrite({ keys: ['user-1'], meta: { tags: ['users'] } }),
      'committed',
    );

    expect(store.unsetSpy.mock.calls).toEqual([[{ keys: ['user-1'], meta: { tags: ['users'] } }]]);
  });

  it('invalidates when the outcome is unknown, since the write may have landed', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });

    await finalize(mw, annotatedWrite({ keys: ['user-1'] }), 'unknown');

    expect(store.unsetSpy.mock.calls).toEqual([[{ keys: ['user-1'], meta: undefined }]]);
  });

  it('does not invalidate when the write was rolled back', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });

    await finalize(mw, annotatedWrite({ keys: ['user-1'] }), 'rolled-back');

    expect(store.unsetSpy).not.toHaveBeenCalled();
  });

  it('does nothing for an activity without the annotation', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });

    await finalize(mw, makeCall(), 'committed');
    await finalize(mw, makeCall({ cache: cacheAnnotation({ key: 'user-1' }) }), 'committed');

    expect(store.unsetSpy).not.toHaveBeenCalled();
  });

  it('does nothing when keys are empty or absent and meta is absent', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });

    await finalize(mw, annotatedWrite({ keys: [] }), 'committed');
    await finalize(mw, annotatedWrite({}), 'committed');

    expect(store.unsetSpy).not.toHaveBeenCalled();
  });

  it('passes keys: undefined when keys are empty and meta is given', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });

    await finalize(mw, annotatedWrite({ keys: [], meta: { tags: ['users'] } }), 'committed');

    expect(store.unsetSpy.mock.calls).toEqual([[{ keys: undefined, meta: { tags: ['users'] } }]]);
  });

  it('invalidates from a statement activity whose plan carries the annotation', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });

    await finalize(mw, annotatedStatement({ keys: ['user-1'] }), 'committed');

    expect(store.unsetSpy.mock.calls).toEqual([[{ keys: ['user-1'], meta: undefined }]]);
  });

  it('invalidates from a client activity of any kind', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const job: ClientActivity = {
      ...annotatedWrite({ keys: ['report-7'] }),
      kind: 'report-job',
    };

    await finalize(mw, job, 'committed');

    expect(store.unsetSpy.mock.calls).toEqual([[{ keys: ['report-7'], meta: undefined }]]);
  });

  it('invalidates regardless of scope or enclosing transaction', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const ctx = makeCtx({ scope: 'transaction', inTransaction: () => true });

    await mw.activityFinalized?.(
      annotatedWrite({ keys: ['user-1'] }),
      { outcome: 'committed' },
      ctx,
    );

    expect(store.unsetSpy.mock.calls).toEqual([[{ keys: ['user-1'], meta: undefined }]]);
  });

  it('removes a cached entry, so the next read misses', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', { cache: cacheAnnotation({ key: 'user-1' }) });
    await runMiss(mw, exec, makeCtx(), [{ id: 1 }]);

    await finalize(mw, annotatedWrite({ keys: ['user-1'] }), 'committed');

    expect(await mw.intercept?.onQuery?.(exec, makeCtx())).toBeUndefined();
  });

  it('rejects with the store error, which the runtime logs and swallows', async () => {
    const failure = new Error('store down');
    const store = spyStore();
    store.unsetSpy.mockRejectedValueOnce(failure);
    const mw = createCacheMiddleware({ store });

    await expect(finalize(mw, annotatedWrite({ keys: ['user-1'] }), 'committed')).rejects.toBe(
      failure,
    );
  });
});

describe('invalidateAnnotation', () => {
  it('applies to writes only', () => {
    expect([...invalidateAnnotation.applicableTo]).toEqual(['write']);
  });

  it('is refused for a read at run time', () => {
    expect(() =>
      assertAnnotationsApplicable([invalidateAnnotation({ keys: ['user-1'] })], 'read', 'first'),
    ).toThrow(expect.objectContaining({ code: 'RUNTIME.ANNOTATION_INAPPLICABLE' }));
  });

  it('uses its own namespace, apart from cacheAnnotation', () => {
    expect(invalidateAnnotation.namespace).toBe('cache-invalidate');
    expect(invalidateAnnotation.namespace).not.toBe(cacheAnnotation.namespace);
  });

  it('reads its payload back from a plan and from an activity', () => {
    const value = invalidateAnnotation({ keys: ['user-1'], meta: { tags: ['users'] } });
    const expected = { keys: ['user-1'], meta: { tags: ['users'] } };

    expect({
      plan: invalidateAnnotation.read(makeExec('update', { 'cache-invalidate': value })),
      activity: invalidateAnnotation.read(makeCall({ 'cache-invalidate': value })),
    }).toEqual({ plan: expected, activity: expected });
  });
});
