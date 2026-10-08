import { asNamespaceId } from '@internal/contract/types';
import { StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import {
  assertFullTextIndexes,
  describeFullTextIndexProblem,
  fullTextIndexDefinitionOf,
  fullTextIndexProblems,
} from '../src/core/full-text-index-definition';
import { postgresCodecTraitsOf } from '../src/core/postgres-codec-traits';

describe('fullTextIndexProblems', () => {
  const codecs = {
    codecIdOf: (column: string) =>
      ({ title: 'pg/text@1', body: 'pg/varchar@1', views: 'pg/int4@1', tags: 'acme/tags@1' })[
        column
      ],
    traitsOf: postgresCodecTraitsOf,
  };

  it('finds nothing wrong with text columns in one to four groups', () => {
    expect(fullTextIndexProblems({ weightGroups: [['title'], ['body']], codecs })).toEqual([]);
  });

  it.each([
    ['no field', { weightGroups: [] }, [{ kind: 'no-fields' }]],
    [
      'five groups',
      { weightGroups: [['a'], ['b'], ['c'], ['d'], ['e']] },
      [{ kind: 'too-many-groups', groupCount: 5 }],
    ],
    ['an empty group', { weightGroups: [['a'], []] }, [{ kind: 'empty-group', position: 1 }]],
    [
      'a field named twice',
      { weightGroups: [['a', 'b'], ['a']] },
      [{ kind: 'duplicate-field', field: 'a' }],
    ],
    ['a unique index', { weightGroups: [['a']], unique: true }, [{ kind: 'unique' }]],
    [
      'a column that is not text',
      { weightGroups: [['title', 'views']], codecs },
      [{ kind: 'not-text', field: 'views', codecId: 'pg/int4@1' }],
    ],
    [
      'a column whose codec the target does not register',
      { weightGroups: [['tags']], codecs },
      [{ kind: 'not-text', field: 'tags', codecId: 'acme/tags@1' }],
    ],
    [
      'a field that stores no value',
      { weightGroups: [['author']], codecs },
      [{ kind: 'not-text', field: 'author', codecId: undefined }],
    ],
  ])('finds %s', (_label, candidate, problems) => {
    expect(fullTextIndexProblems(candidate)).toEqual(problems);
  });

  it('names the field and its codec when a column is not text', () => {
    expect(
      describeFullTextIndexProblem(
        '`@@fullTextIndex`',
        { kind: 'not-text', field: 'views', codecId: 'pg/int4@1' },
        (field) => `Post.${field}`,
      ),
    ).toBe('`@@fullTextIndex` indexes text columns, but "Post.views" is stored as `pg/int4@1`.');
  });
});

describe('fullTextIndexDefinitionOf', () => {
  it('reads the definition of an index of type fullText', () => {
    expect(
      fullTextIndexDefinitionOf({
        type: 'fullText',
        options: { weightGroups: [['title'], ['body']], language: 'german' },
      }),
    ).toEqual({ weightGroups: [['title'], ['body']], language: 'german' });
  });

  it.each([
    ['an index without a type', {}],
    ['a gin index, whatever its options', { type: 'gin', options: { weightGroups: [['title']] } }],
    ['a btree index', { type: 'btree' }],
  ])('reads nothing from %s', (_label, index) => {
    expect(fullTextIndexDefinitionOf(index)).toBeUndefined();
  });
});

describe('assertFullTextIndexes', () => {
  const tableWith = (
    overrides: Record<string, unknown> = {},
    foreignKeys: ConstructorParameters<typeof StorageTable>[0]['foreignKeys'] = [],
  ) =>
    new StorageTable({
      columns: {
        id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
        title: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false },
        body: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: true },
      },
      foreignKeys,
      uniques: [],
      indexes: [
        {
          naming: { kind: 'exact', name: 'post_search' },
          type: 'fullText',
          columns: ['title', 'body'],
          options: { weightGroups: [['title'], ['body']], language: 'german' },
          unique: false,
          where: undefined,
          ...overrides,
        },
      ],
    });

  it('accepts a full-text index over text columns', () => {
    expect(() => assertFullTextIndexes(tableWith(), postgresCodecTraitsOf)).not.toThrow();
  });

  it.each([
    ['an empty weight group', { options: { weightGroups: [['title'], []], language: 'english' } }],
    ['a missing language', { options: { weightGroups: [['title'], ['body']] } }],
    [
      'an option other than weightGroups and language',
      {
        options: { weightGroups: [['title'], ['body']], language: 'english', fastupdate: 'off' },
      },
    ],
    ['a unique index', { unique: true }],
  ])('refuses %s', (_label, overrides) => {
    expect(() => assertFullTextIndexes(tableWith(overrides))).toThrow(
      expect.objectContaining({ code: 'CONTRACT.INDEX_INVALID' }),
    );
  });

  it.each([
    ['different columns', ['title', 'id']],
    ['the same columns in another order', ['body', 'title']],
    ['fewer columns', ['title']],
  ])('refuses columns that are not the fields of its weight groups: %s', (_label, columns) => {
    expect(() => assertFullTextIndexes(tableWith({ columns }))).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INDEX_INVALID',
        message: expect.stringContaining('"post_search"'),
        why: expect.stringContaining('columns'),
        fix: expect.stringContaining('Re-emit'),
      }),
    );
  });

  describe('a foreign key', () => {
    const foreignKeyIndexedBy = (name: string) => ({
      source: { namespaceId: asNamespaceId('public'), tableName: 'post', columns: ['title'] },
      target: { namespaceId: asNamespaceId('public'), tableName: 'author', columns: ['handle'] },
      index: { name },
    });

    it('is refused when it names the full-text index as its backing index', () => {
      expect(() =>
        assertFullTextIndexes(tableWith({}, [foreignKeyIndexedBy('post_search')])),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.INDEX_INVALID',
          message: 'The foreign key on columns (title) is backed by full-text index "post_search".',
          why: expect.stringContaining("does not serve the foreign key's lookups"),
        }),
      );
    });

    it('is accepted when it names another index', () => {
      expect(() =>
        assertFullTextIndexes(tableWith({}, [foreignKeyIndexedBy('post_title_idx')])),
      ).not.toThrow();
    });
  });

  it('refuses a column that is not text when it is given the codec traits', () => {
    const table = tableWith({
      columns: ['title', 'id'],
      options: { weightGroups: [['title'], ['id']], language: 'english' },
    });

    expect(() => assertFullTextIndexes(table)).not.toThrow();
    expect(() => assertFullTextIndexes(table, postgresCodecTraitsOf)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INDEX_INVALID',
        message: expect.stringMatching(/"id".*pg\/int4@1/),
      }),
    );
  });
});
