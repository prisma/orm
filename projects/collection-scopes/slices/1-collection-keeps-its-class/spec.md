# Slice 1: a collection keeps its class through the chain

**Project:** [spec](../../spec.md), [plan](../../plan.md). **Design:** [ADR 258](../../../../docs/architecture%20docs/adrs/ADR%20258%20-%20A%20collection%20keeps%20its%20class%20through%20the%20chain.md). **Closes:** TML-3397, and the chaining part of TML-3403.

## At a glance

```ts
class PostCollection extends Collection<Contract, 'Post'> {
  published()   { return this.where((p) => p.publishedAt.isNotNull()); }
  newestFirst() { return this.orderBy((p) => p.publishedAt.desc()); }
}

db.Post.published().newestFirst().limit(10).all();
db.Post.where({ userId }).published();
db.Post.include('user').published();

const posts = search ? db.Post.published() : db.Post;
await posts.deleteAll();                                  // error

db.Post.pipe((c) => (search ? c.where((p) => p.title.eq(search)) : c)).limit(10);
```

## Chosen design

As ADR 258, in `packages/3-extensions/sql-orm-client`:

- `StateType` and `RowType` unique symbols; `declare readonly [StateType]: State` and `declare readonly [RowType]: Row` on `CollectionImpl`. `DefaultCollectionTypeState` flags are `boolean`.
- `HasWhere`, `HasOrderBy` interfaces; `Filtered<Self>`, `Ordered<Self>`, `Including<Self, Rel>`, `Step<In, Out>`, `CollectionStateOf<C>`, `CollectionRowOf<C>` types, all exported.
- `where`, `orderBy`, `limit`, `offset`, `distinct`, `distinctOn`, `cursor` and `include` take `this: Self` and return `Filtered<Self>`, `Ordered<Self>`, `Self` or `Including<Self, Rel>`. `select` and `variant` infer state and row from a `this` parameter and return the shared `Collection` type.
- Row-returning methods read the row as `CollectionRowOf<this>`. Guards read the flag from `this`: the argument form where there is an argument, the `this`-parameter form for the deletes.
- `pipe<Self, Out>(this: Self, step: Step<Self, Out>): Out`.
- `CollectionImpl` is exported; the public entry exports the names ADR 258 lists.

The spike on `bot/spike-this-typed-chaining` (tip `b2b7c94d6b`) is the reference implementation; `projects/collection-scopes/spikes/this-typed-chaining.md` records every casualty and its fix. Do not land the earlier spikes' helpers (`when`, `fragment`, `stateFragment`, `rowFragment`, `sortField`, the full-text scope code) that the branch still carries.

## Coherence rationale

One change to one type, with its tests. The diff is large in `collection.ts` signatures but has a single idea, and the spike shows the rest of the repository needs only test changes.

## Scope

In: `sql-orm-client` source and tests; the Postgres facade exports; `examples/prisma-8-demo` chaining its existing custom collection methods; upgrade instructions; ADR 258 set to match the code.

Out: fragment helpers (slice 2); the class inside include refinements; a run-time guard on `deleteAll`; the Mongo ORM client.

## Pre-investigated edge cases

- Inside an include refinement the collection is an `Omit`, which pins polymorphic `this`; this is why the methods take `this: Self`. `examples/prisma7-adoption` chains inside a refinement and fails without it.
- An intersection-based refinement type (`Collection & { all: never }`) fails with TS2589 in `orm.test.ts`; do not pursue it.
- A second overload without the `this` parameter on `include` costs about 170,000 instantiations; keep it on `select` and `variant` only.
- `cursor` keeps the argument-form guard: six integration tests cast the argument to bypass it.
- Declaration errors (TS4023, TS4094, TS4053, TS2527, TS7056) only appear once all other errors are gone; they are fixed by the exports.

## Slice-specific done conditions

- Type tests cover: class methods after `where`, `orderBy`, `limit`, `include` and inside `pipe`; chained includes; `select` after `include`; guards on the class root and after a class method; every conditional form at every site; the regression for TML-3397. Each `@ts-expect-error` is verified to fail for the stated reason.
- The whole repository typechecks; `sql-orm-client` tests pass; the demo typechecks through `dist`; lint passes including `lint:throws` and `check:upgrade-coverage`.
- Type instantiations on `examples/prisma-8-demo` do not rise.
- Upgrade instructions cover: `DefaultCollectionTypeState` flags; `CollectionStateOf` and `CollectionRowOf` in place of type arguments; `ReturnType<C['where']>`; explicit type arguments on `include`.

## Open questions

None.
