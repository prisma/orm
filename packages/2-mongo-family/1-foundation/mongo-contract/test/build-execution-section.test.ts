import { computeExecutionHash } from '@internal/contract/hashing';
import { describe, expect, it } from 'vitest';
import { buildMongoExecutionSection } from '../src/build-execution-section';

const timestampNow = { kind: 'generator', id: 'timestampNow' } as const;

function defaultFor(namespace: string, entry: string, field: string) {
  return { ref: { namespace, entry, field }, onCreate: timestampNow };
}

describe('buildMongoExecutionSection', () => {
  it('returns undefined when there are no defaults', () => {
    expect(buildMongoExecutionSection([])).toBeUndefined();
  });

  it('sorts defaults by namespace, entry, then field and hashes the sorted section', () => {
    const section = buildMongoExecutionSection([
      defaultFor('b', 'Post', 'createdAt'),
      defaultFor('a', 'User', 'updatedAt'),
      defaultFor('a', 'User', 'createdAt'),
      defaultFor('a', 'Post', 'updatedAt'),
    ]);
    const mutations = {
      defaults: [
        defaultFor('a', 'Post', 'updatedAt'),
        defaultFor('a', 'User', 'createdAt'),
        defaultFor('a', 'User', 'updatedAt'),
        defaultFor('b', 'Post', 'createdAt'),
      ],
    };
    expect(section).toEqual({
      executionHash: computeExecutionHash({
        target: 'mongo',
        targetFamily: 'mongo',
        execution: { mutations },
      }),
      mutations,
    });
  });
});
