import { describe, expect, it } from 'vitest';
import { ColumnRef } from '../src/ast/types';
import { ExpressionImpl } from '../src/expression-impl';
import { createIndexReferences, uniqueIndexNamesOfType } from '../src/index-reference';

const table = {
  indexes: [
    { name: 'post_title_11111111', prefix: 'post_title', columns: ['title'], type: 'gin' },
    { name: 'post_title_22222222', prefix: 'post_title', columns: ['title'] },
    { name: 'post_title_lower', expression: 'lower(title)' },
    {
      name: 'post_search',
      columns: ['title', 'id'],
      type: 'fulltext',
      options: { language: 'english' },
    },
  ],
};

function referencesFor(alias: string) {
  return createIndexReferences({
    namespaceId: 'public',
    tableName: 'posts',
    table,
    column: (column) =>
      new ExpressionImpl(ColumnRef.of(alias, column), { codecId: 'pg/text@1', nullable: false }),
  });
}

describe('createIndexReferences', () => {
  it('keys each index by its authored name, with its columns bound to the alias', () => {
    const search = referencesFor('p')['post_search'];

    expect({
      type: search?.type,
      options: search?.options,
      columns: Object.fromEntries(
        Object.entries(search?.columns ?? {}).map(([name, column]) => [name, column.buildAst()]),
      ),
    }).toEqual({
      type: 'fulltext',
      options: { language: 'english' },
      columns: { title: ColumnRef.of('p', 'title'), id: ColumnRef.of('p', 'id') },
    });
  });

  it('lists every authored name, and refuses one more than one index shares when it is read', () => {
    const references = referencesFor('posts');

    expect(Object.keys(references)).toEqual(['post_title', 'post_title_lower', 'post_search']);
    expect(() => references['post_title']).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'Table "posts" has more than one index named "post_title".',
      }),
    );
  });

  it('gives an expression index no columns', () => {
    expect(referencesFor('posts')['post_title_lower']?.columns).toEqual({});
  });

  it('returns the same reference on every read', () => {
    const references = referencesFor('posts');

    expect(references['post_search']).toBe(references['post_search']);
  });
});

describe('uniqueIndexNamesOfType', () => {
  it('names the indexes of one type by authored name, leaving out a name another index shares', () => {
    const indexes = [
      { name: 'a_11111111', prefix: 'a', type: 'fullText' },
      { name: 'b', type: 'fullText' },
      { name: 'shared_22222222', prefix: 'shared', type: 'fullText' },
      { name: 'shared_33333333', prefix: 'shared' },
      { name: 'c_44444444', prefix: 'c', type: 'gin' },
    ];

    expect({
      fullText: uniqueIndexNamesOfType(indexes, 'fullText'),
      hash: uniqueIndexNamesOfType(indexes, 'hash'),
    }).toEqual({ fullText: ['a', 'b'], hash: [] });
  });
});
