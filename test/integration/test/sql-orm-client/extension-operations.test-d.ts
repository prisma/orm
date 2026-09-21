import type { ComparisonMethods, ModelAccessor } from '@internal/sql-orm-client';
import { describe, expectTypeOf, test } from 'vitest';
import type { Contract } from './fixtures/generated/contract';

type PostAccessor = ModelAccessor<Contract, 'Post'>;
type UserAccessor = ModelAccessor<Contract, 'User'>;

describe('extension operations only appear on fields whose codec matches', () => {
  test('vector field exposes cosineDistance', () => {
    expectTypeOf<PostAccessor['embedding']>().toHaveProperty('cosineDistance');
  });

  test('vector field exposes cosineSimilarity', () => {
    expectTypeOf<PostAccessor['embedding']>().toHaveProperty('cosineSimilarity');
  });

  test('text field does not expose cosineDistance', () => {
    expectTypeOf<PostAccessor['title']>().not.toHaveProperty('cosineDistance');
  });

  test('text field does not expose cosineSimilarity', () => {
    expectTypeOf<PostAccessor['title']>().not.toHaveProperty('cosineSimilarity');
  });

  test('numeric field does not expose cosineDistance', () => {
    expectTypeOf<PostAccessor['views']>().not.toHaveProperty('cosineDistance');
  });

  test('numeric field does not expose cosineSimilarity', () => {
    expectTypeOf<PostAccessor['views']>().not.toHaveProperty('cosineSimilarity');
  });

  test('fields on a model without vector columns have no extension ops', () => {
    expectTypeOf<UserAccessor['name']>().not.toHaveProperty('cosineDistance');
    expectTypeOf<UserAccessor['name']>().not.toHaveProperty('cosineSimilarity');
  });
});

describe('extension operation argument types', () => {
  test('cosineDistance accepts raw JS value, null, and another vector column', () => {
    type Fn = PostAccessor['embedding']['cosineDistance'];
    expectTypeOf<Fn>().toBeFunction();
    const fn = null as unknown as Fn;
    // Raw JS vector literal
    fn([1, 2, 3]);
    // null (embedding is nullable)
    fn(null);
    // Another vector column — column handles implement Expression, so they
    // satisfy the Expression arm of CodecExpression.
    const otherPost = null as unknown as PostAccessor;
    fn(otherPost.embedding);
  });

  test('cosineSimilarity accepts raw JS value, null, and another vector column', () => {
    type Fn = PostAccessor['embedding']['cosineSimilarity'];
    expectTypeOf<Fn>().toBeFunction();
    const fn = null as unknown as Fn;
    fn([1, 2, 3]);
    fn(null);
    const otherPost = null as unknown as PostAccessor;
    fn(otherPost.embedding);
  });
});

describe('extension ops return ComparisonMethods with return-codec traits', () => {
  type CosineDistanceResult = ReturnType<PostAccessor['embedding']['cosineDistance']>;

  test('cosineDistance returns numeric comparison methods', () => {
    expectTypeOf<CosineDistanceResult>().toEqualTypeOf<
      ComparisonMethods<number, 'equality' | 'order' | 'numeric'>
    >();
  });

  test('cosineDistance result exposes eq', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('eq');
  });

  test('cosineDistance result exposes gt', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('gt');
  });

  test('cosineDistance result exposes lt', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('lt');
  });

  test('cosineDistance result exposes asc for ordering', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('asc');
  });

  test('cosineDistance result exposes desc for ordering', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('desc');
  });

  test('cosineDistance result does not expose like (textual-only)', () => {
    expectTypeOf<CosineDistanceResult>().not.toHaveProperty('like');
  });

  test('cosineDistance result does not expose ilike (extension op, not comparison method)', () => {
    expectTypeOf<CosineDistanceResult>().not.toHaveProperty('ilike');
  });
});

describe('ilike extension operation on text fields', () => {
  test('text field exposes ilike', () => {
    expectTypeOf<PostAccessor['title']>().toHaveProperty('ilike');
  });

  test('ilike returns AnyExpression (predicate)', () => {
    type IlikeFn = PostAccessor['title']['ilike'];
    expectTypeOf<IlikeFn>().toBeFunction();
    expectTypeOf<ReturnType<IlikeFn>>().toExtend<
      import('@internal/sql-relational-core/ast').AnyExpression
    >();
  });

  test('numeric field does not expose ilike', () => {
    expectTypeOf<PostAccessor['views']>().not.toHaveProperty('ilike');
  });

  test('vector field does not expose ilike', () => {
    expectTypeOf<PostAccessor['embedding']>().not.toHaveProperty('ilike');
  });
});

describe('vector field itself: only equality trait', () => {
  test('vector field exposes eq', () => {
    expectTypeOf<PostAccessor['embedding']>().toHaveProperty('eq');
  });

  test('vector field exposes isNull', () => {
    expectTypeOf<PostAccessor['embedding']>().toHaveProperty('isNull');
  });

  test('vector field does not expose gt (no order trait)', () => {
    expectTypeOf<PostAccessor['embedding']>().not.toHaveProperty('gt');
  });

  test('vector field does not expose like (no textual trait)', () => {
    expectTypeOf<PostAccessor['embedding']>().not.toHaveProperty('like');
  });

  test('vector field does not expose asc (no order trait)', () => {
    expectTypeOf<PostAccessor['embedding']>().not.toHaveProperty('asc');
  });
});

describe('full-text search operations on text fields', () => {
  test('text field exposes the full-text operations', () => {
    expectTypeOf<PostAccessor['title']>().toHaveProperty('fullTextMatches');
    expectTypeOf<PostAccessor['title']>().toHaveProperty('fullTextRank');
    expectTypeOf<PostAccessor['title']>().toHaveProperty('fullTextHeadline');
  });

  test('numeric and vector fields do not', () => {
    expectTypeOf<PostAccessor['views']>().not.toHaveProperty('fullTextMatches');
    expectTypeOf<PostAccessor['embedding']>().not.toHaveProperty('fullTextMatches');
  });

  test('fullTextMatches returns a predicate expression', () => {
    type Fn = PostAccessor['title']['fullTextMatches'];
    expectTypeOf<Fn>().toBeFunction();
    expectTypeOf<ReturnType<Fn>>().toExtend<
      import('@internal/sql-relational-core/ast').AnyExpression
    >();
  });

  test('fullTextRank returns numeric comparison methods, so it can order results', () => {
    type RankResult = ReturnType<PostAccessor['title']['fullTextRank']>;
    expectTypeOf<RankResult>().toEqualTypeOf<
      ComparisonMethods<number, 'equality' | 'order' | 'numeric'>
    >();
    expectTypeOf<RankResult>().toHaveProperty('desc');
  });

  test('fullTextHeadline returns textual comparison methods', () => {
    type HeadlineResult = ReturnType<PostAccessor['title']['fullTextHeadline']>;
    expectTypeOf<HeadlineResult>().toHaveProperty('like');
  });

  test('the language argument is one of the configurations Postgres ships with', () => {
    const title = null as unknown as PostAccessor['title'];
    title.fullTextMatches('alice', { language: 'german' });
    // @ts-expect-error 'klingon' is not a PostgreSQL text-search configuration
    title.fullTextMatches('alice', { language: 'klingon' });
  });
});
