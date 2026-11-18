/**
 * Type-tests: the ORM aggregate surfaces derive from the contract's emitted
 * aggregate map. A contributed operation name — one no client source spells
 * out — surfaces as a typed method with exactly the arities its rows admit,
 * on the top-level builder and the include reducers alike; an operation the
 * map does not declare is no method at all; and the HAVING surface admits
 * only operations with a plain SQL form.
 */

import type { ExtractTypeMapsFromContract, TypeMapsPhantomKey } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { IncludeRefinementCollection } from '../src/collection-internal-types';
import type {
  AggregateBuilder,
  AggregateSelector,
  DefaultCollectionTypeState,
  DefaultModelRow,
  HavingBuilder,
  HavingComparisonMethods,
  IncludeScalar,
} from '../src/types';
import type { TestContract } from './helpers';

type TestTypeMaps = ExtractTypeMapsFromContract<TestContract>;

// Override `aggregateTypes` with Omit + replace — a plain intersection would
// leave the base map's operations visible alongside the override's.
type ContributedTypeMaps = Omit<TestTypeMaps, 'aggregateTypes'> & {
  readonly aggregateTypes: {
    readonly count: TestTypeMaps['aggregateTypes']['count'];
    readonly median: {
      readonly byCodec: {
        readonly 'pg/int4@1': { readonly output: 'pg/float8@1'; readonly nullable: true };
      };
    };
    readonly tally: {
      readonly byCodec: Record<never, never>;
      readonly withoutInput: { readonly output: 'pg/int8@1'; readonly nullable: false };
    };
  };
};

type ContributedContract = Omit<TestContract, TypeMapsPhantomKey> & {
  readonly [K in TypeMapsPhantomKey]?: ContributedTypeMaps;
};

declare const agg: AggregateBuilder<ContributedContract, 'Post'>;

test('a contributed field-taking operation surfaces typed by its byCodec row', () => {
  expectTypeOf(agg.median('views')).toEqualTypeOf<AggregateSelector<number | null>>();
});

test('a contributed no-input operation surfaces as a zero-argument method', () => {
  expectTypeOf(agg.tally()).toEqualTypeOf<AggregateSelector<bigint>>();
});

test('a field the contributed operation declares no row for is rejected', () => {
  // @ts-expect-error — median declares no row over pg/text@1 and no anyInput
  agg.median('title');
});

test('a zero-argument call without a withoutInput row is rejected', () => {
  // @ts-expect-error — median declares no withoutInput row
  agg.median();
});

test('a field-taking call on a no-input-only operation is rejected', () => {
  // @ts-expect-error — tally declares no byCodec or anyInput rows
  agg.tally('views');
});

test('row presence gives count both arities as a data fact', () => {
  expectTypeOf(agg.count()).toEqualTypeOf<AggregateSelector<number>>();
  expectTypeOf(agg.count('views')).toEqualTypeOf<AggregateSelector<number>>();
});

declare const baseAgg: AggregateBuilder<TestContract, 'Post'>;

test('an operation the contract does not declare is no method at all', () => {
  // @ts-expect-error — the contract's aggregate map declares no median
  baseAgg.median('views');
});

type ToManyRefinement = IncludeRefinementCollection<
  ContributedContract,
  'Post',
  DefaultModelRow<ContributedContract, 'Post'>,
  DefaultCollectionTypeState,
  true
>;
type ToOneRefinement = IncludeRefinementCollection<
  ContributedContract,
  'Post',
  DefaultModelRow<ContributedContract, 'Post'>,
  DefaultCollectionTypeState,
  false
>;

declare const posts: ToManyRefinement;
declare const author: ToOneRefinement;

test('include reducers derive from the same map with the same arities', () => {
  expectTypeOf(posts.median('views')).toEqualTypeOf<IncludeScalar<number | null>>();
  expectTypeOf(posts.tally()).toEqualTypeOf<IncludeScalar<bigint>>();
});

test('a to-one refinement carries no scalar reducers', () => {
  // @ts-expect-error — scalar reducers are to-many only
  author.median('views');
});

declare const having: HavingBuilder<ContributedContract, 'Post'>;
declare const baseHaving: HavingBuilder<TestContract, 'Post'>;

test('the HAVING surface admits only operations with a plain SQL form', () => {
  // @ts-expect-error — median is outside the SQL aggregate alphabet
  having.median('views');
});

test('HAVING comparands read nullability off the declared row', () => {
  expectTypeOf(baseHaving.count()).toEqualTypeOf<
    HavingComparisonMethods<number, 'pg/int8number@1'>
  >();
  expectTypeOf(baseHaving.sum('views')).toEqualTypeOf<
    HavingComparisonMethods<number | null, 'pg/int8number@1'>
  >();
});
