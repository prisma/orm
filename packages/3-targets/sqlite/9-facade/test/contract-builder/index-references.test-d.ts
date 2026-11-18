import { expectTypeOf, test } from 'vitest';
import { defineContract, field, model } from '../../src/exports/contract-builder';
import sqlite from '../../src/exports/runtime';

const integer = { codecId: 'sqlite/integer@1' } as const;
const text = { codecId: 'sqlite/text@1' } as const;

const Author = model('Author', {
  fields: { id: field.column(integer).id(), handle: field.column(text) },
}).sql({ table: 'authors' });

const Article = model('Article', {
  fields: {
    id: field.column(integer).id(),
    title: field.column(text),
    body: field.column(text),
    slug: field.column(text),
    authorId: field.column(integer).column('author_id'),
    editorId: field.column(integer).column('editor_id'),
  },
}).sql(({ cols, constraints }) => ({
  table: 'articles',
  indexes: [
    constraints.index([cols.slug], { name: 'by_slug', unique: true }),
    constraints.index([cols.title, cols.body]),
    constraints.index([cols.body], { map: 'articles_body_exact' }),
  ],
  foreignKeys: [
    constraints.foreignKey(cols.authorId, Author.refs.id),
    constraints.foreignKey(cols.editorId, Author.refs.id, { index: false }),
  ],
}));

const contract = defineContract({ models: { Author, Article } });
const db = sqlite({ contract, path: ':memory:' });

test('a where callback offers exactly the declared index names and the foreign key backing indexes', () => {
  db.orm.Article.where((article, { indexes }) => {
    expectTypeOf<keyof typeof indexes>().toEqualTypeOf<
      'by_slug' | 'articles_title_body_idx' | 'articles_body_exact' | 'articles_author_id_idx'
    >();
    expectTypeOf<keyof (typeof indexes)['articles_title_body_idx']['columns']>().toEqualTypeOf<
      'title' | 'body'
    >();
    return article.id.eq(1);
  });
});

test('a model without indexes offers none', () => {
  db.orm.Author.where((author, { indexes }) => {
    expectTypeOf<keyof typeof indexes>().toEqualTypeOf<never>();
    return author.id.eq(1);
  });
});
