import { computeExecutionHash } from '@internal/contract/hashing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMongoExecutionSection } from '../src/build-execution-section';

const timestampNow = { kind: 'generator', id: 'timestampNow' } as const;

function collateAs(locale: string) {
  const collator = new Intl.Collator(locale);
  vi.spyOn(String.prototype, 'localeCompare').mockImplementation(function (this: string, that) {
    return collator.compare(this, that);
  });
}

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

  describe('with names whose locale order differs from code-unit order', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const unsorted = [
      defaultFor('app', 'Ürün', 'createdAt'),
      defaultFor('app', 'user_profile', 'createdAt'),
      defaultFor('app', 'post', 'createdAt'),
      defaultFor('app', 'User', 'createdAt'),
    ];

    it('sorts entries by UTF-16 code unit', () => {
      const section = buildMongoExecutionSection(unsorted);
      expect(section?.mutations.defaults.map((d) => d.ref.entry)).toEqual([
        'User',
        'post',
        'user_profile',
        'Ürün',
      ]);
    });

    it('produces the same section under Danish and US English collation', () => {
      collateAs('da-DK');
      const danish = buildMongoExecutionSection(unsorted);
      collateAs('en-US');
      const english = buildMongoExecutionSection(unsorted);
      expect(danish).toEqual(english);
    });
  });
});
