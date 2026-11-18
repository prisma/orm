import { streamStatement } from '@internal/framework-components/runtime';
import { expect, it } from 'vitest';
import { cacheAnnotation } from '../src/cache-annotation';
import { createCacheMiddleware } from '../src/cache-middleware';
import { makeCtx, makeExec, spyStore } from './middleware-fixtures';

it('does not store the rows of a miss whose caller stopped reading', async () => {
  const store = spyStore();
  const cache = createCacheMiddleware({ store });
  const exec = makeExec('select 1', { cache: cacheAnnotation({}) });
  const { parent: _parent, state: _state, inTransaction: _inTransaction, ...context } = makeCtx();
  async function* driverRows() {
    yield { id: 1 };
    yield { id: 2 };
  }

  for await (const _row of streamStatement(
    { middleware: [cache], plan: exec, context, parent: undefined },
    (run) => run.runQuery(exec, driverRows),
  )) {
    break;
  }

  expect(store.getSpy).toHaveBeenCalledTimes(1);
  expect(store.setSpy).not.toHaveBeenCalled();
});
