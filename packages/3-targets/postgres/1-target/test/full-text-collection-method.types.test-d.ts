import { describe, expectTypeOf, test } from 'vitest';
import type {
  PostgresFullTextMethods,
  PostgresTsqueryArgument,
} from '../src/core/full-text-collection-method';

type MethodsFor<
  Target extends string,
  Indexes extends readonly unknown[],
> = (PostgresFullTextMethods & {
  readonly model: {
    readonly target: Target;
    readonly name: 'Post';
    readonly fields: Record<never, never>;
    readonly relations: Record<never, never>;
    readonly table: { readonly columns: Record<never, never>; readonly indexes: Indexes };
  };
})['methods'];

type Indexes = readonly [
  { readonly name: 'post_search_1'; readonly prefix: 'post_search'; readonly type: 'fullText' },
  { readonly name: 'title_search'; readonly type: 'fullText' },
  { readonly name: 'post_title_2'; readonly prefix: 'post_title' },
  { readonly name: 'shared_3'; readonly prefix: 'shared'; readonly type: 'fullText' },
  { readonly name: 'shared_4'; readonly prefix: 'shared'; readonly type: 'fullText' },
];

describe('the Postgres full-text collection methods', () => {
  test('are one per full-text index, named after the index, taking a tsquery, filtering and ordering', () => {
    type Search = {
      readonly parameters: readonly [query: PostgresTsqueryArgument];
      readonly filters: true;
      readonly orders: true;
    };
    expectTypeOf<MethodsFor<'postgres', Indexes>>().toEqualTypeOf<{
      readonly post_search: Search;
      readonly title_search: Search;
    }>();
  });

  test('leave out a name two indexes share', () => {
    expectTypeOf<'shared'>().not.toExtend<keyof MethodsFor<'postgres', Indexes>>();
  });

  test('are none for another target', () => {
    expectTypeOf<MethodsFor<'sqlite', Indexes>>().toEqualTypeOf<Record<never, never>>();
  });
});
