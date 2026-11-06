import type * as FrameworkRuntime from '@internal/framework-components/runtime';
import { describe, expect, it, vi } from 'vitest';
import { startActivityOn } from '../src/activity-handle';
import { testCall } from './client-activity-kinds';
import { createSetup } from './transaction-activity-fixtures';

const endFailure = new Error('end threw synchronously');

vi.mock('@internal/framework-components/runtime', async (importOriginal) => {
  const original = await importOriginal<typeof FrameworkRuntime>();
  return {
    ...original,
    startClientActivity: async (...args: Parameters<typeof original.startClientActivity>) => {
      const run = await original.startClientActivity(...args);
      return Object.assign(Object.create(run), {
        end: () => {
          throw endFailure;
        },
      });
    },
  };
});

describe('an activity handle whose run throws synchronously when ended', () => {
  it('rejects with that error and stops counting the activity as runtime work', async () => {
    const { runtime } = createSetup();
    const call = await startActivityOn(runtime, testCall);

    await expect(call.end({ outcome: 'succeeded' })).rejects.toBe(endFailure);
    const closed = await Promise.race([
      runtime.close().then(() => 'closed'),
      new Promise((resolve) => setTimeout(() => resolve('still waiting'), 200)),
    ]);

    expect(closed).toBe('closed');
  });
});
