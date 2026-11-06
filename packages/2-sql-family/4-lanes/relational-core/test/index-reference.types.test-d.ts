import { expectTypeOf, test } from 'vitest';
import type { Expression, StorageColumnScopeField } from '../src/expression';
import type { TableIndexReferences, UniqueIndexNamesOfType } from '../src/index-reference';

type Int = { readonly codecId: 'pg/int4@1'; readonly nullable: false };
type Text = { readonly codecId: 'pg/text@1'; readonly nullable: true };

type PostIndexes = TableIndexReferences<{
  readonly columns: { readonly author_id: Int; readonly title: Text };
  readonly indexes: readonly [
    {
      readonly name: 'post_author_idx_11111111';
      readonly prefix: 'post_author_idx';
      readonly columns: readonly ['author_id'];
    },
    {
      readonly name: 'post_author_idx_22222222';
      readonly prefix: 'post_author_idx';
      readonly columns: readonly ['author_id'];
      readonly where: 'id > 0';
    },
    { readonly name: 'post_search'; readonly columns: readonly ['title'] },
    {
      readonly name: 'post_search_33333333';
      readonly prefix: 'post_search';
      readonly columns: readonly ['title'];
    },
    {
      readonly name: 'post_title_44444444';
      readonly prefix: 'post_title';
      readonly columns: readonly ['title'];
      readonly type: 'gin';
      readonly options: { readonly fastupdate: 'off' };
    },
  ];
}>;

test('an index name more than one index shares is not a key', () => {
  expectTypeOf<keyof PostIndexes>().toEqualTypeOf<'post_title'>();
});

test('an index reference carries the type, the options and the columns as expressions', () => {
  expectTypeOf<PostIndexes['post_title']['type']>().toEqualTypeOf<'gin'>();
  expectTypeOf<PostIndexes['post_title']['options']>().toEqualTypeOf<{
    readonly fastupdate: 'off';
  }>();
  expectTypeOf<PostIndexes['post_title']['columns']>().toEqualTypeOf<{
    readonly title: Expression<StorageColumnScopeField<Text>>;
  }>();
});

type SearchIndexes =
  | { readonly name: 'a_11111111'; readonly prefix: 'a'; readonly type: 'fullText' }
  | { readonly name: 'b'; readonly type: 'fullText' }
  | { readonly name: 'shared_22222222'; readonly prefix: 'shared'; readonly type: 'fullText' }
  | { readonly name: 'shared_33333333'; readonly prefix: 'shared' }
  | { readonly name: 'c_44444444'; readonly prefix: 'c'; readonly type: 'gin' };

test('the unique names of the indexes of one type leave out a name another index shares', () => {
  expectTypeOf<UniqueIndexNamesOfType<SearchIndexes, 'fullText'>>().toEqualTypeOf<'a' | 'b'>();
  expectTypeOf<UniqueIndexNamesOfType<SearchIndexes, 'hash'>>().toBeNever();
});
