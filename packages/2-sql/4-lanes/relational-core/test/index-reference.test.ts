import { describe, expect, it } from 'vitest';
import { ColumnRef } from '../src/ast/types';
import { ExpressionImpl } from '../src/expression-impl';
import { createIndexReferences } from '../src/index-reference';

const table = {
  indexes: [
    { name: 'post_title_11111111', prefix: 'post_title', columns: ['title'], type: 'gin' },
    { name: 'post_title_22222222', prefix: 'post_title', columns: ['title'] },
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

    expect(Object.keys(references)).toEqual(['post_title', 'post_search']);
    expect(() => references['post_title']).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'Table "posts" has more than one index named "post_title".',
      }),
    );
  });

  it('returns the same reference on every read', () => {
    const references = referencesFor('posts');

    expect(references['post_search']).toBe(references['post_search']);
  });
});
