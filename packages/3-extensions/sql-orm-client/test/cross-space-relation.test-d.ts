/**
 * Option B non-navigable cross-space relation: negative type test
 *
 * Verifies that:
 * 1. A local relation can be used with `include('relName')` (positive case)
 * 2. A cross-space relation emitted as `never` cannot be used with `include('relName')`
 *    — `include` of it is a compile error (the crux of Option B)
 */
import type { Contract, NamespaceId } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type { RelationNames } from '../src/types';
import { createMockRuntime } from './helpers';

// ---------------------------------------------------------------------------
// Synthetic contract with one local relation ('posts') and one cross-space
// relation ('user' as `never` — the Option B emitter output).
// ---------------------------------------------------------------------------

type CrossSpaceModels = {
  Profile: {
    storage: {
      table: 'profile';
      namespaceId: 'public';
      fields: {
        id: { column: 'id' };
        userId: { column: 'user_id' };
      };
    };
    fields: {
      id: {
        readonly many: false;
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
        readonly nullable: false;
      };
      userId: {
        readonly many: false;
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
        readonly nullable: false;
      };
    };
    relations: {
      // Local relation — navigable, should appear in RelationNames
      posts: {
        to: { readonly namespace: 'public' & NamespaceId; readonly model: 'Post' };
        cardinality: '1:N';
        on: { localFields: readonly ['id']; targetFields: readonly ['profileId'] };
      };
      // Cross-space relation — non-navigable (Option B emitter output: `never`)
      user: never;
    };
  };
  Post: {
    storage: {
      table: 'post';
      namespaceId: 'public';
      fields: {
        id: { column: 'id' };
        profileId: { column: 'profile_id' };
      };
    };
    fields: {
      id: {
        readonly many: false;
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
        readonly nullable: false;
      };
      profileId: {
        readonly many: false;
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
        readonly nullable: false;
      };
    };
    relations: Record<string, never>;
  };
};

type CrossSpaceTestContract = Omit<Contract<SqlStorage>, 'domain'> & {
  readonly domain: {
    readonly namespaces: {
      readonly public: { readonly models: CrossSpaceModels };
    };
  };
};

// ---------------------------------------------------------------------------
// Type-level assertions
// ---------------------------------------------------------------------------

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export type RelationNamesTypeAssertions = [
  // 'posts' (local relation) IS in RelationNames — navigable
  Assert<Equal<RelationNames<CrossSpaceTestContract, 'Profile'>, 'posts'>>,
  // 'user' (cross-space, `never`) is NOT in RelationNames — non-navigable
  Assert<
    Equal<'user' extends RelationNames<CrossSpaceTestContract, 'Profile'> ? true : false, false>
  >,
];

// ---------------------------------------------------------------------------
// Runtime-level: `include('posts')` works; `include('user')` is a compile error
// ---------------------------------------------------------------------------

const runtime = createMockRuntime();

// Widen to a Collection type that uses the synthetic contract — use
// `as unknown as` only to satisfy the constructor's runtime requirements;
// the TYPE is what we are testing.
const profileCollection = new Collection({ runtime, context: {} as never }, 'Profile', {
  namespaceId: 'public',
}) as unknown as Collection<CrossSpaceTestContract, 'Profile'>;

// Positive: a local relation can be included — must compile
void profileCollection.include('posts');

// Negative: a cross-space (non-navigable) relation must NOT compile.
// @ts-expect-error — 'user' is a cross-space relation (emitted as `never`) and must not be navigable via include
profileCollection.include('user');

test('cross-space relation type assertions compile', () => {
  expectTypeOf<RelationNamesTypeAssertions>().toMatchTypeOf<readonly true[]>();
});
