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
    const target = {
      ...stack.target,
      accessChangesOf: (operations: readonly MigrationPlanOperation[]) => {
        received.push(operations);
        return [change];
      },
    };
    const instance = createSqlFamilyInstance({ ...stack, target });

    expect({ changes: instance.accessChangesOf([DISABLE]), received }).toEqual({
      changes: [change],
      received: [[DISABLE]],
    });
  });

  it('raises CONTRACT.PACK_CONTRIBUTION_INVALID when the target descriptor has no accessChangesOf', () => {
    const instance = createSqlFamilyInstance(makeStack());

    expect(() => instance.accessChangesOf([DISABLE])).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        meta: { targetId: 'postgres', operation: 'accessChangesOf' },
      }),
    );
  });
});
