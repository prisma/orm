# Spike: is the type composition in ADR 260 tractable?

**Date:** 2026-09-27
**Branch:** `spike-collection-scope-types`
**Question:** can a model's collection type carry scopes typed from the contract's index data and from any package's contribution?

## Outcome

The first attempt, described first below, did not meet a basic requirement: the caller had to write the contributions' types when constructing the client. The second attempt, under "Cost of cheaper variants", meets it and is the design ADR 260 records: a registry interface keyed by index kind, with scopes under `scopes.<name>` only. Placing scopes directly on the collection was dropped because of its cost.

## Answer of the first attempt

**Tractable, with caveats.** All five requirements compile and are covered by type tests that fail when the behaviour breaks. No "type instantiation is excessively deep" error appeared, in the package or in `examples/prisma-8-demo`. Three caveats need a design decision before the slices are sized. They are listed under "Caveats".

## What was built

- `packages/3-extensions/sql-orm-client/src/scopes.ts`: the contribution interface and the type machinery.
- `Collection`, `CollectionTypeState`, `OrmOptions`, `orm()` and the include refinement types carry the contributions.
- The Postgres facade takes a `scopes` option and is generic over it.
- A crude runtime: the collection constructor installs `scopes` and the direct members. A scope operation adds a filter and a default order. An explicit `orderBy` replaces the default order, whether it comes before or after the scope call.
- Tests: `test/scopes.types.test-d.ts` (16 type tests), `test/scopes.test.ts` (4 runtime tests), `test/scopes-fixture.ts` (the fixture contract type and two contributions).
- `demo-probe.test-d.ts.txt` in this folder: the type test that was run inside `examples/prisma-8-demo` against the real contract. It is stored as text so the demo is not changed.

**Index data used.** The fixture is a hand-written contract type. It is the emitted test contract with the `posts` table's `indexes` tuple replaced. The full-text indexes carry `type: 'gin'` and structured fields in the index's existing `options` member: `options: { language, weights }`. The full-text contribution matches on that shape. The emitter was not changed. The runtime test patches the same fields into the contract JSON, and contract hydration accepted them. The demo probe matches the real opaque index on `type: 'gin'` plus `expression`.

## Evidence for each requirement

| Requirement | Result | Test |
| --- | --- | --- |
| (a) Scope existence and name come only from the contract's literal index data | Works. The name is `prefix` when the index has one, otherwise `name`. The hashed physical name is not a scope. | "a scope exists under the authored index name", "the physical name of a wire-named index is not a scope" |
| (b) Operations come from a contribution passed at construction | Works. `orm({ scopes: [fullTextScopes, brinScopes] })`. Two contributions for two index kinds work together with no change to the ORM client. Operations can read the literal index data: `fulltext(q, { only: 'title' })` accepts only columns named in the index's weights. | "operations read the literal index data", "each contribution supplies the operations of its own index kind" |
| (c) The result is the model's collection, on chained collections and in include refinements | Works for the base collection. `.where()`, `.select()`, `.limit()`, `.all()` stay typed, and the row type chosen before the scope call is kept. | "a scope operation returns the collection of the model", "the scope is present on chained collections", "the scope is present inside an include refinement" |
| (d) Direct placement only when the name is free; `scopes.<name>` always | Works. An index named `where` is reachable only as `scopes.where`. An index named `published` on a model whose custom class has `published()` is reachable only as `scopes.published`. | "direct placement exists only when the name is free", "a custom collection class keeps its members and gains scopes" |
| (e) A model with no such index has an empty `scopes` | Works. The type is `{}`. | "a model with no such index has an empty scopes object" |

## Measured cost

Instantiation and type counts are exact and repeat on every run. Check time was noisy because the machine was shared: the unchanged baseline measured between 3.3 s and 9.3 s across eight runs. Treat the times as rough.

**`sql-orm-client` package typecheck (`pnpm typecheck --extendedDiagnostics`)**

| Measurement | Before | After, without the new tests | After, with the new tests |
| --- | --- | --- | --- |
| Instantiations | 1,495,458 | 1,810,704 (+21%) | 1,872,197 (+25%) |
| Types | 240,857 | 265,108 (+10%) | 272,639 (+13%) |
| Memory | about 820 MB | about 870 MB | about 930 MB |
| Check time, best run | 3.30 s | 5.51 s | 4.83 s |

The "without the new tests" column is the cost every existing user pays when no contribution is registered. It splits into two parts:

- Adding `scopeContributions` to the collection state: +104,000 instantiations (+7%).
- Adding the `scopes` member and the direct members to `Collection`: +211,000 instantiations (+14%).

Returning early when the contribution list is empty did not help. It raised the count slightly. The cost comes from the wider intersection type, not from the index lookup.

**`examples/prisma-8-demo` typecheck**

| Measurement | Before | After, demo unchanged | After, with a scope in use |
| --- | --- | --- | --- |
| Instantiations | 732,083 | 774,709 (+5.8%) | 789,170 (+7.8%) |
| Memory | about 590 MB | about 550 MB | about 530 MB |
| Check time, best run | 1.43 s | 2.21 s | 2.24 s |
| Errors | 0 | 0 | 0 |

## Editor readability

These are the types TypeScript prints in an error message, which is close to what a hover shows.

- `db.public.Post.scopes` prints as `{ readonly search: FullTextOperations<{ readonly name: "search_0a1b2c3d"; readonly prefix: "search"; ... }, CollectionImpl<...> & ... >; readonly where: ... }`. It names the contribution's own interface and shows the index literal. It is readable.
- `db.public.Post.scopes.search.fulltext` prints as `(query: FakeTsQuery, options?: { readonly only?: "title" }) => CollectionImpl<ScopedContract, "Post", DefaultModelRow<...>, WithWhereState<...>> & { ...; } & { ...; } & { ...; }`. The parameters are clear. The return type loses the `Collection` alias name and shows an intersection.
- After one more chained call, such as `.limit(1)`, the type prints as `Collection<ScopedContract, "Post", ..., WithWhereState<WithScopeContributions<WithNsId<DefaultCollectionTypeState, "public">, readonly [...]>>>` again.
- `db.public.User.scopes` prints as `{}`.

No conditional types appear in any printed type.

## Existing types that had to change

| Type | Location | Change | How invasive |
| --- | --- | --- | --- |
| `CollectionTypeState` | `sql-orm-client/src/types.ts:161` | New required member `scopeContributions` | Medium. Any code that writes out a whole state type must add the member. One existing test needed it (`test/annotations.types.test-d.ts`). User code that writes a state type breaks the same way. |
| `DefaultCollectionTypeState` | `sql-orm-client/src/types.ts:172` | `scopeContributions: readonly []` | Small |
| `WithScopeContributions` (new) | `sql-orm-client/src/types.ts:175` | Same pattern as `WithNsId` | Small |
| `CollectionState` | `sql-orm-client/src/types.ts:102` | New optional `orderByIsDefault` flag | Small. The query planner was not changed. |
| `CollectionContext` | `sql-orm-client/src/types.ts:203` | New optional `scopeContributions`, so every collection constructor receives the contributions | Small |
| `ModelTableIndexes` (new) | `sql-orm-client/src/types.ts:1097` | Model → table → `indexes` tuple. Reuses the existing `ModelDef` and `ResolvedNsId`. | Small |
| `Collection` | `sql-orm-client/src/collection.ts:2915` | Two more intersection members: `{ scopes }` and a mapped type for direct placement | High. This is the central type and the source of most of the cost. |
| `include` overloads and the nested collection | `sql-orm-client/src/collection.ts:669`, `:732`, `:769` | The refinement collection's state carries the parent's contributions | Small. Three one-line changes. |
| `orderBy` | `sql-orm-client/src/collection.ts:941` | Drops a default order before appending | Small |
| `OrmOptions` | `sql-orm-client/src/orm.ts:25` | Third generic `Scopes` and a `scopes` option | Small. It has a default, so existing calls compile. |
| `ModelCollection` | `sql-orm-client/src/orm.ts:53` | Passes `Scopes` into the state. Wraps a custom class in `CustomCollectionWithScopes`. | Medium |
| `OrmNamespace`, `NamespacedClientMap`, `OrmClient`, `orm()` | `sql-orm-client/src/orm.ts:110`, `:125`, `:133`, `:164` | Pass the `Scopes` generic through | Small, mechanical |
| `PostgresClient`, `PostgresTransactionContext`, `PostgresOptionsBase`, `PostgresOptionsWithContract`, `PostgresOptionsWithContractJson`, `PostgresOptions`, `postgres()` | `postgres/src/runtime/postgres.ts:52` to `:202` | Second generic `Scopes` on all of them | Medium. It is mechanical, but every public facade type gains a generic. The serverless facade and other facades were not changed and need the same work. |

All paths are under `packages/3-extensions/`.

## Caveats

**1. A contribution cannot describe its types by extending the collection class.** The ADR says the owner of an index kind supplies scope operations "by extending the ORM client's collection base class". A class or a mixin function cannot be generic over "the literal index entry of whichever model this is". TypeScript has no higher-kinded types. The spike uses an interface with two input slots that the ORM client fills in: `this['index']` and `this['collection']`. The runtime half can still be done with classes, but the type half must be this interface. The ADR wording should change.

**2. `this` cannot be used inside a nested object type.** Writing `readonly operations: { fulltext(q): this['collection'] }` fails with error TS2526. The contribution author must declare a separate generic interface and pass the slots to it: `readonly operations: FullTextOperations<this['index'], this['collection']>`. This works, and it prints better in the editor.

**3. `postgres<Contract>({ contractJson, scopes })` cannot infer the scopes.** TypeScript does not infer some type arguments when others are given explicitly. The documented pattern for emitted contracts passes `Contract` explicitly, so `Scopes` falls back to its default and the `scopes` option is rejected. The demo probe proves this with `@ts-expect-error`. The options are:
- The user writes both: `postgres<Contract, readonly [typeof fullText]>(...)`. This works today.
- The Postgres facade fixes the target's own contributions in its types, so built-in full-text search needs no inference. Only extension contributions need one of the other options.
- The facade gets a form where the contract type is inferred from a value, or a two-step call.

This problem applies equally to making `extensions` generic, which the spec already plans.

**4. A custom collection class keeps scope types only at the root.** `db.Post.search.fulltext(q).published()` is typed. `db.Post.where(...).search` is not. Builder methods on a custom class return the base `Collection` with the default state, and the class declared that state without contributions. This is the same existing limitation that makes `db.Post.where(...).published()` untyped today. Inside the class body, `this.scopes.search` is also untyped. Both work when the class names the contributions in its state: `extends Collection<Contract, 'Post', Row, WithScopeContributions<DefaultCollectionTypeState, readonly [typeof fullText]>>`. The test "a custom class that names the contributions in its state" shows it. It is verbose. At runtime the scopes are always present.

**5. The alias name is lost in the scope operation's return type.** See "Editor readability". It is cosmetic.

**6. An authored name and a default name look the same.** An unnamed index gets a default `prefix` such as `posts_user_id_idx`. The contract does not record whether the author chose the prefix. A contribution for a kind whose indexes can be unnamed would produce scopes with generated names. Full-text indexes over an expression must be named, so the first delivery is not affected.

**7. `Collection` must be written in a specific form.** The scope types refer back to `Collection`. The first attempt, with helper type aliases, failed with "Type alias 'Collection' circularly references itself" and 685 errors. It compiles only when the `scopes` member and the direct-placement mapped type are written inline in the `Collection` alias, and when the key set is computed without reference to the collection type. This form is fragile. A later refactor that moves these members into a helper alias will break the build.

## Recommended shape for the contribution interface

```ts
interface ScopeOperationsShape {
  readonly index: unknown;      // filled with the literal index entry
  readonly collection: unknown; // filled with the collection type to return
  readonly operations: object;
}

interface CollectionScopeContribution<Match, Shape extends ScopeOperationsShape> {
  matches(index): boolean;                                  // runtime: is this my index kind?
  operations(index, context): Record<string, (...args) => ScopeRefinement>;
  // plus a phantom member that carries Match and Shape
}

interface ScopeRefinement {
  readonly filter: AnyExpression;
  readonly defaultOrderBy?: readonly OrderByItem[];
}
```

- `Match` is a structural type. An index has the scope when its literal type is assignable to `Match`. This keeps the ORM client free of index kinds.
- An operation returns a `ScopeRefinement`, not a collection. The ORM client applies it. The contribution never touches collection internals, and the ORM client owns the default-order rule.
- Pass contributions as a tuple: `scopes: [a, b]`. The `const` type parameter on `orm()` keeps the tuple type.
- Carry the contributions in the collection's type state. It already survives every chained call, as `nsId` does.

## Risks

- **Compile cost for everyone.** About 21% more instantiations in the package and 6% in the demo, with no scope in use. It did not approach any limit. The cost grows with the number of `Collection` types a program creates.
- **The facade inference problem (caveat 3)** affects the user-facing API and should be decided first.
- **Custom collection classes (caveat 4)** are a requirement in the spec ("reachable ... on a custom collection class"). At the root this is met. After a chained call it is met at runtime but not in the types, unless the class names the contributions. Fixing it properly means making builder methods return the custom class type, which is a larger change than this project.
- **Not tested:** `GroupedCollection`, prepared collections, polymorphic variants (`.variant()`), contracts with several namespaces, and the Mongo ORM client.
- **The structured index representation is assumed.** The spike put the fields in `options`. The real representation is still open and changes what `Match` looks like, but not the mechanism.
- **The runtime is throwaway.** It installs members on each instance and uses casts in the fixture. It shows the path works and should not be kept.

## Cost of cheaper variants

**Date:** 2026-09-27. **Baseline:** `model-scopes-design` at `072aeb7f57`, measured again on this machine. It gave the same counts as the first spike: 1,495,458 for the package and 732,083 for the demo.

### Answer

**Use variant E without direct placement.** The ORM client declares an empty registry interface. Each contributing package adds its entry by declaration merging. It is the only variant that meets requirement (f), and it is also the cheapest: +1.0% in the package and +0.5% in the demo when no scope is in use.

**Direct placement is what costs.** Every form of `db.Post.search` adds 8% to 11% in the package and about 4% in the demo, for every user, with no scope in use. Checking the name against a fixed union instead of `keyof` the collection saves only about two points in the package and one in the demo. Most of the cost comes from the extra mapped type in the `Collection` intersection, not from the name comparison.

### Requirement (f)

The user writes `postgres<Contract>({ contractJson, extensions: [...] })` as today, with no other type argument or annotation, and every contribution is fully typed.

- **Variants A to D fail (f).** They pass contributions as a type argument inferred from the call. TypeScript stops inferring once `<Contract>` is written. The first spike's probe proves it with `@ts-expect-error`.
- **Variant E meets (f).** The demo's existing `src/prisma/db.ts` was not changed. The probe imports `db` from it and gets typed scopes from two packages: the Postgres facade and `@prisma/orm-extension-pgvector`.
- **One other approach would meet (f):** the emitted `contract.d.ts` carries the operation types, as it does today for query operations and aggregates. That breaks requirement (a), so it was not built.

### Measurements

Instantiation counts from `tsc --extendedDiagnostics`. The counts repeat exactly between runs. "No scopes" means the scope tests are excluded from the package, and the demo is unchanged. "With scopes" adds the scope tests to the package and one probe file to the demo.

| Variant | Package, no scopes | Package, with scopes | Demo, no scopes | Demo, with scopes | (a) | (b) | (c) | (d) | (e) | (f) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline | 1,495,458 | n/a | 732,083 | n/a | | | | | | |
| First spike (state member, direct placement), not measured again | 1,810,704 (+21.1%) | 1,872,197 (+25.2%) | 774,709 (+5.8%) | 789,170 (+7.8%) | yes | yes | yes | yes | yes | **no** |
| A: `scopes` only | 1,628,908 (+8.9%) | 1,682,318 (+12.5%) | 738,395 (+0.86%) | 751,058 (+2.6%) | yes | yes | yes | `scopes.<name>` only | yes | **no** |
| B: A, contributions on the contract type argument | 1,522,005 (+1.8%) | 1,602,319 (+7.1%) | 735,037 (+0.40%) | 764,845 (+4.5%) | yes | yes | yes | `scopes.<name>` only | yes | **no** |
| C: B, `scopes` through an interface | 1,580,535 (+5.7%) | 1,661,505 (+11.1%) | 736,810 (+0.65%) | 766,726 (+4.7%) | yes | yes | yes | `scopes.<name>` only | yes | **no** |
| D: B plus direct placement, fixed union | 1,649,615 (+10.3%) | 1,737,866 (+16.2%) | 763,171 (+4.2%) | 795,175 (+8.6%) | yes | yes | yes | yes | yes | **no** |
| **E: registry, `scopes` only** | **1,510,673 (+1.0%)** | 1,573,222 (+5.2%) | **735,693 (+0.49%)** | 748,029 (+2.2%) | yes | yes | yes | `scopes.<name>` only | yes | **yes** |
| E, `scopes` through an interface | 1,568,678 (+4.9%) | 1,632,806 (+9.2%) | 737,279 (+0.71%) | 749,632 (+2.4%) | yes | yes | yes | `scopes.<name>` only | yes | yes |
| E plus direct placement, fixed union | 1,622,501 (+8.5%) | 1,691,645 (+13.1%) | 760,729 (+3.9%) | 774,512 (+5.8%) | yes | yes | yes | partly, see below | yes | yes |
| E plus direct placement, `keyof` | 1,654,697 (+10.6%) | 1,725,360 (+15.4%) | 768,270 (+4.9%) | 782,491 (+6.9%) | yes | yes | yes | partly, see below | yes | yes |

How to read the table:

- **Compare the "no scopes" columns between variants.** The "with scopes" columns use different test files and probes for each variant, so they are only a rough guide.
- **In variant E the demo's "no scopes" number includes two registered contributions.** The Postgres facade registers one for every user, and the demo imports pgvector, which registers a second. In variants A to D the demo's "no scopes" number has no contribution at all. Variant E is still as cheap.
- **Every demo number was checked for `any`.** Each run also typechecks a probe that asserts `db.orm.public.Post` is not `any` and that an unknown member is an error. One run with a broken import produced untyped collections, and the run reported the errors.
- **Wall-clock times are left out.** The machine was busy. The load average was 69 when the work started.
- **The type count fell below the baseline in several variants**, for example 229,522 against 240,857 for variant E in the package. I could not explain it. All existing type tests in the package pass.

### What each variant changed

Each variant is its own commit on the branch. The branch tip is variant E without direct placement.

| Variant | Commit | Change |
| --- | --- | --- |
| E | `376a425bb4` | See "Variant E" below. |
| E, interface | `d3066e4210` | `Collection` intersects `CollectionScopesMember<...>`, an interface with the one `scopes` member. |
| E plus direct, fixed union | `ae54591151` | Adds the mapped type for direct placement. Names are excluded by `ReservedCollectionMemberName`. |
| E plus direct, `keyof` | `7037a814dc` | The same, with names excluded by `keyof` the collection and the aggregate reducers. |
| A | `091bf2a60a` | The first spike with the direct-placement mapped type removed from `Collection` and from the custom class wrapper. |
| B | `4790f05671` | A, with `scopeContributions` removed from `CollectionTypeState`. `orm()` returns `Collection<TContract & { [carrier]?: Scopes }, ...>`. `Collection` reads the contributions back from its contract type argument. |
| C | `6bae5e1d7f` | B, with the `scopes` member moved into an interface. |
| D | `f8550a244a` | B plus the direct-placement mapped type, with the fixed union. |

Findings from A to D:

- **The belief about direct placement was right.** Removing it from the first spike saves 182,000 instantiations in the package, which is 12 points of the 21.
- **The state member can be removed (B).** Every chained method and every include refinement already passes `TContract` on, so a phantom optional member on the contract type argument reaches them all. When no contribution is passed, the type argument is exactly `TContract`. The type tests for chained collections, include refinements and custom classes pass.
- **An interface does not make `scopes` cheaper (C).** It costs more than the inline object type in both B and E.
- **The fixed union is `keyof CollectionImpl<Contract<SqlStorage>, string, unknown, DefaultCollectionTypeState>`** plus `scopes` and the five built-in aggregate names. It has no type parameters, so TypeScript computes it once. An aggregate that an extension contributes, such as `stddev`, is not in the union.

### Variant E: what was built

- `sql-orm-client/src/scopes.ts` exports `interface CollectionScopeRegistry {}`. A key is a contribution id. An entry extends `ScopeOperationsShape`, which has four members: `match`, `index`, `collection` and `operations`.
- An index has a scope when its literal type is assignable to the `match` type of at least one entry. The operations of all matching entries are intersected.
- `Collection` gains one member: `{ readonly scopes: ... }`. `CollectionTypeState`, `orm()`, `OrmOptions`, `postgres()` and `PostgresClient` have the same signatures as on main.
- The runtime half is a new optional member `collectionScopes` on the component descriptors, next to `queryOperations`. `createExecutionContext` collects it into `ExecutionContext.collectionScopes`. The ORM client reads it from there.
- The Postgres facade registers `postgres/fulltext` in `postgres/src/runtime/fulltext-scope.ts`. The pgvector package registers `pgvector/spike` in `pgvector/src/core/spike-scope.ts`. It stands in for a third-party extension.

A contributing package writes this:

```ts
export interface PostgresFullTextScope extends ScopeOperationsShape {
  readonly match: { readonly type: 'gin'; readonly expression: string };
  readonly operations: PostgresFullTextOperations<this['index'], this['collection']>;
}

declare module '@internal/sql-orm-client' {
  interface CollectionScopeRegistry {
    readonly 'postgres/fulltext': PostgresFullTextScope;
  }
}
```

### Variant E: results for each question

**1. Is a contribution from another package picked up through built output?** Yes, after two fixes to the build. The demo consumes only the `dist/*.d.mts` files of the published packages under `packages/9-public`.

- **The module specifier.** Source in the workspace names `@internal/sql-orm-client`. The published declaration file must name `@prisma/orm-family-sql/orm-client`, because that is where the registry interface is declared for a user.
- **The internal name breaks it, silently.** The shell build copied `declare module '@internal/sql-orm-client'` into the published file unchanged. TypeScript reported no error, and `scopes` was `{}`. The probe failed with "Property 'post_title_search' does not exist on type '{}'".
- **Fix 1:** `packages/0-config/tsdown/shell-build.ts` now rewrites `declare module '@internal/...'` to the published name, as it already does for `import('@internal/...')`. With the fix the probe passes.
- **Fix 2:** the declaration bundler drops a `declare module` block when nothing from its file is exported by the package entry point. It gives no warning. Exporting one type from the file through the entry point keeps the block.
- **A user-land extension can name the facade instead.** `declare module '@prisma/orm-postgres/orm-client'` works, although that module only re-exports the registry with `export *`. Probe: `demo-probe-registry-reexport.test-d.ts.txt`.
- **The contributing package must depend on the package it names.** pgvector needed `@internal/sql-orm-client` added to its dependencies.

**2. Requirements (a) to (f).** All hold except direct placement in (d). Type tests: `sql-orm-client/test/scopes.types.test-d.ts` (11 tests) and `demo-probe-registry.test-d.ts.txt`.

**3. Does per-index typing still work?** Yes. The `this['index']` and `this['collection']` slots from the first spike work unchanged inside a registry entry. The demo probe reads the literal `expression` and the literal physical name of the index from two different contributions, and the scope operation returns the model's collection. One change was needed: testing an entry with `extends ScopeOperationsShape` gave error TS2589, "excessively deep". Reading `match` by indexed access avoids it.

**4. Cost.** See the table.

**5. The extension is imported but not passed at runtime.**

- **The types cannot tell.** The registry belongs to the whole program. Once any file imports the extension, every client in the program is typed as having its scopes. Two clients with different extension lists get the same types.
- **The existing check already fails at construction when the contract lists the extension.** The emitted contract lists every extension that was composed at emit time under `extensions`. The demo contract lists `pgvector`. Building the demo client without it throws "Contract requires extension pack(s) 'pgvector', but runtime descriptors do not provide matching component(s)." Test: `demo-missing-extension.test.ts.txt`, run inside the demo. An index of an extension's kind can only reach the contract through that extension, so this covers the normal case with no new code.
- **The gap is a package that is not in the contract.** A package that only contributes scopes for an index kind owned by someone else is not listed. For that case the spike adds a second check. It reads an assumed field, `options.requiresScopes`, a list of contribution ids on the index entry. `orm()` throws at construction when an id has no runtime contribution. The message is: "Index 'search' on table 'public.posts' needs the collection scope contribution 'test/fulltext', but no component passed to the client provides it. Pass the extension that declares 'test/fulltext' in `extensions`." Test: "fails at construction when the contract needs a contribution that was not passed" in `test/scopes.test.ts`.
- **With neither, there is no error at construction.** The first call to the operation fails because the member is undefined.

### Variant E: caveats

- **Custom collection classes improve.** A custom class extends the `Collection` type, so it has `scopes` inside the class body and after a chained call. The first spike's caveat 4 no longer applies. No wrapper type is needed in `orm()`.
- **Direct placement conflicts with custom classes.** With direct placement the base type has a member for each scope. A custom class that declares a method with the same name as a scope gets compile error TS2416 on the method. Requirement (d) says the scope should only lose direct placement. This is the "partly" in the table.
- **Two packages that register the same id** should get a compile error from declaration merging. This was not tested.
- **The first spike's caveats 1, 2, 6 and 7 still apply.** Caveat 3, the inference problem, is gone.

### Recommendation

1. Use variant E: the registry, with `scopes.<name>` only.
2. Drop direct placement, or accept that every user pays about 4% in an application and 8% to 11% in the ORM client package for it. No cheap form was found.
3. Change the shell build as in fix 1, and make it fail when a `declare module` block in source is missing from the built declaration file. Both failures are silent today.
4. Decide whether a package may contribute scopes without being listed in the contract. If it may, the contract must name the contribution an index needs.

Files: the probes are in this folder with a `.txt` suffix. `measure.sh.txt` is the script that produced every number.
