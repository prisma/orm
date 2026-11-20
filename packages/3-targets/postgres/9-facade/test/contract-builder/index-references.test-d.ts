import { websearchToTsquery } from '@internal/target-postgres/full-text';
import { expectTypeOf, test } from 'vitest';
import {
  defineContract,
  field,
  fullTextIndex,
  model,
  sql,
} from '../../src/exports/contract-builder';
import postgres from '../../src/exports/runtime';

const int4 = { codecId: 'pg/int4@1' } as const;
const text = { codecId: 'pg/text@1' } as const;

const Author = model('Author', {
  fields: { id: field.column(int4).id(), handle: field.column(text).unique() },
}).sql({ table: 'authors' });

const Article = model('Article', {
  fields: {
    id: field.column(int4).id(),
    title: field.column(text),
    subtitle: field.column(text).column('sub_title'),
    body: field.column(text),
    slug: field.column(text),
    authorId: field.column(int4).column('author_id'),
  },
}).sql(({ cols, constraints }) => ({
  table: 'articles',
  indexes: [
    constraints.index([cols.slug], { name: 'by_slug' }),
    constraints.index([cols.title, cols.body]),
    constraints.index([cols.body], { map: 'articles_body_exact' }),
    fullTextIndex([[cols.title, cols.subtitle], cols.body], { name: 'search' }),
    fullTextIndex(cols.body, { name: 'search_de', language: 'german' }),
  ],
  foreignKeys: [constraints.foreignKey(cols.authorId, Author.refs.id)],
}));

const contract = defineContract({ models: { Author, Article } });
const db = postgres({ contract, url: 'postgres://localhost/db' });

test('a where callback offers exactly the declared index names and the foreign key backing index', () => {
  db.orm.public.Article.where((_article, { indexes }) => {
    expectTypeOf<keyof typeof indexes>().toEqualTypeOf<
      | 'by_slug'
      | 'articles_title_body_idx'
      | 'articles_body_exact'
      | 'search'
      | 'search_de'
      | 'articles_author_id_idx'
    >();
    return _article.id.eq(1);
  });
});

test('an index reference carries its columns, type and options', () => {
  db.orm.public.Article.where((_article, { indexes }) => {
    expectTypeOf<keyof (typeof indexes)['search']['columns']>().toEqualTypeOf<
      'title' | 'sub_title' | 'body'
    >();
    expectTypeOf(indexes.search.type).toEqualTypeOf<'fullText'>();
    expectTypeOf(indexes.search.options).toEqualTypeOf<{
      readonly language: 'english';
      readonly weightGroups: readonly [readonly ['title', 'sub_title'], readonly ['body']];
    }>();
    expectTypeOf(indexes.search_de.options.language).toEqualTypeOf<'german'>();
    expectTypeOf(indexes.by_slug.type).toEqualTypeOf<undefined>();
    return _article.id.eq(1);
  });
});

test('a full-text operation takes a full-text index of the contract', () => {
  db.orm.public.Article.where((_article, { fns, indexes }) =>
    fns.fullTextMatches(indexes.search, websearchToTsquery('zebra')),
  );
});

const Writer = model('Writer', { fields: { id: field.column(int4).id() } }).sql({
  table: 'writers',
});

const LongNames = model('LongNames', {
  fields: {
    id: field.column(int4).id(),
    writerReference: field.column(int4).column('author_reference_identifier_column'),
  },
}).sql(({ cols, constraints }) => ({
  table: 'a_rather_long_table_name_for_probing',
  foreignKeys: [constraints.foreignKey(cols.writerReference, Writer.refs.id)],
}));

const Partials = model('Partials', {
  fields: { id: field.column(int4).id(), writerId: field.column(int4).column('writer_id') },
}).sql(({ cols, constraints }) => ({
  table: 'partials',
  indexes: [
    constraints.index([cols.writerId], { name: 'positive_writer', where: sql`writer_id > 0` }),
  ],
  foreignKeys: [constraints.foreignKey(cols.writerId, Writer.refs.id)],
}));

const Covered = model('Covered', {
  fields: { id: field.column(int4).id(), writerId: field.column(int4).column('writer_id') },
}).sql(({ cols, constraints }) => ({
  table: 'covered',
  indexes: [constraints.index([cols.writerId], { name: 'by_writer' })],
  foreignKeys: [constraints.foreignKey(cols.writerId, Writer.refs.id)],
}));

const namingContract = defineContract({ models: { Writer, LongNames, Partials, Covered } });
const naming = postgres({ contract: namingContract, url: 'postgres://localhost/db' });

test('a backing index name longer than 54 bytes is cut as the build cuts it', () => {
  naming.orm.public.LongNames.where((row, { indexes }) => {
    expectTypeOf<
      keyof typeof indexes
    >().toEqualTypeOf<'a_rather_long_table_name_for_probing_author_reference_'>();
    return row.id.eq(1);
  });
});

test('a partial index on the foreign key columns does not replace the backing index', () => {
  naming.orm.public.Partials.where((row, { indexes }) => {
    expectTypeOf<keyof typeof indexes>().toEqualTypeOf<
      'positive_writer' | 'partials_writer_id_idx'
    >();
    return row.id.eq(1);
  });
});

test('a plain index on the foreign key columns replaces the backing index', () => {
  naming.orm.public.Covered.where((row, { indexes }) => {
    expectTypeOf<keyof typeof indexes>().toEqualTypeOf<'by_writer'>();
    return row.id.eq(1);
  });
});
