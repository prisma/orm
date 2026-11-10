import type { PlanMeta } from '@internal/contract/types';
import { type ExecutionPlan, executeStatement } from '@internal/framework-components/runtime';
import { expect, it, vi } from 'vitest';
import { createCacheMiddleware } from '../src/cache-middleware';
import { makeCtx } from './middleware-fixtures';

const meta: PlanMeta = {
  target: 'mock',
  storageHash: 'test',
  lane: 'raw-sql',
};

it('does not intercept or observe statistics execution', async () => {
  const middleware = createCacheMiddleware();
  const driver = vi.fn(async () => ({ affectedRows: 3 }));
  const { parent: _parent, state: _state, inTransaction: _inTransaction, ...context } = makeCtx();
  const plan: ExecutionPlan = { meta };

  await expect(
    executeStatement({ middleware: [middleware], plan, context, parent: undefined }, (run) =>
      run.runExecute(plan, driver),
    ),
  ).resolves.toEqual({ affectedRows: 3 });
  expect(driver).toHaveBeenCalledOnce();
  expect(middleware.intercept).not.toHaveProperty('onExecute');
});
