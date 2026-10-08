import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { describe, expect, it } from 'vitest';
import {
  CreateIndexCall,
  DataTransformCall,
  DropIndexCall,
  RenameTableCall,
} from '../../src/core/migrations/op-factory-call';
import { renderOps } from '../../src/core/migrations/render-ops';

describe('renderOps with a call that produces several ops', () => {
  it('renders the call and each of its companions, in order, with the same lowerer', async () => {
    const received: unknown[] = [];
    const lowerer: ExecuteRequestLowerer = {
      lower: () => Object.freeze({ sql: 'UNUSED', params: Object.freeze([]) }),
      lowerToExecuteRequest: async (ast) => {
        received.push(ast);
        return Object.freeze({ sql: 'LOWERED', params: Object.freeze([]) });
      },
      renderColumnDefault: async () => '',
    };
    const call = new RenameTableCall('a', 'b', [
      {
        drop: new DropIndexCall('b', 'a_handle_idx'),
        create: new CreateIndexCall('b', 'b_handle_idx', ['handle']),
      },
    ]);

    const result = await Promise.all(renderOps([call], lowerer));

    expect(result.map((rendered) => rendered.label)).toEqual([
      'Rename table a to b',
      'Drop index a_handle_idx on b',
      'Create index b_handle_idx on b',
    ]);
    expect(received.length).toBeGreaterThan(0);
  });
});

describe('renderOps with a placeholder', () => {
  it('raises no unhandled rejection when the operations are read without awaiting each one', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    try {
      expect(
        renderOps([new DataTransformCall('data_migration.backfill', 'Backfill', 'user', 'email')]),
      ).toHaveLength(1);
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', listener);
    }
    expect(unhandled).toEqual([]);
  });

  it('still rejects with MIGRATION.UNFILLED_PLACEHOLDER for a reader that awaits it', async () => {
    const [operation] = renderOps([
      new DataTransformCall('data_migration.backfill', 'Backfill', 'user', 'email'),
    ]);
    await expect(operation).rejects.toMatchObject({ code: 'MIGRATION.UNFILLED_PLACEHOLDER' });
  });
});
