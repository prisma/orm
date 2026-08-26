import type { Contract, NamespaceId, StorageHashBase } from '@internal/contract/types';
import type { ContractWithTypeMaps, SqlStorage, TypeMaps } from '@internal/sql-contract/types';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';

import { createMockRuntime } from './helpers';

type GeneratedLikeCodecTypes = {
  'pg/int8@1': {
    output: bigint;
    traits: 'equality' | 'order' | 'numeric';
  };
  'pg/text@1': {
    output: string;
    traits: 'equality' | 'order' | 'textual';
  };
  'pg/bool@1': {
    output: boolean;
    traits: 'equality' | 'boolean';
  };
  'pg/jsonb@1': {
    output: unknown;
    traits: 'equality';
  };
};

type GeneratedLikeFieldOutputTypes = {
  __unbound__: {
    User: {
      id: string;
      name: string;
      email: string;
      active: boolean;
      metadata: unknown;
    };
    Post: {
      id: string;
      userId: string;
      title: string;
    };
  };
};

/**
 * A stand-in aggregate map, narrowed to the one operation these assertions exercise.
 *
 * It declares `count` through `pg/int8@1` rather than the row the PostgreSQL target contributes,
 * which is the point: the result type below is whatever this map says, and nothing in the client
 * knows what a count "should" be.
 */
type GeneratedLikeAggregateTypes = {
  readonly count: {
    readonly byCodec: Record<string, never>;
    readonly withoutInput: { readonly output: 'pg/int8@1'; readonly nullable: false };
    readonly anyInput: { readonly output: 'pg/int8@1'; readonly nullable: false };
  };
};

type GeneratedLikeTypeMaps = TypeMaps<
  GeneratedLikeCodecTypes,
  Record<string, never>,
  GeneratedLikeFieldOutputTypes,
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  GeneratedLikeAggregateTypes
>;

type GeneratedLikeStorage = {
  storageHash: StorageHashBase<string>;
  namespaces: {
    __unbound__: {
      id: '__unbound__';
      kind: 'schema';
      entries: {
        table: {
          user: {
            columns: {
              id: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
              name: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
              email: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
              active: { nativeType: 'bool'; codecId: 'pg/bool@1'; nullable: false };
              metadata: { nativeType: 'jsonb'; codecId: 'pg/jsonb@1'; nullable: false };
            };
            primaryKey: { columns: ['id'] };
            uniques: [];
            indexes: [];
            foreignKeys: [];
          };
          post: {
            columns: {
              id: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
              userId: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
              title: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
            };
            primaryKey: { columns: ['id'] };
            uniques: [];
            indexes: [];
            foreignKeys: [];
          };
        };
      };
    };
  };
};

type GeneratedLikeModels = {
  User: {
    storage: {
      table: 'user';
      fields: {
        id: { column: 'id' };
        name: { column: 'name' };
        email: { column: 'email' };
        active: { column: 'active' };
        metadata: { column: 'metadata' };
      };
    };
    fields: {
      id: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: false;
      };
      name: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: false;
      };
      email: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: false;
      };
      active: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/bool@1' };
        readonly nullable: false;
      };
      metadata: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/jsonb@1' };
        readonly nullable: false;
      };
    };
    relations: {
      posts: {
        to: { readonly namespace: '__unbound__' & NamespaceId; readonly model: 'Post' };
        cardinality: '1:N';
        on: {
          localFields: readonly ['id'];
          targetFields: readonly ['userId'];
        };
      };
    };
  };
  Post: {
    storage: {
      table: 'post';
      fields: {
        id: { column: 'id' };
        userId: { column: 'userId' };
        title: { column: 'title' };
      };
    };
    fields: {
      id: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: false;
      };
      userId: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: false;
      };
      title: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: false;
      };
    };
    relations: Record<string, never>;
  };
};

type GeneratedLikeContractBase = Omit<Contract<GeneratedLikeStorage>, 'domain' | 'capabilities'> & {
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: { readonly models: GeneratedLikeModels };
    };
  };
  // Only the one capability this file's inference assertions exercise —
  // deliberately minimal, not a stand-in for a real contract's full set.
  readonly capabilities: {
    readonly postgres: { readonly distinctOn: true };
  };
};

type GeneratedLikeContract = ContractWithTypeMaps<GeneratedLikeContractBase, GeneratedLikeTypeMaps>;

class PostCollection extends Collection<GeneratedLikeContract, 'Post'> {
  forUser(userId: string) {
    return this.where((post) => post.userId.eq(userId));
  }
}

type RowOf<TCollection> =
  TCollection extends Collection<
    infer _Contract extends Contract<SqlStorage>,
    infer _ModelName extends string,
    infer Row,
    infer _State
  >
    ? Row
    : never;

type StateOf<TCollection> =
  TCollection extends Collection<
    infer _Contract extends Contract<SqlStorage>,
    infer _ModelName extends string,
    infer _Row,
    infer State
  >
    ? State
    : never;

const runtime = createMockRuntime();
const context = {} as unknown as ExecutionContext<GeneratedLikeContract>;
const collection = new PostCollection({ runtime, context }, 'Post', { namespaceId: 'public' });
collection.forUser('user_001');

const userCollection = new Collection({ runtime, context }, 'User', { namespaceId: 'public' });
const postCollection = new Collection({ runtime, context }, 'Post', { namespaceId: 'public' });

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Assert<T extends true> = T;

const selectedUsers = userCollection.select('name', 'email');
const selectedUsersWithPosts = userCollection.select('name').include('posts');
const usersWithPostCount = userCollection.include('posts', (posts) => posts.count());
const usersWithPostSummary = userCollection.include('posts', (posts) =>
  posts.combine({
    allPosts: posts.orderBy((post) => post.id.asc()),
    totalCount: posts.count(),
  }),
);
const filteredUsers = userCollection.where({ email: 'alice@example.com' });
const orderedUsers = userCollection.orderBy((user) => user.id.asc());
const cursorPagedUsers = orderedUsers.cursor({ id: 'user_001' });
const distinctUsers = userCollection.distinct('email');
const distinctOnUsers = orderedUsers.distinctOn('email');
const groupedUsers = userCollection.groupBy('email');
const groupedUserStats = groupedUsers.aggregate((aggregate) => ({
  count: aggregate.count(),
}));
groupedUsers.having((having) => having.count().gt(1));
// @ts-expect-error GroupedCollection does not expose all()
groupedUsers.all();
// @ts-expect-error GroupedCollection does not expose include()
groupedUsers.include('posts');
userCollection.include('posts', (posts) => {
  // @ts-expect-error include refinement collection does not expose create()
  posts.create({} as never);
  return posts;
});
const userAggregate = userCollection.aggregate((aggregate) => ({
  count: aggregate.count(),
}));
postCollection.aggregate((aggregate) => ({
  // @ts-expect-error sum() is restricted to numeric fields only
  total: aggregate.sum('title'),
}));
userCollection.create({
  id: 'user_001',
  name: 'Alice',
  email: 'alice@example.com',
  active: true,
  metadata: {},
  posts: (posts) =>
    posts.create([
      {
        id: 'post_001',
        title: 'Nested',
      },
    ]),
});
// @ts-expect-error missing required create fields without relation mutations
userCollection.create({ id: 'user_only_id' });
// @ts-expect-error Post has no relation callbacks to satisfy required userId in create()
postCollection.create({ id: 'post_missing_user', title: 'Missing owner' });
const createNestedPosts: NonNullable<
  import('../src/types').CreateInput<GeneratedLikeContract, 'User'>['posts']
> = (posts) => posts.create([{ id: 'post_001', title: 'Nested' }]);
userCollection.upsert({
  create: { id: 'user_001', name: 'Alice', email: 'alice@example.com', active: true, metadata: {} },
  update: { name: 'Alice Updated' },
  conflictOn: { id: 'user_001' },
});
userCollection.upsert({
  create: { id: 'user_001', name: 'Alice', email: 'alice@example.com', active: true, metadata: {} },
  update: { name: 'Alice Updated' },
});
userCollection.upsert({
  create: {
    id: 'user_001',
    name: 'Alice',
    email: 'alice@example.com',
    active: true,
    metadata: {},
    // @ts-expect-error upsert create does not support relation callbacks
    posts: createNestedPosts,
  },
  update: { name: 'Alice Updated' },
});
userCollection.upsert({
  create: { id: 'user_001', name: 'Alice', email: 'alice@example.com', active: true, metadata: {} },
  update: { name: 'Alice Updated' },
  // @ts-expect-error invalid conflict key for upsert()
  conflictOn: { unknown: 'value' },
});
const updatableUsers = userCollection.where({ email: 'alice@example.com' });
updatableUsers.update({ name: 'Alice' });
updatableUsers.updateAll({ name: 'Alice' });
updatableUsers.updateAndCount({ name: 'Alice' });
const deletableUsers = userCollection.where({ email: 'alice@example.com' });
deletableUsers.delete();
deletableUsers.deleteAll();
deletableUsers.deleteAndCount();
// @ts-expect-error cursor() requires orderBy() first
userCollection.cursor({ id: 'user_001' });
// @ts-expect-error distinctOn() requires orderBy() first
userCollection.distinctOn('email');
// @ts-expect-error update() requires where() first
userCollection.update({ name: 'Alice' });
// @ts-expect-error updateAll() requires where() first
userCollection.updateAll({ name: 'Alice' });
// @ts-expect-error updateAndCount() requires where() first
userCollection.updateAndCount({ name: 'Alice' });
// @ts-expect-error delete() requires where() first
userCollection.delete();
// @ts-expect-error deleteAll() requires where() first
userCollection.deleteAll();
// @ts-expect-error deleteAndCount() requires where() first
userCollection.deleteAndCount();

type SelectedUserRow = RowOf<typeof selectedUsers>;
type SelectedUserWithPostsRow = RowOf<typeof selectedUsersWithPosts>;
type UsersWithPostCountRow = RowOf<typeof usersWithPostCount>;
type UsersWithPostSummaryRow = RowOf<typeof usersWithPostSummary>;
type FilteredUsersState = StateOf<typeof filteredUsers>;
type OrderedUsersState = StateOf<typeof orderedUsers>;
type CursorPagedUsersState = StateOf<typeof cursorPagedUsers>;
type DistinctUsersState = StateOf<typeof distinctUsers>;
type DistinctOnUsersState = StateOf<typeof distinctOnUsers>;
type UserAggregateResult = Awaited<typeof userAggregate>;
type GroupedUserStatsResult = Awaited<typeof groupedUserStats>;
type GroupedUserStatsRow = GroupedUserStatsResult[number];

export type GeneratedContractTypeAssertions = [
  Assert<Equal<keyof SelectedUserRow, 'name' | 'email'>>,
  Assert<Equal<SelectedUserRow['name'], string>>,
  Assert<Equal<SelectedUserRow['email'], string>>,
  Assert<Equal<keyof SelectedUserWithPostsRow, 'name' | 'posts'>>,
  Assert<Equal<SelectedUserWithPostsRow['name'], string>>,
  Assert<Equal<keyof SelectedUserWithPostsRow['posts'][number], 'id' | 'userId' | 'title'>>,
  Assert<Equal<SelectedUserWithPostsRow['posts'][number]['id'], string>>,
  Assert<Equal<SelectedUserWithPostsRow['posts'][number]['userId'], string>>,
  Assert<Equal<SelectedUserWithPostsRow['posts'][number]['title'], string>>,
  Assert<Equal<UsersWithPostCountRow['posts'], bigint>>,
  Assert<Equal<keyof UsersWithPostSummaryRow['posts'], 'allPosts' | 'totalCount'>>,
  Assert<Equal<UsersWithPostSummaryRow['posts']['totalCount'], bigint>>,
  Assert<
    Equal<keyof UsersWithPostSummaryRow['posts']['allPosts'][number], 'id' | 'userId' | 'title'>
  >,
  Assert<Equal<FilteredUsersState['hasWhere'], true>>,
  Assert<Equal<OrderedUsersState['hasOrderBy'], true>>,
  Assert<Equal<CursorPagedUsersState['hasOrderBy'], true>>,
  Assert<Equal<DistinctUsersState['hasOrderBy'], false>>,
  Assert<Equal<DistinctOnUsersState['hasOrderBy'], true>>,
  // `count` types as the contract's aggregate map declares it — this map names
  // `pg/int8@1`, whose application value is a bigint.
  Assert<Equal<UserAggregateResult, { count: bigint }>>,
  Assert<Equal<keyof GroupedUserStatsRow, 'email' | 'count'>>,
  Assert<Equal<GroupedUserStatsRow['email'], string>>,
  Assert<Equal<GroupedUserStatsRow['count'], bigint>>,
];

// ---------------------------------------------------------------------------
// Trait-gating: negative type tests
// ---------------------------------------------------------------------------
// text (equality + order + textual): eq, gt, like, asc all work
userCollection.where((u) => u.name.eq('x'));
userCollection.where((u) => u.name.gt('a'));
userCollection.where((u) => u.name.like('%x'));
userCollection.orderBy((u) => u.name.asc());
userCollection.where((u) => u.name.isNull());

// bool (equality + boolean): eq works, gt/like/asc do not
userCollection.where((u) => u.active.eq(true));
userCollection.where((u) => u.active.neq(false));
userCollection.where((u) => u.active.isNull());
// @ts-expect-error bool has no order trait → gt not available
userCollection.where((u) => u.active.gt(true));
// @ts-expect-error bool has no order trait → lt not available
userCollection.where((u) => u.active.lt(false));
// @ts-expect-error bool has no textual trait → like not available
userCollection.where((u) => u.active.like('%'));
// @ts-expect-error bool has no order trait → asc not available
userCollection.orderBy((u) => u.active.asc());
// @ts-expect-error bool has no order trait → desc not available
userCollection.orderBy((u) => u.active.desc());

// jsonb (equality only): eq works, gt/like/asc do not
userCollection.where((u) => u.metadata.eq({} as unknown));
userCollection.where((u) => u.metadata.in([{} as unknown]));
userCollection.where((u) => u.metadata.isNotNull());
// @ts-expect-error jsonb has no order trait → gt not available
userCollection.where((u) => u.metadata.gt(1));
// @ts-expect-error jsonb has no order trait → gte not available
userCollection.where((u) => u.metadata.gte(1));
// @ts-expect-error jsonb has no textual trait → like not available
userCollection.where((u) => u.metadata.like('%'));
// @ts-expect-error jsonb has no textual trait → ilike extension op not available
userCollection.where((u) => u.metadata.ilike('%'));
// @ts-expect-error jsonb has no order trait → asc not available
userCollection.orderBy((u) => u.metadata.asc());

// ---------------------------------------------------------------------------
// Value object fields: row type resolves to expanded nested structure
// ---------------------------------------------------------------------------

type VOCodecTypes = {
  'pg/int4@1': {
    output: number;
    traits: 'equality' | 'order' | 'numeric';
  };
  'pg/text@1': {
    output: string;
    traits: 'equality' | 'order' | 'textual';
  };
  'pg/jsonb@1': {
    output: unknown;
    traits: 'equality';
  };
};

type ExpectedAddressShape = { street: string; city: string; zip: string };

type VOFieldOutputTypes = {
  __unbound__: {
    User: {
      id: number;
      name: string;
      homeAddress: ExpectedAddressShape | null;
      workAddress: ExpectedAddressShape;
    };
  };
};

type VOTypeMaps = TypeMaps<VOCodecTypes, Record<string, never>, VOFieldOutputTypes>;

type VOContractBase = Omit<
  Contract<{
    storageHash: StorageHashBase<string>;
    namespaces: {
      __unbound__: {
        id: '__unbound__';
        kind: 'schema';
        entries: {
          table: {
            users: {
              columns: {
                id: { nativeType: 'int4'; codecId: 'pg/int4@1'; nullable: false };
                name: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
                home_address: { nativeType: 'jsonb'; codecId: 'pg/jsonb@1'; nullable: true };
                work_address: { nativeType: 'jsonb'; codecId: 'pg/jsonb@1'; nullable: false };
              };
              primaryKey: { columns: ['id'] };
              uniques: [];
              indexes: [];
              foreignKeys: [];
            };
          };
        };
      };
    };
  }>,
  'domain'
> & {
  readonly target: 'postgres';
  readonly roots: {
    readonly users: { readonly namespace: '__unbound__' & NamespaceId; readonly model: 'User' };
  };
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: {
        readonly models: {
          readonly User: {
            readonly storage: {
              readonly table: 'users';
              readonly fields: {
                readonly id: { readonly column: 'id' };
                readonly name: { readonly column: 'name' };
                readonly homeAddress: { readonly column: 'home_address' };
                readonly workAddress: { readonly column: 'work_address' };
              };
            };
            readonly fields: {
              readonly id: {
                readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
                readonly nullable: false;
              };
              readonly name: {
                readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
                readonly nullable: false;
              };
              readonly homeAddress: {
                readonly type: { readonly kind: 'valueObject'; readonly name: 'Address' };
                readonly nullable: true;
              };
              readonly workAddress: {
                readonly type: { readonly kind: 'valueObject'; readonly name: 'Address' };
                readonly nullable: false;
              };
            };
            readonly relations: Record<string, never>;
          };
        };
        readonly valueObjects: {
          readonly Address: {
            readonly fields: {
              readonly street: {
                readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
                readonly nullable: false;
              };
              readonly city: {
                readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
                readonly nullable: false;
              };
              readonly zip: {
                readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
                readonly nullable: false;
              };
            };
          };
        };
      };
    };
  };
  readonly capabilities: Record<string, never>;
  readonly extensions: Record<string, never>;
  readonly profileHash: string;
};

type VOContract = ContractWithTypeMaps<VOContractBase, VOTypeMaps>;

type VOUserRow = import('../src/types').DefaultModelRow<VOContract, 'User'>;
type VOCreateInput = import('../src/types').CreateInput<VOContract, 'User'>;
type VOUpdateInput = import('../src/types').MutationUpdateInput<VOContract, 'User'>;

export type ValueObjectTypeAssertions = [
  Assert<Equal<VOUserRow['id'], number>>,
  Assert<Equal<VOUserRow['name'], string>>,
  Assert<Equal<VOUserRow['homeAddress'], ExpectedAddressShape | null>>,
  Assert<Equal<VOUserRow['workAddress'], ExpectedAddressShape>>,
];

export type ValueObjectCreateInputAssertions = [
  Assert<Equal<VOCreateInput['homeAddress'], ExpectedAddressShape | null | undefined>>,
  Assert<Equal<VOCreateInput['workAddress'], ExpectedAddressShape>>,
];

export type ValueObjectUpdateInputAssertions = [
  Assert<Equal<VOUpdateInput['homeAddress'], ExpectedAddressShape | null | undefined>>,
  Assert<Equal<VOUpdateInput['workAddress'], ExpectedAddressShape | undefined>>,
];

type GeneratedTypeAssertions = [
  ...GeneratedContractTypeAssertions,
  ...ValueObjectTypeAssertions,
  ...ValueObjectCreateInputAssertions,
  ...ValueObjectUpdateInputAssertions,
];

test('generated contract type assertions compile', () => {
  expectTypeOf<GeneratedTypeAssertions>().toMatchTypeOf<readonly true[]>();
});
