import type { Contract, NamespaceId } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type {
  IncludeRefinementValue,
  RowSelection,
  RowWitness,
  WithPagingState,
  WithVariantState,
  WithWhereState,
} from '../src/collection-internal-types';
import type {
  CollectionTypeState,
  DefaultCollectionTypeState,
  IncludeRelationValue,
} from '../src/types';

type Int4Field = {
  readonly many: false;
  readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
  readonly nullable: false;
};

type AuthorRelation<Nullable extends boolean> = {
  readonly to: { readonly namespace: 'public' & NamespaceId; readonly model: 'User' };
  readonly cardinality: 'N:1';
  readonly nullable: Nullable;
  readonly on: {
    readonly localFields: readonly ['authorId'];
    readonly targetFields: readonly ['id'];
  };
};

type ContractWithAuthor<Nullable extends boolean> = Omit<Contract<SqlStorage>, 'domain'> & {
  readonly domain: {
    readonly namespaces: {
      readonly public: {
        readonly models: {
          readonly User: {
            readonly storage: {
              table: 'user';
              namespaceId: 'public';
              fields: { id: { column: 'id' } };
            };
            readonly fields: { readonly id: Int4Field };
            readonly relations: Record<string, never>;
          };
          readonly Post: {
            readonly storage: {
              table: 'post';
              namespaceId: 'public';
              fields: { id: { column: 'id' }; authorId: { column: 'author_id' } };
            };
            readonly fields: { readonly id: Int4Field; readonly authorId: Int4Field };
            readonly relations: { readonly author: AuthorRelation<Nullable> };
          };
        };
      };
    };
  };
};

type UserRow = { readonly id: number };

test('an explicit nullable: false relation includes a non-null row', () => {
  expectTypeOf<
    IncludeRelationValue<ContractWithAuthor<false>, 'Post', 'author', UserRow>
  >().toEqualTypeOf<UserRow>();
});

test('an explicit nullable: true relation includes row | null', () => {
  expectTypeOf<
    IncludeRelationValue<ContractWithAuthor<true>, 'Post', 'author', UserRow>
  >().toEqualTypeOf<UserRow | null>();
});

test('a relation whose nullable is widened to boolean includes row | null', () => {
  expectTypeOf<
    IncludeRelationValue<ContractWithAuthor<boolean>, 'Post', 'author', UserRow>
  >().toEqualTypeOf<UserRow | null>();
});

type RefinedAuthor<
  Nullable extends boolean,
  State extends CollectionTypeState,
> = IncludeRefinementValue<
  ContractWithAuthor<Nullable>,
  'Post',
  'author',
  UserRow,
  RowSelection<UserRow> & RowWitness<State>
>;

test('a refinement that only projects a required relation includes a non-null row', () => {
  expectTypeOf<RefinedAuthor<false, DefaultCollectionTypeState>>().toEqualTypeOf<UserRow>();
});

test('a refinement that only projects an optional relation includes row | null', () => {
  expectTypeOf<RefinedAuthor<true, DefaultCollectionTypeState>>().toEqualTypeOf<UserRow | null>();
});

test('a refinement with a where includes row | null on a required relation', () => {
  expectTypeOf<
    RefinedAuthor<false, WithWhereState<DefaultCollectionTypeState>>
  >().toEqualTypeOf<UserRow | null>();
});

test('a refinement with a variant includes row | null on a required relation', () => {
  expectTypeOf<
    RefinedAuthor<false, WithVariantState<WithWhereState<DefaultCollectionTypeState>, 'Admin'>>
  >().toEqualTypeOf<UserRow | null>();
});

test('a refinement with paging includes row | null on a required relation', () => {
  expectTypeOf<
    RefinedAuthor<false, WithPagingState<DefaultCollectionTypeState>>
  >().toEqualTypeOf<UserRow | null>();
});

test('a refinement whose state is unknown includes row | null on a required relation', () => {
  expectTypeOf<RefinedAuthor<false, CollectionTypeState>>().toEqualTypeOf<UserRow | null>();
});
