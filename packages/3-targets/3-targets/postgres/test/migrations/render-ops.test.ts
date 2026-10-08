import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { OpFactoryCall } from '@internal/framework-components/control';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import {
  DataTransformCall,
  RenameConstraintCall,
  RenameTableCall,
} from '../../src/core/migrations/op-factory-call';
import { renderOps } from '../../src/core/migrations/render-ops';

function makeCall(targetId: string, opId: string, factoryName = 'noop'): OpFactoryCall {
  return {
    factoryName,
    operationClass: 'additive',
    label: `${opId} op`,
    renderTypeScript: () => '',
    importRequirements: () => [],
    toOp: () => ({
      id: opId,
      label: `${opId} op`,
      operationClass: 'additive',
      target: { id: targetId },
      precheck: [],
      execute: [],
      postcheck: [],
    }),
  } as unknown as OpFactoryCall;
}

describe('renderOps', () => {
  it('passes through ops whose target.id is "postgres"', async () => {
    const result = await Promise.all(renderOps([makeCall('postgres', 'table.users.create')]));
    expect(result).toHaveLength(1);
    expect(result[0]?.target.id).toBe('postgres');
    expect(result[0]?.id).toBe('table.users.create');
  });

  it('throws when a call materialises an op for a different target', () => {
    expect(() => renderOps([makeCall('sqlite', 'table.users.create', 'createTable')])).toThrow(
      /expected postgres op.+target\.id="sqlite".+factoryName="createTable"/,
    );
  });

  it('reports the mismatch as MIGRATION.TARGET_MISMATCH with op metadata', () => {
    let caught: unknown;
    try {
      renderOps([makeCall('sqlite', 'table.users.create', 'createTable')]);
    } catch (error) {
      caught = error;
    }
    expect(isStructuredError(caught)).toBe(true);
    expect(caught).toMatchObject({
      code: 'MIGRATION.TARGET_MISMATCH',
      meta: { opId: 'table.users.create', targetId: 'sqlite', factoryName: 'createTable' },
    });
  });
});

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
    const call = new RenameTableCall('public', 'a', 'b', [
      new RenameConstraintCall('public', 'b', 'primaryKey', 'a_pkey', 'b_pkey'),
    ]);

    const result = await Promise.all(renderOps([call], lowerer));

    expect(result.map((rendered) => rendered.label)).toEqual([
      'Rename table "a" to "b"',
      'Rename primary key "a_pkey" to "b_pkey" on "b"',
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
      expect(renderOps([new DataTransformCall('Backfill', 'check', 'run')])).toHaveLength(1);
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', listener);
    }
    expect(unhandled).toEqual([]);
  });

  it('still rejects with MIGRATION.UNFILLED_PLACEHOLDER for a reader that awaits it', async () => {
    const [operation] = renderOps([new DataTransformCall('Backfill', 'check', 'run')]);
    await expect(operation).rejects.toMatchObject({ code: 'MIGRATION.UNFILLED_PLACEHOLDER' });
  });
});
