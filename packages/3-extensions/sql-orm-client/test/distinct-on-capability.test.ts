import { soleDomainNamespaceId } from '@internal/contract/types';
import { ColumnRef, OrderByItem } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import { baseContract, createCollectionFor } from './collection-fixtures';
import { createMockRuntime, emptyTableState, getTestContext, withCapabilities } from './helpers';

// Mirrors the sql-builder lane's proof shape for the identical gate
// (`test/e2e/framework/test/sqlite/sql-builder.test.ts:345-352`): a
// contract without `postgres.distinctOn` makes the call a compile error
// (asserted with `@ts-expect-error`) and, if reached dynamically, a runtime
// error carrying `ORM.CAPABILITY_MISSING`.
describe('distinctOn() capability gate', () => {
  it('compiles and behaves unchanged when the contract declares postgres.distinctOn', () => {
    const { collection } = createCollectionFor('Post');
    const gated = collection.orderBy((post) => post.title.asc()).distinctOn('title');

    expect(gated).toBeInstanceOf(Collection);
  });

  it('is gated out at compile time and throws ORM.CAPABILITY_MISSING at runtime without postgres.distinctOn', () => {
    const contract = withCapabilities(baseContract, { sql: { defaultInInsert: true } });
    const context = { ...getTestContext(), contract };
    const runtime = createMockRuntime();
    const collection = new Collection({ runtime, context }, 'Post', {
      namespaceId: soleDomainNamespaceId(contract.domain),
    });

    const ordered = collection.orderBy((post) => post.title.asc());
    // @ts-expect-error distinctOn is gated out without postgres.distinctOn
    expect(() => ordered.distinctOn('title')).toThrow(
      'distinctOn() requires capability postgres.distinctOn',
    );
  });

  // A generic capability scan across every group would pass this: the
  // contract does declare a truthy `distinctOn`, just under `projection`
  // instead of `postgres`. The gate has to check the `postgres` group
  // specifically, matching the type-level narrowing on
  // `{ postgres: { distinctOn: true } }`.
  it('rejects a contract that declares distinctOn under a group other than postgres', () => {
    const contract = withCapabilities(baseContract, { projection: { distinctOn: true } });
    const context = { ...getTestContext(), contract };
    const runtime = createMockRuntime();
    const collection = new Collection({ runtime, context }, 'Post', {
      namespaceId: soleDomainNamespaceId(contract.domain),
      state: {
        ...emptyTableState(contract, 'posts'),
        orderBy: [OrderByItem.asc(ColumnRef.of('posts', 'title'))],
        distinctOn: ['title'],
      },
    });

    expect(() => collection.all()).toThrow('distinctOn() requires capability postgres.distinctOn');
  });

  // The method-level assert is one entry point into `state.distinctOn` — a
  // `Collection` built directly from a hand-constructed `CollectionState`
  // (both exported from `./exports`) never calls `distinctOn()`, so the
  // capability has to be enforced again where the state is actually
  // consumed and lowered to `withDistinctOn`.
  it('throws when a hand-built state carries distinctOn on a contract without postgres.distinctOn', () => {
    const contract = withCapabilities(baseContract, { sql: { defaultInInsert: true } });
    const context = { ...getTestContext(), contract };
    const runtime = createMockRuntime();
    const collection = new Collection({ runtime, context }, 'Post', {
      namespaceId: soleDomainNamespaceId(contract.domain),
      state: {
        ...emptyTableState(contract, 'posts'),
        orderBy: [OrderByItem.asc(ColumnRef.of('posts', 'title'))],
        distinctOn: ['title'],
      },
    });

    expect(() => collection.all()).toThrow('distinctOn() requires capability postgres.distinctOn');
  });

  // `dispatchCollectionRows` routes to `compileSelect` only when
  // `state.includes` is empty; any include routes to
  // `compileSelectWithIncludes` instead — a different function, with its own
  // path into `state.distinctOn` via the shared `buildSelectAst` helper.
  it('throws when a root state carrying distinctOn also carries an include', async () => {
    const contract = withCapabilities(baseContract, { sql: { defaultInInsert: true } });
    const context = { ...getTestContext(), contract };
    const runtime = createMockRuntime();
    const userCollection = new Collection({ runtime, context }, 'User', {
      namespaceId: soleDomainNamespaceId(contract.domain),
      state: {
        ...emptyTableState(contract, 'users'),
        orderBy: [OrderByItem.asc(ColumnRef.of('users', 'name'))],
        distinctOn: ['name'],
      },
    });

    const withPosts = userCollection.include('posts', (posts) => posts.select('id'));

    // `compileSelectWithIncludes` runs inside an async generator, so the
    // capability error surfaces on iteration, not on `.all()` itself.
    await expect(withPosts.all().toArray()).rejects.toThrow(
      'distinctOn() requires capability postgres.distinctOn',
    );
  });

  // `include()` accepts whatever the refinement callback returns as long as
  // it carries a `.state` (`isCollectionStateCarrier`) — with no identity
  // check against the collection the callback was actually handed. A
  // refinement can return an unrelated, hand-built collection whose own
  // state carries `distinctOn`.
  it('throws when an include() refinement returns an unrelated collection whose state carries distinctOn', async () => {
    const contract = withCapabilities(baseContract, { sql: { defaultInInsert: true } });
    const context = { ...getTestContext(), contract };
    const runtime = createMockRuntime();
    const unrelated = new Collection({ runtime, context }, 'Post', {
      namespaceId: soleDomainNamespaceId(contract.domain),
      state: {
        ...emptyTableState(contract, 'posts'),
        orderBy: [OrderByItem.asc(ColumnRef.of('posts', 'title'))],
        distinctOn: ['title'],
      },
    });
    const userCollection = new Collection({ runtime, context }, 'User', {
      namespaceId: soleDomainNamespaceId(contract.domain),
    });

    const withPosts = userCollection.include('posts', () => unrelated);

    await expect(withPosts.all().toArray()).rejects.toThrow(
      'distinctOn() requires capability postgres.distinctOn',
    );
  });

  // `includeRefinementMode` is a public constructor option: a hand-built
  // collection constructed with it can legitimately call a scalar reducer
  // (`.count()`, `.sum()`, …) on itself, and `#includeScalarReducer`
  // captures `this.state` into the resulting `IncludeScalar` with no gate
  // in between.
  it('throws when an include-scalar reducer captures a state carrying distinctOn', async () => {
    const contract = withCapabilities(baseContract, { sql: { defaultInInsert: true } });
    const context = { ...getTestContext(), contract };
    const runtime = createMockRuntime();
    const scalarSource = new Collection({ runtime, context }, 'Post', {
      namespaceId: soleDomainNamespaceId(contract.domain),
      includeRefinementMode: true,
      state: {
        ...emptyTableState(contract, 'posts'),
        orderBy: [OrderByItem.asc(ColumnRef.of('posts', 'title'))],
        distinctOn: ['title'],
      },
    });
    const userCollection = new Collection({ runtime, context }, 'User', {
      namespaceId: soleDomainNamespaceId(contract.domain),
    });

    const withPostCount = userCollection.include('posts', () => scalarSource.count());

    await expect(withPostCount.all().toArray()).rejects.toThrow(
      'distinctOn() requires capability postgres.distinctOn',
    );
  });
});
