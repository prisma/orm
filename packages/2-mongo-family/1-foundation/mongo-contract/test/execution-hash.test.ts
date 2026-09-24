import { computeExecutionHash } from '@internal/contract/hashing';
import { describe, expect, it } from 'vitest';

const timestampNow = { kind: 'generator', id: 'timestampNow' } as const;

function mongoExecution(overrides?: { readonly field?: string; readonly onUpdate?: boolean }) {
  return {
    mutations: {
      defaults: [
        {
          ref: { namespace: '__unbound__', model: 'Post', field: overrides?.field ?? 'updatedAt' },
          onCreate: timestampNow,
          ...(overrides?.onUpdate === false ? {} : { onUpdate: timestampNow }),
        },
      ],
    },
  };
}

function hashOf(execution: Record<string, unknown>): string {
  return computeExecutionHash({ target: 'mongo', targetFamily: 'mongo', execution });
}

describe('computeExecutionHash over a Mongo execution section', () => {
  it('hashes a fixed section to a fixed value', () => {
    expect(hashOf(mongoExecution())).toBe(
      '04c3f9bea4b4576a043838138389dd47a38aff0c5436681d164872d6806a4c91',
    );
  });

  it('changes when a ref changes', () => {
    expect(hashOf(mongoExecution({ field: 'createdAt' }))).not.toBe(hashOf(mongoExecution()));
  });

  it('changes when a phase changes', () => {
    expect(hashOf(mongoExecution({ onUpdate: false }))).not.toBe(hashOf(mongoExecution()));
  });
});
