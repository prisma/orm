import { SqlIndexIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { identicalIndexes, leadingBackingObjectName } from '../src/index-equivalence';

function liveIndex(
  name: string,
  shape: {
    readonly columns?: readonly string[];
    readonly expression?: string;
    readonly where?: string;
    readonly unique?: boolean;
    readonly type?: string;
    readonly options?: Record<string, unknown>;
  },
): SqlIndexIR {
  return new SqlIndexIR({
    naming: { kind: 'exact', name },
    ...(shape.expression === undefined
      ? { columns: shape.columns ?? [] }
      : { expression: shape.expression }),
    where: shape.where,
    unique: shape.unique ?? false,
    type: shape.type,
    options: shape.options,
    annotations: undefined,
    dependsOn: undefined,
    partial: shape.where !== undefined,
  });
}

function nameFor(table: {
  readonly indexes?: readonly SqlIndexIR[];
  readonly uniques?: readonly { readonly columns: readonly string[]; readonly name?: string }[];
  readonly primaryKey?: { readonly columns: readonly string[]; readonly name?: string };
}) {
  return leadingBackingObjectName(['author_id'], {
    indexes: table.indexes ?? [],
    nodeOf: (index) => index,
    nameOf: (index) => index.name,
    uniques: table.uniques ?? [],
    primaryKey: table.primaryKey,
  });
}

describe('leadingBackingObjectName', () => {
  it.each([
    [
      'a named primary key',
      { primaryKey: { columns: ['author_id', 'id'], name: 'post_pkey' } },
      'post_pkey',
    ],
    [
      'a named unique constraint',
      { uniques: [{ columns: ['author_id', 'slug'], name: 'post_slug_key' }] },
      'post_slug_key',
    ],
    [
      'a plain index',
      { indexes: [liveIndex('post_author_created', { columns: ['author_id', 'created_at'] })] },
      'post_author_created',
    ],
    [
      'a btree index',
      {
        indexes: [
          liveIndex('post_author_created', { columns: ['author_id', 'created_at'], type: 'btree' }),
        ],
      },
      'post_author_created',
    ],
  ] as const)('names %s whose first columns are the foreign key columns', (_label, table, name) => {
    expect(nameFor(table)).toBe(name);
  });

  it.each([
    ['an unnamed primary key', { primaryKey: { columns: ['author_id', 'id'] } }],
    ['an unnamed unique constraint', { uniques: [{ columns: ['author_id', 'slug'] }] }],
    [
      'a key that does not start with the columns',
      { primaryKey: { columns: ['id', 'author_id'], name: 'post_pkey' } },
    ],
    [
      'a partial index',
      {
        indexes: [liveIndex('post_author_live', { columns: ['author_id', 'id'], where: 'id > 0' })],
      },
    ],
    [
      'a typed index',
      { indexes: [liveIndex('post_author_hash', { columns: ['author_id'], type: 'hash' })] },
    ],
    [
      'an expression index',
      { indexes: [liveIndex('post_author_lower', { expression: 'lower(author_id)' })] },
    ],
  ] as const)('names nothing for %s', (_label, table) => {
    expect(nameFor(table)).toBeUndefined();
  });
});

describe('identicalIndexes for full-text indexes', () => {
  const fullText = (name: string, weightGroups: readonly (readonly string[])[], language: string) =>
    liveIndex(name, {
      columns: weightGroups.flat(),
      type: 'fullText',
      options: { weightGroups, language },
    });

  it('sees two full-text indexes with the same weight groups and language as identical', () => {
    expect(
      identicalIndexes(
        fullText('post_search', [['title'], ['body']], 'english'),
        fullText('post_search_again', [['title'], ['body']], 'english'),
      ),
    ).toBe(true);
  });

  it.each([
    ['grouped differently', fullText('post_search_grouped', [['title', 'body']], 'english')],
    ['in another language', fullText('post_search_german', [['title'], ['body']], 'german')],
    [
      'a plain gin index over a different expression',
      liveIndex('post_title_trgm', { expression: 'title gin_trgm_ops', type: 'gin' }),
    ],
    [
      'a plain gin index on the same columns',
      liveIndex('post_gin', { columns: ['title', 'body'], type: 'gin' }),
    ],
  ] as const)('tells a full-text index apart from one %s', (_label, other) => {
    expect(identicalIndexes(fullText('post_search', [['title'], ['body']], 'english'), other)).toBe(
      false,
    );
  });
});
