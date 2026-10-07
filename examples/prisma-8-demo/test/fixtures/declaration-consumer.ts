import type {
  AggregateResult,
  AggregateSelector,
  CodecField,
  CodecListField,
  Collection,
  CollectionRowOf,
  DeclaredField,
  FieldScope,
  Filtered,
  Ordered,
} from '@prisma/orm-postgres/orm-client';
import { expectTypeOf } from 'vitest';
import type { Contract } from '../../src/prisma/contract.d';
import {
  filteredChain,
  filterPosts,
  firstPage,
  type GenericLibrary,
  labelled,
  labelledAs,
  notExpired,
  type PostLibrary,
  type PrivateLibrary,
  plainChain,
  type SubLibrary,
  type TaskLibrary,
  titleSummary,
  unexpired,
  unexpiredPosts,
} from './declaration-library';

type PostKey =
  | 'createdAt'
  | 'embedding'
  | 'expiresAt'
  | 'id'
  | 'impressionCount'
  | 'priority'
  | 'reachScore'
  | 'title'
  | 'userId'
  | 'viewCount';

type UserKey = 'address' | 'createdAt' | 'displayName' | 'email' | 'id' | 'kind';

type PostRow = CollectionRowOf<Collection<Contract, 'Post'>>;
type UserRow = CollectionRowOf<Collection<Contract, 'User'>>;

declare const posts: PostLibrary;
declare const tasks: TaskLibrary;
declare const genericPosts: GenericLibrary<'Post'>;
declare const users: PrivateLibrary;
declare const subPosts: SubLibrary;

export async function chainingMethods() {
  expectTypeOf(posts.filtered()).toEqualTypeOf<Filtered<PostLibrary>>();
  expectTypeOf(posts.ordered()).toEqualTypeOf<Ordered<PostLibrary>>();
  expectTypeOf(posts.paged()).toEqualTypeOf<PostLibrary>();
  expectTypeOf(posts.distinctTitles()).toEqualTypeOf<PostLibrary>();
  expectTypeOf(posts.distinctOnTitle()).toEqualTypeOf<Ordered<PostLibrary>>();
  expectTypeOf(posts.after('p1')).toEqualTypeOf<Ordered<PostLibrary>>();
  expectTypeOf(posts.applied()).toEqualTypeOf<Filtered<Ordered<PostLibrary>>>();
  expectTypeOf(posts.filteredAndOrdered()).toEqualTypeOf<Filtered<Ordered<PostLibrary>>>();
  expectTypeOf<keyof CollectionRowOf<ReturnType<PostLibrary['titles']>>>().toEqualTypeOf<
    'id' | 'title'
  >();
  expectTypeOf<keyof CollectionRowOf<ReturnType<PostLibrary['withUser']>>>().toEqualTypeOf<
    PostKey | 'user'
  >();
}

export async function rowReturningMethods() {
  expectTypeOf(await posts.allRows().toArray()).toEqualTypeOf<PostRow[]>();
  expectTypeOf(await posts.firstRow()).toEqualTypeOf<PostRow | null>();
  expectTypeOf(await posts.firstMatching('x')).toEqualTypeOf<PostRow | null>();
  expectTypeOf(await posts.createRow()).toEqualTypeOf<PostRow>();
  expectTypeOf(await posts.createRows().toArray()).toEqualTypeOf<PostRow[]>();
  expectTypeOf(await posts.createCount()).toEqualTypeOf<number>();
  expectTypeOf(await posts.upsertRow()).toEqualTypeOf<PostRow>();
  expectTypeOf(await posts.updateRow()).toEqualTypeOf<PostRow | null>();
  expectTypeOf(await posts.updateRows().toArray()).toEqualTypeOf<PostRow[]>();
  expectTypeOf(await posts.updateCount()).toEqualTypeOf<number>();
  expectTypeOf(await posts.deleteRow()).toEqualTypeOf<PostRow | null>();
  expectTypeOf(await posts.deleteRows().toArray()).toEqualTypeOf<PostRow[]>();
  expectTypeOf(await posts.deleteCount()).toEqualTypeOf<number>();
  expectTypeOf(
    await posts.preparedRows().first().consume,
  ).returns.resolves.toEqualTypeOf<PostRow | null>();
}

export async function includedRows() {
  const withUser = await posts.firstWithUser();
  expectTypeOf(withUser).not.toBeAny();
  expectTypeOf<keyof NonNullable<typeof withUser>>().toEqualTypeOf<PostKey | 'user'>();
  expectTypeOf<keyof NonNullable<typeof withUser>['user']>().toEqualTypeOf<UserKey>();
  expectTypeOf(withUser!.user.email).toEqualTypeOf<string>();

  const withUserEmail = await posts.firstWithUserEmail();
  expectTypeOf(withUserEmail!.user).toEqualTypeOf<{ id: string; email: string } | null>();

  const withTagCount = await posts.firstWithTagCount();
  expectTypeOf(withTagCount!.tags).toEqualTypeOf<number>();

  const withTagSummary = await posts.firstWithTagSummary();
  expectTypeOf(withTagSummary!.tags).toEqualTypeOf<{
    total: number;
    first: { id: string; label: string }[];
  }>();
}

export async function aggregates() {
  expectTypeOf(await posts.countsByUser()).toEqualTypeOf<{ userId: string; posts: number }[]>();
  expectTypeOf(await posts.totals()).toEqualTypeOf<
    AggregateResult<{ posts: AggregateSelector<number> }>
  >();
  expectTypeOf((await posts.totals()).posts).toEqualTypeOf<number>();
}

export async function otherClasses() {
  const bug = (await tasks.bugRows().toArray())[0];
  expectTypeOf(bug!.type).toEqualTypeOf<'bug'>();
  expectTypeOf(bug!.severity).toEqualTypeOf<string>();
  expectTypeOf(await genericPosts.firstRow()).toEqualTypeOf<PostRow | null>();
  expectTypeOf<
    keyof NonNullable<Awaited<ReturnType<PrivateLibrary['firstPage']>>>
  >().not.toBeNever();
  expectTypeOf(users.label()).toEqualTypeOf<string>();
  expectTypeOf(await subPosts.newest()).toEqualTypeOf<PostRow | null>();
}

export function exportedValues() {
  expectTypeOf(filteredChain).not.toBeAny();
  expectTypeOf<keyof CollectionRowOf<typeof filteredChain>>().toEqualTypeOf<PostKey | 'user'>();
  expectTypeOf(plainChain).not.toBeAny();
  expectTypeOf<keyof CollectionRowOf<typeof plainChain>>().toEqualTypeOf<PostKey>();
  expectTypeOf(filterPosts).returns.toEqualTypeOf<Filtered<Collection<Contract, 'Post'>>>();
}

export function queryFragments(now: Temporal.Instant) {
  expectTypeOf(posts.live(now)).toEqualTypeOf<Filtered<PostLibrary>>();
  expectTypeOf(posts.orderedBy('title')).toEqualTypeOf<Ordered<PostLibrary>>();
  expectTypeOf(notExpired(now)).toEqualTypeOf<
    (row: {
      expiresAt: CodecField<Contract, 'pg/timestamptz-temporal@1'>;
    }) => ReturnType<ReturnType<typeof notExpired>>
  >();
  type Summary = ReturnType<typeof titleSummary>;
  expectTypeOf(posts.summaries()).toEqualTypeOf<Summary>();
  expectTypeOf(posts.with(titleSummary)).toEqualTypeOf<Summary>();
  // @ts-expect-error the rows no longer have every Post field
  posts.select('id').with(titleSummary);
  expectTypeOf(posts.unexpired(now)).toEqualTypeOf<Ordered<Filtered<PostLibrary>>>();
  expectTypeOf(posts.with(unexpired(now))).toEqualTypeOf<Ordered<Filtered<PostLibrary>>>();
  // @ts-expect-error User has no expiresAt field
  users.with(unexpired(now));
  expectTypeOf(posts.with(firstPage)).toEqualTypeOf<PostLibrary>();
  // @ts-expect-error firstPage applied no filter, so delete is refused
  posts.with(firstPage).deleteAll();
  expectTypeOf(unexpiredPosts(now)).not.toBeAny();
  unexpiredPosts(now).cursor({ id: 'x' });
  unexpiredPosts(now).deleteAll();
  expectTypeOf<keyof CollectionRowOf<ReturnType<typeof unexpiredPosts>>>().toEqualTypeOf<PostKey>();
  expectTypeOf<CollectionRowOf<Summary>>().toEqualTypeOf<{
    id: string;
    title: string;
    user: UserRow;
  }>();
}

export function listFragments() {
  expectTypeOf(labelledAs(['a'])).toEqualTypeOf<
    (row: {
      labels: CodecListField<Contract, 'pg/text@1'>;
    }) => ReturnType<ReturnType<typeof labelledAs>>
  >();
  // @ts-expect-error Post has no labels field
  posts.where(labelledAs(['a']));
  expectTypeOf(labelled(['a'])).toEqualTypeOf<
    FieldScope<
      Contract,
      {
        readonly labels: DeclaredField<'pg/text@1', false, { readonly elementNullable: false }>;
      },
      { readonly hasWhere: true; readonly hasOrderBy: boolean }
    >
  >();
  // @ts-expect-error Post has no list field labels
  posts.with(labelled(['a']));
}
