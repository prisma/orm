import { describe, expect, it } from 'vitest';
import { buildExecutionSection } from '../src/build-execution-section';
import { computeExecutionHash } from '../src/hashing';

const timestampNow = { kind: 'generator', id: 'timestampNow' } as const;

function defaultFor(namespace: string, entry: string, field: string) {
  return { ref: { namespace, entry, field }, onCreate: timestampNow };
}

describe('buildExecutionSection', () => {
  it('returns undefined when there are no defaults', () => {
    expect(buildExecutionSection({ target: 'postgres', targetFamily: 'sql', defaults: [] })).toBe(
      undefined,
    );
  });

  it('sorts defaults by namespace, entry, then field and hashes the sorted section for the target', () => {
    const input = [
      defaultFor('b', 'Post', 'createdAt'),
      defaultFor('a', 'User', 'updatedAt'),
      defaultFor('a', 'User', 'createdAt'),
      defaultFor('a', 'Post', 'updatedAt'),
    ];
    const section = buildExecutionSection({
      target: 'postgres',
      targetFamily: 'sql',
      defaults: input,
    });
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
        target: 'postgres',
        targetFamily: 'sql',
        execution: { mutations },
      }),
      mutations,
    });
    expect(input[0]).toEqual(defaultFor('b', 'Post', 'createdAt'));
  });

  it('orders entries by UTF-16 code unit, independent of the host locale', () => {
    const section = buildExecutionSection({
      target: 'postgres',
      targetFamily: 'sql',
      defaults: [
        defaultFor('public', 'Ürün', 'createdAt'),
        defaultFor('public', 'user_profile', 'createdAt'),
        defaultFor('public', 'post', 'createdAt'),
        defaultFor('public', 'User', 'createdAt'),
      ],
    });
    expect(section).toEqual({
      executionHash: '81b78e1492452f91daacdb0fd3a21ec9b4eb58febabdb4548963ab55b810fa3a',
      mutations: {
        defaults: [
          defaultFor('public', 'User', 'createdAt'),
          defaultFor('public', 'post', 'createdAt'),
          defaultFor('public', 'user_profile', 'createdAt'),
          defaultFor('public', 'Ürün', 'createdAt'),
        ],
      },
    });
  });

  it('hashes the same defaults differently for another target', () => {
    const defaults = [defaultFor('a', 'User', 'createdAt')];
    expect(
      buildExecutionSection({ target: 'postgres', targetFamily: 'sql', defaults })?.executionHash,
    ).not.toBe(
      buildExecutionSection({ target: 'mongo', targetFamily: 'mongo', defaults })?.executionHash,
    );
  });
});
