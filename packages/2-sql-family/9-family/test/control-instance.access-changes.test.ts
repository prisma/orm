import type {
  MigrationAccessChange,
  MigrationPlanOperation,
} from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { createSqlFamilyInstance } from '../src/core/control-instance';
import { makeStack } from './control-instance-stack.helpers';

const DISABLE: MigrationPlanOperation = {
  id: 'rowLevelSecurity.public.post.disable',
  label: 'Disable row-level security on "post"',
  operationClass: 'widening',
};

describe('sql family instance accessChangesOf', () => {
  it("returns the target's access changes for a recorded migration", () => {
    const received: (readonly MigrationPlanOperation[])[] = [];
    const change: MigrationAccessChange = {
      operationIndex: 0,
      subject: { kind: 'storage', name: 'public.post' },
      widens: true,
    };
    const stack = makeStack();
    const read: (readonly unknown[])[] = [];
    const target = {
      ...stack.target,
      readOperations: (operations: readonly unknown[]) => {
        read.push(operations);
        return operations;
      },
      accessChangesOf: (operations: readonly MigrationPlanOperation[]) => {
        received.push(operations);
        return [change];
      },
    };
    const instance = createSqlFamilyInstance({ ...stack, target });

    expect({ changes: instance.accessChangesOf([DISABLE]), read, received }).toEqual({
      changes: [change],
      read: [[DISABLE]],
      received: [[DISABLE]],
    });
  });

  it("reads a migration's operations in the target's format before the target or the family acts on them", () => {
    const received: (readonly MigrationPlanOperation[])[] = [];
    const stack = makeStack();
    const target = {
      ...stack.target,
      readOperations: () => {
        throw new Error('refused');
      },
      accessChangesOf: (operations: readonly MigrationPlanOperation[]) => {
        received.push(operations);
        return [];
      },
    };
    const instance = createSqlFamilyInstance({ ...stack, target });

    expect(() => instance.accessChangesOf([DISABLE])).toThrow('refused');
    expect(() => instance.storageNameOf(DISABLE)).toThrow('refused');
    expect(() => instance.toOperationPreview([DISABLE])).toThrow('refused');
    expect(received).toEqual([]);
  });

  it('names the stored object from the operation as the reader returns it', () => {
    const stack = makeStack();
    const target = {
      ...stack.target,
      readOperations: (operations: readonly unknown[]) =>
        operations.map(() => ({
          ...DISABLE,
          target: { id: 'postgres', details: { objectType: 'table', name: 'post' } },
        })),
    };
    const instance = createSqlFamilyInstance({ ...stack, target });

    const stored = {
      ...DISABLE,
      target: { id: 'postgres', details: { schema: 'main', objectType: 'table', name: 'post' } },
    };
    expect(instance.storageNameOf(stored)).toBe('post');
  });

  it('raises CONTRACT.PACK_CONTRIBUTION_INVALID when the target descriptor has no accessChangesOf', () => {
    const stack = makeStack();
    const target = {
      ...stack.target,
      readOperations: (operations: readonly unknown[]) => operations,
    };
    const instance = createSqlFamilyInstance({ ...stack, target });

    expect(() => instance.accessChangesOf([DISABLE])).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        meta: { targetId: 'postgres', operation: 'accessChangesOf' },
      }),
    );
  });
});
