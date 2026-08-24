import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import { createMockRuntime, type TestContract } from './helpers';

type RowOf<TCollection> =
  TCollection extends Collection<
    infer _Contract extends Contract<SqlStorage>,
    infer _ModelName extends string,
    infer Row,
    infer _State
  >
    ? Row
    : never;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Assert<T extends true> = T;

const runtime = createMockRuntime();
const context = {} as ExecutionContext<TestContract>;

const userCollection = new Collection({ runtime, context }, 'User', { namespaceId: 'public' });
const postCollection = new Collection({ runtime, context }, 'Post', { namespaceId: 'public' });
const profileCollection = new Collection({ runtime, context }, 'Profile', {
  namespaceId: 'public',
});
const articleCollection = new Collection({ runtime, context }, 'Article', {
  namespaceId: 'public',
});

const usersWithPosts = userCollection.include('posts');
const usersWithProfile = userCollection.include('profile');
const usersWithInvitedBy = userCollection.include('invitedBy');
const postsWithAuthor = postCollection.include('author');
const profilesWithUser = profileCollection.include('user');
const articlesWithReviewer = articleCollection.include('reviewer');
const usersWithPostCount = userCollection.include('posts', (posts) => posts.count());
const usersWithSelectedPosts = userCollection.include('posts', (posts) => posts.select('title'));

userCollection.include('posts', (posts) => {
  // @ts-expect-error include refinement collection does not expose all()
  posts.all();
  // @ts-expect-error include refinement collection does not expose first()
  posts.first();
  // @ts-expect-error include refinement collection does not expose create()
  posts.create({} as never);
  // @ts-expect-error include refinement collection does not expose update()
  posts.update({} as never);
  return posts.limit(1);
});

postCollection.include('author', (author) => {
  // @ts-expect-error to-one include refinements do not expose scalar selectors
  author.count();
  return author;
});

type UsersWithPostsRow = RowOf<typeof usersWithPosts>;
type UsersWithProfileRow = RowOf<typeof usersWithProfile>;
type UsersWithInvitedByRow = RowOf<typeof usersWithInvitedBy>;
type PostsWithAuthorRow = RowOf<typeof postsWithAuthor>;
type ProfilesWithUserRow = RowOf<typeof profilesWithUser>;
type ArticlesWithReviewerRow = RowOf<typeof articlesWithReviewer>;
type UsersWithPostCountRow = RowOf<typeof usersWithPostCount>;
type UsersWithSelectedPostsRow = RowOf<typeof usersWithSelectedPosts>;

export type IncludeCardinalityTypeAssertions = [
  Assert<Equal<UsersWithPostsRow['posts'], Array<RowOf<Collection<TestContract, 'Post'>>>>>,
  // An include count reads through the target's count codec, like any other
  // aggregate — PostgreSQL counts as `pg/int8number@1`, whose value is a
  // number.
  Assert<Equal<UsersWithPostCountRow['posts'], number>>,
  Assert<Equal<keyof UsersWithSelectedPostsRow['posts'][number], 'title'>>,
  // 1:1 non-FK side (parentCols = PK) → nullable
  Assert<Equal<Extract<UsersWithProfileRow['profile'], null>, null>>,
  Assert<
    Equal<
      Exclude<UsersWithProfileRow['profile'], null> extends readonly unknown[] ? true : false,
      false
    >
  >,
  Assert<Equal<keyof NonNullable<UsersWithProfileRow['profile']>, 'id' | 'userId' | 'bio'>>,
  // 1:1 FK side with non-nullable FK → not nullable
  Assert<Equal<Extract<ProfilesWithUserRow['user'], null>, never>>,
  Assert<Equal<ProfilesWithUserRow['user'] extends readonly unknown[] ? true : false, false>>,
  Assert<
    Equal<keyof ProfilesWithUserRow['user'], 'id' | 'name' | 'email' | 'invitedById' | 'address'>
  >,
  // N:1 with non-nullable FK → not nullable
  Assert<Equal<Extract<PostsWithAuthorRow['author'], null>, never>>,
  Assert<Equal<PostsWithAuthorRow['author'] extends readonly unknown[] ? true : false, false>>,
  Assert<
    Equal<keyof PostsWithAuthorRow['author'], 'id' | 'name' | 'email' | 'invitedById' | 'address'>
  >,
  // N:1 with nullable FK → nullable
  Assert<Equal<Extract<UsersWithInvitedByRow['invitedBy'], null>, null>>,
  Assert<
    Equal<
      keyof NonNullable<UsersWithInvitedByRow['invitedBy']>,
      'id' | 'name' | 'email' | 'invitedById' | 'address'
    >
  >,
  // N:1 with non-nullable column but no FK constraint → nullable
  Assert<Equal<Extract<ArticlesWithReviewerRow['reviewer'], null>, null>>,
  Assert<
    Equal<ArticlesWithReviewerRow['reviewer'] extends readonly unknown[] ? true : false, false>
  >,
  Assert<
    Equal<
      keyof NonNullable<ArticlesWithReviewerRow['reviewer']>,
      'id' | 'name' | 'email' | 'invitedById' | 'address'
    >
  >,
];

test('include cardinality type assertions compile', () => {
  expectTypeOf<IncludeCardinalityTypeAssertions>().toMatchTypeOf<readonly true[]>();
});
