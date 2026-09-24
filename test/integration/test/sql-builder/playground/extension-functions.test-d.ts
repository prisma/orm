import type { BooleanCodecType, Expression } from '@internal/sql-builder/types';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { tsquery } from '@internal/target-postgres/full-text';
import { expectTypeOf, test } from 'vitest';
import { db } from './preamble';

test('extension function in select expression', () => {
  const withDistance = db.public.posts
    .select('id')
    .select('distance', (f, fns) => fns.cosineDistance(f.embedding, f.embedding))
    .build();

  expectTypeOf(withDistance).toEqualTypeOf<SqlQueryPlan<{ id: number; distance: number }>>();
});

test('extension function in orderBy', () => {
  const ordered = db.public.posts
    .select('id', 'title')
    .orderBy((f, fns) => fns.cosineDistance(f.embedding, [1, 2, 3]))
    .build();

  expectTypeOf(ordered).toEqualTypeOf<SqlQueryPlan<{ id: number; title: string }>>();
});

test('extension function composed with builtins in where', () => {
  const filtered = db.public.posts
    .select('id', 'title')
    .where((f, fns) => fns.lt(fns.cosineDistance(f.embedding, [1, 2, 3]), 0.5))
    .build();

  expectTypeOf(filtered).toEqualTypeOf<SqlQueryPlan<{ id: number; title: string }>>();
});

test('ilike filters text fields in where', () => {
  const filtered = db.public.users
    .select('id', 'name')
    .where((f, fns) => fns.ilike(f.name, '%alice%'))
    .build();

  expectTypeOf(filtered).toEqualTypeOf<SqlQueryPlan<{ id: number; name: string }>>();
});

test('ilike returns boolean expression', () => {
  db.public.users.select('id').where((f, fns) => {
    const result = fns.ilike(f.name, '%test%');
    expectTypeOf(result).toExtend<Expression<BooleanCodecType>>();
    return result;
  });
});

test('fullTextMatches returns a non-nullable boolean expression', () => {
  db.public.users.select('id').where((f, fns) => {
    const result = fns.fullTextMatches(f.name, fns.websearchToTsquery('alice'));
    expectTypeOf(result).toEqualTypeOf<Expression<{ codecId: 'pg/bool@1'; nullable: false }>>();
    return result;
  });
});

test('the parsers are fns returning a non-nullable tsquery expression', () => {
  db.public.users.select('id').where((f, fns) => {
    type Tsquery = Expression<{ codecId: 'pg/tsquery@1'; nullable: false }>;
    expectTypeOf(fns.websearchToTsquery('alice')).toEqualTypeOf<Tsquery>();
    expectTypeOf(fns.toTsquery("'alice' & !'bob'")).toEqualTypeOf<Tsquery>();
    expectTypeOf(fns.plaintoTsquery('alice bob')).toEqualTypeOf<Tsquery>();
    expectTypeOf(fns.phrasetoTsquery(f.name, { language: 'german' })).toEqualTypeOf<Tsquery>();
    return fns.fullTextMatches(f.name, fns.toTsquery('ali:*'));
  });
});

test('the query is a tsquery from a parser or the tsquery tag, never another type', () => {
  db.public.users
    .select('id')
    .select('rank', (f, fns) => fns.fullTextRank(f.name, tsquery`${'ali'}:*`))
    .select('snippet', (f, fns) => fns.fullTextHeadline(f.name, tsquery`${'ali'}:*`))
    .where((f, fns) => fns.fullTextMatches(f.name, tsquery`${'ali'}:*`));
  db.public.users
    .select('id')
    // @ts-expect-error a bare string is not a tsquery; parse it first
    .where((f, fns) => fns.fullTextMatches(f.name, 'ali:*'));
  db.public.users
    .select('id')
    // @ts-expect-error a number is neither a tsquery expression nor tsquery text
    .where((f, fns) => fns.fullTextMatches(f.name, 42));
  db.public.users
    .select('id')
    // @ts-expect-error a text column is not a tsquery; parse it first
    .where((f, fns) => fns.fullTextMatches(f.name, f.name));
});

test('a tsquery read back from a query is a string, and is accepted as the query', () => {
  const plan = db.public.users
    .select('query', (_f, fns) => fns.websearchToTsquery('alice'))
    .build();
  type Row = typeof plan extends SqlQueryPlan<infer R> ? R : never;
  const row = null as unknown as Row;

  expectTypeOf(row.query).toExtend<string>();
  expectTypeOf<string>().not.toExtend<Row['query']>();
  db.public.users.select('id').where((f, fns) => fns.fullTextMatches(f.name, row.query));
});

test('fullTextRank returns a non-nullable float4 expression', () => {
  const ranked = db.public.users
    .select('id')
    .select('rank', (f, fns) => {
      const result = fns.fullTextRank(f.name, fns.websearchToTsquery('alice'));
      expectTypeOf(result).toEqualTypeOf<Expression<{ codecId: 'pg/float4@1'; nullable: false }>>();
      return result;
    })
    .build();

  expectTypeOf(ranked).toEqualTypeOf<SqlQueryPlan<{ id: number; rank: number }>>();
});

test('fullTextHeadline returns a non-nullable text expression', () => {
  const headlined = db.public.users
    .select('id')
    .select('snippet', (f, fns) => {
      const result = fns.fullTextHeadline(f.name, fns.websearchToTsquery('alice'));
      expectTypeOf(result).toEqualTypeOf<Expression<{ codecId: 'pg/text@1'; nullable: false }>>();
      return result;
    })
    .build();

  expectTypeOf(headlined).toEqualTypeOf<SqlQueryPlan<{ id: number; snippet: string }>>();
});

test('the language argument is one of the configurations Postgres ships with', () => {
  db.public.users
    .select('id')
    .where((f, fns) =>
      fns.fullTextMatches(f.name, fns.websearchToTsquery('alice'), { language: 'german' }),
    );

  db.public.users.select('id').where((f, fns) =>
    // @ts-expect-error 'klingon' is not a PostgreSQL text-search configuration
    fns.fullTextMatches(f.name, fns.websearchToTsquery('alice'), { language: 'klingon' }),
  );
});

test('rank and headline options are typed', () => {
  db.public.users
    .select('id')
    .select('rank', (f, fns) =>
      fns.fullTextRank(f.name, fns.websearchToTsquery('alice'), { normalization: 32 }),
    )
    .select('snippet', (f, fns) =>
      fns.fullTextHeadline(f.name, fns.websearchToTsquery('alice'), { startSel: '<mark>' }),
    );

  db.public.users.select('id').select('rank', (f, fns) =>
    // @ts-expect-error normalization is a number, not a word
    fns.fullTextRank(f.name, fns.websearchToTsquery('alice'), { normalization: 'high' }),
  );

  db.public.users.select('id').select('snippet', (f, fns) =>
    // @ts-expect-error startSel is the marker text, not a number
    fns.fullTextHeadline(f.name, fns.websearchToTsquery('alice'), { startSel: 1 }),
  );
});

test('a parser takes a varchar column, but not a non-textual one', () => {
  db.public.comments
    .select('query', (f, fns) => fns.websearchToTsquery(f.subject))
    .where((f, fns) => fns.fullTextMatches(f.body, fns.websearchToTsquery(f.subject)));
  db.public.comments
    // @ts-expect-error an integer column is not text
    .select('query', (f, fns) => fns.websearchToTsquery(f.id));
});
