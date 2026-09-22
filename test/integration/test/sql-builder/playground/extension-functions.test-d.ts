import type { BooleanCodecType, Expression } from '@internal/sql-builder/types';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
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
    const result = fns.fullTextMatches(f.name, 'alice');
    expectTypeOf(result).toEqualTypeOf<Expression<{ codecId: 'pg/bool@1'; nullable: false }>>();
    return result;
  });
});

test('fullTextRank returns a non-nullable float4 expression', () => {
  const ranked = db.public.users
    .select('id')
    .select('rank', (f, fns) => {
      const result = fns.fullTextRank(f.name, 'alice');
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
      const result = fns.fullTextHeadline(f.name, 'alice');
      expectTypeOf(result).toEqualTypeOf<Expression<{ codecId: 'pg/text@1'; nullable: false }>>();
      return result;
    })
    .build();

  expectTypeOf(headlined).toEqualTypeOf<SqlQueryPlan<{ id: number; snippet: string }>>();
});

test('the language argument is one of the configurations Postgres ships with', () => {
  db.public.users
    .select('id')
    .where((f, fns) => fns.fullTextMatches(f.name, 'alice', { language: 'german' }));

  db.public.users
    .select('id')
    // @ts-expect-error 'klingon' is not a PostgreSQL text-search configuration
    .where((f, fns) => fns.fullTextMatches(f.name, 'alice', { language: 'klingon' }));
});

test('rank and headline options are typed', () => {
  db.public.users
    .select('id')
    .select('rank', (f, fns) => fns.fullTextRank(f.name, 'alice', { normalization: 32 }))
    .select('snippet', (f, fns) => fns.fullTextHeadline(f.name, 'alice', { startSel: '<mark>' }));

  db.public.users
    .select('id')
    // @ts-expect-error normalization is a number, not a word
    .select('rank', (f, fns) => fns.fullTextRank(f.name, 'alice', { normalization: 'high' }));

  db.public.users
    .select('id')
    // @ts-expect-error startSel is the marker text, not a number
    .select('snippet', (f, fns) => fns.fullTextHeadline(f.name, 'alice', { startSel: 1 }));
});
