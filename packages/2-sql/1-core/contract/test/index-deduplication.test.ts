import type { AuthoringWarning } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { deduplicateIndexes, type IndexCandidate } from '../src/index-deduplication';
import { type AuthoredIndexInput, lowerAuthoredIndex } from '../src/index-naming';

type AuthoredIndex = (
  | { readonly columns: readonly string[]; readonly expression?: never }
  | { readonly columns?: never; readonly expression: string }
) & {
  readonly where?: string;
  readonly unique?: boolean;
  readonly map?: string;
  readonly name?: string;
  readonly type?: string;
  readonly options?: Record<string, unknown>;
};

function declared(authored: AuthoredIndex): IndexCandidate {
  const input: AuthoredIndexInput = {
    ...(authored.expression === undefined
      ? { columns: authored.columns }
      : { expression: authored.expression }),
    where: authored.where,
    unique: authored.unique,
    map: authored.map,
    name: authored.name,
    ...(authored.type === undefined
      ? { type: undefined, options: undefined }
      : { type: authored.type, options: authored.options }),
  };
  return {
    index: lowerAuthoredIndex('post', input),
    namedByUser: authored.name !== undefined || authored.map !== undefined,
  };
}

function deduplicate(input: {
  readonly indexes: readonly IndexCandidate[];
  readonly uniques?: readonly { readonly columns: readonly string[]; readonly name?: string }[];
  readonly primaryKey?: { readonly columns: readonly string[]; readonly name?: string };
}) {
  const warnings: AuthoringWarning[] = [];
  const result = deduplicateIndexes({
    tableName: 'post',
    indexes: input.indexes,
    uniques: input.uniques ?? [],
    primaryKey: input.primaryKey,
    warnings,
  });
  return { ...result, warnings };
}

describe('deduplicateIndexes', () => {
  it('keeps one of two identical unnamed indexes and points the other at it', () => {
    const first = declared({ columns: ['author_id'] });
    const second = declared({ columns: ['author_id'] });

    const result = deduplicate({ indexes: [first, second] });

    expect(result.indexes).toEqual([first]);
    expect(result.replacements).toEqual(new Map([[second, { kind: 'index', index: first }]]));
    expect(result.warnings).toEqual([]);
  });

  it('keeps the named index of an identical pair wherever it is declared', () => {
    const unnamed = declared({ columns: ['author_id'] });
    const named = declared({ columns: ['author_id'], name: 'post_author' });

    const result = deduplicate({ indexes: [unnamed, named] });

    expect(result.indexes).toEqual([named]);
    expect(result.replacements).toEqual(new Map([[unnamed, { kind: 'index', index: named }]]));
    expect(result.warnings).toEqual([]);
  });

  it('keeps two identical named indexes and warns, naming both and the table', () => {
    const exact = declared({ columns: ['author_id'], map: 'post_author_by_hand' });
    const wire = declared({ columns: ['author_id'], name: 'post_author' });

    const result = deduplicate({ indexes: [exact, wire] });

    expect(result.indexes).toEqual([exact, wire]);
    expect(result.replacements).toEqual(new Map());
    expect(result.warnings).toEqual([
      {
        code: 'PN_INDEX_DUPLICATE',
        message:
          'Indexes "post_author_by_hand" and "post_author" on table "post" are identical: the planner sees them as the same index. The contract keeps both because each is named. Remove one of them.',
        item: 'table "post": indexes "post_author_by_hand" and "post_author"',
        summary:
          'tables have named indexes that are identical: the planner sees them as the same index. The contract keeps both because each is named. Remove one of each.',
      },
    ]);
  });

  it('names every index of an identical group in one warning', () => {
    const indexes = ['post_author_a', 'post_author_b', 'post_author_c'].map((map) =>
      declared({ columns: ['author_id'], map }),
    );

    expect(deduplicate({ indexes }).warnings.map((warning) => warning.item)).toEqual([
      'table "post": indexes "post_author_a", "post_author_b" and "post_author_c"',
    ]);
  });

  it('treats an explicit btree index as identical to one with no type, as the planner does', () => {
    const untyped = declared({ columns: ['author_id'] });
    const btree = declared({
      columns: ['author_id'],
      name: 'post_author',
      type: 'btree',
      options: {},
    });

    const result = deduplicate({ indexes: [untyped, btree] });

    expect(result.indexes).toEqual([btree]);
    expect(result.replacements).toEqual(new Map([[untyped, { kind: 'index', index: btree }]]));
  });

  it('keeps one of two identical expression indexes and warns when both are named', () => {
    const first = declared({ expression: 'lower(title)', map: 'post_title_lower' });
    const second = declared({ expression: 'lower(title)', map: 'post_title_lower_again' });

    const result = deduplicate({ indexes: [first, second] });

    expect(result.indexes).toEqual([first, second]);
    expect(result.warnings.map((warning) => warning.code)).toEqual(['PN_INDEX_DUPLICATE']);
  });

  it('keeps a plain index beside an expression unique index', () => {
    const plain = declared({ columns: ['title'] });
    const expressionUnique = declared({
      expression: 'lower(title)',
      unique: true,
      name: 'post_title_lower_u',
    });

    expect(deduplicate({ indexes: [plain, expressionUnique] })).toEqual({
      indexes: [plain, expressionUnique],
      replacements: new Map(),
      warnings: [],
    });
  });

  it('refuses two identical indexes both named with name:, naming both and the table', () => {
    expect(() =>
      deduplicate({
        indexes: [
          declared({ columns: ['author_id'], name: 'post_author' }),
          declared({ columns: ['author_id'], name: 'post_author_again' }),
        ],
      }),
    ).toThrow(
      'Indexes "post_author" and "post_author_again" on table "post" are identical and both named with name:; the planner pairs wire-named indexes by their content, so it could not tell them apart.',
    );
  });

  it.each([
    ['column order', { columns: ['title', 'author_id'] }],
    ['predicate', { where: 'archived_at IS NULL' }],
    ['type', { type: 'hash' }],
    ['options', { options: { fillfactor: 70 } }],
  ])('keeps two indexes that differ only in %s', (_label, difference) => {
    const base = { columns: ['author_id', 'title'], type: 'btree', options: {} };
    const first = declared(base);
    const second = declared({ ...base, ...difference });

    expect(deduplicate({ indexes: [first, second] })).toEqual({
      indexes: [first, second],
      replacements: new Map(),
      warnings: [],
    });
  });

  it('removes an unnamed index whose columns are the primary key and points it at the primary key', () => {
    const plain = declared({ columns: ['id'] });
    const primaryKey = { columns: ['id'] };

    expect(deduplicate({ indexes: [plain], primaryKey })).toEqual({
      indexes: [],
      replacements: new Map([[plain, { kind: 'primaryKey', primaryKey }]]),
      warnings: [],
    });
  });

  it('removes an unnamed index whose columns are a unique constraint and points it at the constraint', () => {
    const plain = declared({ columns: ['author_id'] });
    const unique = { columns: ['author_id'], name: 'post_author_key' };

    expect(deduplicate({ indexes: [plain], uniques: [unique] })).toEqual({
      indexes: [],
      replacements: new Map([[plain, { kind: 'uniqueConstraint', unique }]]),
      warnings: [],
    });
  });

  it('removes an unnamed index whose columns are a unique index and points it at the unique index', () => {
    const plain = declared({ columns: ['author_id'] });
    const uniqueIndex = declared({ columns: ['author_id'], unique: true, name: 'post_author_u' });

    expect(deduplicate({ indexes: [plain, uniqueIndex] })).toEqual({
      indexes: [uniqueIndex],
      replacements: new Map([[plain, { kind: 'index', index: uniqueIndex }]]),
      warnings: [],
    });
  });

  it('keeps an unnamed index beside a partial unique index on the same columns', () => {
    const plain = declared({ columns: ['author_id'] });
    const partialUnique = declared({
      columns: ['author_id'],
      unique: true,
      where: 'archived_at IS NULL',
      name: 'post_author_live',
    });

    expect(deduplicate({ indexes: [plain, partialUnique] })).toEqual({
      indexes: [plain, partialUnique],
      replacements: new Map(),
      warnings: [],
    });
  });

  it.each([
    ['a predicate', { where: 'archived_at IS NULL' }],
    ['a type', { type: 'hash', options: {} }],
  ])('keeps an index with %s beside a unique constraint on its columns', (_label, extra) => {
    const index = declared({ columns: ['author_id'], ...extra });

    expect(deduplicate({ indexes: [index], uniques: [{ columns: ['author_id'] }] })).toEqual({
      indexes: [index],
      replacements: new Map(),
      warnings: [],
    });
  });

  it('keeps a named index whose columns are a unique constraint and warns', () => {
    const named = declared({ columns: ['author_id'], name: 'post_author' });

    const result = deduplicate({ indexes: [named], uniques: [{ columns: ['author_id'] }] });

    expect(result.indexes).toEqual([named]);
    expect(result.replacements).toEqual(new Map());
    expect(result.warnings).toEqual([
      {
        code: 'PN_INDEX_REDUNDANT',
        message:
          'Index "post_author" on table "post" has the same columns as the unique constraint on (author_id), which already serves the same lookups. The contract keeps the index because it is named. Remove it.',
        item: 'table "post": index "post_author"',
        summary:
          'tables have a named index with the same columns as a unique constraint, unique index or primary key, which already serves the same lookups. The contract keeps each index because it is named. Remove them.',
      },
    ]);
  });

  it('names the primary key, a named unique constraint and a unique index in the redundancy warning', () => {
    const byPrimaryKey = declared({ columns: ['id'], name: 'post_id_lookup' });
    const byUniqueConstraint = declared({ columns: ['title'], name: 'post_title_lookup' });
    const byUniqueIndex = declared({ columns: ['slug'], map: 'post_slug_lookup' });
    const uniqueIndex = declared({ columns: ['slug'], unique: true, name: 'post_slug_u' });

    const result = deduplicate({
      indexes: [byPrimaryKey, byUniqueConstraint, byUniqueIndex, uniqueIndex],
      uniques: [{ columns: ['title'], name: 'post_title_key' }],
      primaryKey: { columns: ['id'] },
    });

    expect(result.warnings.map((warning) => warning.message)).toEqual([
      'Index "post_id_lookup" on table "post" has the same columns as the primary key, which already serves the same lookups. The contract keeps the index because it is named. Remove it.',
      'Index "post_title_lookup" on table "post" has the same columns as the unique constraint "post_title_key", which already serves the same lookups. The contract keeps the index because it is named. Remove it.',
      'Index "post_slug_lookup" on table "post" has the same columns as the unique index "post_slug_u", which already serves the same lookups. The contract keeps the index because it is named. Remove it.',
    ]);
  });
});
