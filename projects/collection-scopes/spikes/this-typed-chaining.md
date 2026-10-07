# Spike: chaining methods that return `this`

**Date:** 2026-09-30
**Branch:** `spike-this-typed-chaining`, started from `bot/spike-collection-state-subtyping` at `9947eac755`.
**Question:** A custom collection class loses its methods after any chained call. Can the chaining methods that only change the type state return `this` intersected with the flag they set, so the class survives the chain?

## Answer

Yes. `where` now returns `this & HasWhere` and `orderBy` returns `this & HasOrderBy`, where `HasWhere` is `{ readonly [StateType]: { readonly hasWhere: true } }`. `limit`, `offset`, `distinct`, `distinctOn` and `cursor` return `this`. The guards read the flag from `this`, not from the class's `State` type argument. With that, `db.Post.published().recent()`, `db.Post.where(...).published()` and long chains keep the class, repeated flags do not pile up (`PostCollection & HasWhere & HasOrderBy` stays that type), `cond ? db.Post.published() : db.Post` and `cond ? this.where(...) : this` reduce to the class, `let q = db.Post; if (x) q = q.published()` compiles, and writes stay refused until a `where` has run. `select` and `include` still return a plain `Collection`, so custom methods must come before them, and include refinements still get the plain collection. Written naively, with the row-changing methods reading the state as `this[typeof StateType]`, the change costs +11% instantiations in the package and +4% in the demo. Having `select`, `include` and `variant` infer the state from a `this` parameter instead brings it to −0.4% in the package and +0.2% in the demo. All 104 dependent packages typecheck, after exporting five more type names that declaration output needs. I recommend this design, in its own ticket, after the state-subtyping change.

**Update:** a follow-up made `include` keep the class too, and changed how the chaining methods keep it. It is cheaper than both the branch point and the state above. See "include through this" at the end; where it disagrees with the sections before it, it wins.

## What was changed

All production changes are in `packages/3-extensions/sql-orm-client`.

`src/collection-internal-types.ts`:

- `HasWhere` and `HasOrderBy`: interfaces with one property, `[StateType]`, holding one flag set to `true`. Because `CollectionImpl` declares `[StateType]: State`, the intersection `C & HasWhere` has `[StateType]: State & { hasWhere: true }`, and `boolean & true` is `true`. They are interfaces, not inline object types, so every `where` produces the same type, TypeScript removes the duplicate from `A & HasWhere & HasWhere`, and error messages print the name.
- `CollectionStateOf<C>`: `C[typeof StateType]`. It is a named alias because declaration output cannot write `this[typeof StateType]` in a consumer's file: `StateType` is a `unique symbol` and TS2527 ("references an inaccessible 'unique symbol' type") was the result in the demo's `TaskCollection.bugs()`.

`src/collection.ts`:

- `CollectionImpl` is now `export class`. Without a name for the class, the type of a plain chain (`CollectionImpl<...> & AggregateIncludeReducers<...> & HasWhere`) can only be written out as an anonymous class, which fails declaration output with TS4094 (private `contract`) and TS7056 (type too long).
- `where` (all four overloads) returns `this & HasWhere`; `orderBy` returns `this & HasOrderBy`. Both build the clone through a new private `#cloneSelf<Flags>()`, which calls `#createSelf` with the current row and state and casts the result to `this & Flags` with `blindCast`. The run-time behaviour is unchanged: `#createSelf` already builds the clone with `this.constructor`, so the subclass was always preserved at run time.
- `limit`, `offset`, `distinct`, `distinctOn` and `cursor` return `this` through `#cloneSelf`. One `blindCast` was added in `#cloneSelf` and one was removed from `cursor`.
- Guards on methods with an argument (`update`, `updateAll`, `updateAndCount`, `cursor`, `distinctOn`) keep their form, but read `CollectionStateOf<this>['hasWhere']` (or `['hasOrderBy']`) instead of `State['hasWhere']`. Guards on methods without an argument (`delete`, `deleteAll`, `deleteAndCount`) use the `this` parameter `this: this & HasWhere` instead of `this: State['hasWhere'] extends true ? Collection<...> : never`.
- `select` and `variant` get a first overload with a `this` parameter, `this: { readonly [StateType]: S }`, which infers the state `S` from the receiver and returns `Collection<..., S>`. A second overload without the `this` parameter returns `Collection<..., State>`; it is used when the first overload cannot infer one state, for example on a union of two differently flagged collections or on `Pick<Collection, 'select'>`. It is sound: it loses flags, so it refuses writes.
- `include` gets the same `this` parameter on both overloads, without a second overload (see Measurements for why).
- `get prepared()` returns `PreparedCollection<..., CollectionStateOf<this>>`.
- The private `#updateAllWithAnnotations` takes the plain update input; its guard was only ever on the public methods.

`src/exports/index.ts`: exports the types `CollectionImpl`, `CollectionStateOf`, `HasWhere`, `HasOrderBy`, `StateType`, `AggregateIncludeReducers` and `IncludeScalar`. Declaration output in consumers needs each of them (see Casualties).

Tests:

- `test/this-typed-chaining.types.test-d.ts` (new): the cases below, with `@ts-expect-error` negatives and `not.toBeAny()` checks. I removed every directive in a copy and read each error; each fails for the stated reason.
- `test/generated-contract-types.test-d.ts`: `StateOf<T>` now reads `T[typeof StateType]` instead of inferring `Collection`'s fourth type argument.
- `test/pipe-q1-conditional.types.test-d.ts`, `test/pipe-state-subtyping.types.test-d.ts` (earlier spikes): the tests that asserted a union for custom classes now assert the class; the tests that asserted TS2349 for `include` on `Base | Filtered` now assert that it works.
- `projects/collection-scopes/spikes/demo-probe-this-chaining.test-d.ts.txt`: the demo probe, run against `dist`.

## What works and fails

`PostCollection` has `published()` (a `where`) and `recent()` (an `orderBy`). "Writes" means `update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll` and `deleteAndCount`. Error codes are those of the tip.

| Case | Result type | Result |
| --- | --- | --- |
| `db.Post.published().recent()` | `PostCollection & HasWhere & HasOrderBy` | works |
| `db.Post.where(...).published()` | `PostCollection & HasWhere` | works |
| `db.Post.include('author').published()` | `Collection<...>` | TS2339: `include` returns a plain `Collection` |
| `db.Post.published().include('author')` | `Collection<..., row with author, state with hasWhere>` | works; writes allowed; custom methods gone |
| `db.User.include('posts', (posts) => posts.published())` | refinement is `IncludeRefinementCollection` | TS2339, as before |
| `published().recent().limit(10).offset(1).distinct('title').published()` | `PostCollection & HasWhere & HasOrderBy` | works; `.recent().published()` on it gives the identical type |
| `db.Post.pipe((c) => c.published()).recent()`, and `this.pipe((c) => c.published())` in the class | the class with `HasWhere` | works |
| Writes on `db.Post` | | refused: TS2345 (argument not assignable to `never`) for `update`, `updateAll`, `updateAndCount`; TS2684 ("The 'this' context of type 'PostCollection' is not assignable to method's 'this' of type 'PostCollection & HasWhere'") for the deletes |
| Writes after `published()`, after `published().limit(1)`, `published().select('id')`, `published().include('author')` | | allowed |
| `cursor` on `db.Post`, on `db.Post.published()` | | refused, TS2345 |
| `cursor` after `recent()` or `orderBy(...)` | the class | allowed |
| Plain `Collection`: guards, `where(...).update`, `orderBy(...).cursor`, `where(...).prepared` | | unchanged |
| `cond ? this.where(...) : this` in a class method, and the early-return and `let q = this` forms | `PostCollection` (the class) | works; writes refused. This was the union in the previous spike |
| `cond ? db.Post.published() : db.Post` | `PostCollection` | works, including `include`; writes refused |
| `db.Post.pipe((c) => (cond ? c.published() : c))` | `PostCollection` | works |
| `let q = db.Post; if (x) q = q.published(); if (x) q = q.recent().limit(3)` | `PostCollection` | compiles; writes refused |
| `cond ? db.Post.published() : db.Post.recent()` | `(PostCollection & HasWhere) \| (PostCollection & HasOrderBy)` | reads, `select` and custom methods work; `include` TS2684; writes and `cursor` refused |
| A filtered class instance passed as `Collection<TestContract, 'Post'>` | | accepted |
| A plain collection passed as `PostCollection` | | TS2379 |
| `Base \| Filtered` and `Base \| Ordered` on the plain collection | | `include` now works; it failed with TS2349 before |
| `Filtered \| Ordered` on the plain collection | | `include` still fails |
| Demo against `dist`: `db.User.admins().newestFirst().emailDomain(...)`, `db.Post.forUser(...).withTitle(...).newestFirst().limit(5)`, `db.Task.bugs()`, ternary, `let`, `pipe`, guards, and exported chains | | all as above |

How the types look: a custom class prints as `PostCollection & HasWhere & HasOrderBy`. A plain chain now prints as `CollectionImpl<Contract, "Post", ...> & { ...; } & HasWhere & HasOrderBy`, where it used to print as `Collection<Contract, "Post", Row, WithOrderByState<WithWhereState<...>>>`: the `Collection` alias is lost after the first `where` or `orderBy`. No normalised form is needed, because an intersection does not grow when a flag is set again.

`where` still sets `hasWhere` when its input normalises to no filter, as before.

## Casualties in the wider repository

`pnpm turbo run typecheck --filter='...@internal/sql-orm-client'`: 104 of 104 tasks pass at the tip, with the demo probe in place. The package's 1,111 tests pass. Every failure found on the way:

| Where | Failure | Resolution |
| --- | --- | --- |
| `test/generated-contract-types.test-d.ts` | `StateOf` inferred `Collection`'s fourth type argument, which stays the root state now that the flags live in the `this` intersection | Fixed in the test. Real: any user code that extracts the state from the type arguments sees the root state. Record in upgrade instructions |
| The package's own type tests with exported values | TS4023 and TS4094: a plain chain's type needs the unexported `CollectionImpl` | Fixed by exporting `CollectionImpl`. These errors only appear once all other errors are gone, because TypeScript reports declaration errors last |
| `examples/prisma-8-cloudflare-worker` | TS4053: "Return type of public method from exported class has or is using name 'HasWhere' ... but cannot be named" | Fixed by exporting `HasWhere` and `HasOrderBy`. Real for any library that exports a custom collection class with declarations on |
| `examples/prisma-8-demo`, `TaskCollection.bugs()` | TS2527 on `this[typeof StateType]` in `variant`'s return | Fixed by the `CollectionStateOf` alias and, later, by the `this` parameter on `variant` |
| Demo probe: `export const q = plainOrm.Tag.where(...)` | TS4023 for `IncludeScalar`, `RowType`, `CollectionInit`; TS4094; TS7056 | Fixed by exporting `CollectionImpl`, `AggregateIncludeReducers` and `IncludeScalar` |
| `test/integration`, six tests (`max`, `min`, `many_count_relation`) | TS2684 on `cursor({ id: 3 } as never)` without an `orderBy`, when `cursor` briefly used a `this` parameter guard | Fixed by keeping the argument form for `cursor`: `as never` on the argument still bypasses the guard, as these tests need |
| `test/pipe-q1-conditional`, `test/pipe-state-subtyping` (earlier spikes' tests) | They asserted the old union and TS2349 | Rewritten to the new, better behaviour |

`GroupedCollection`, `PreparedCollection`, `distinct`, `variant`, `test/collection-variant.test.ts`, the Postgres facade and the other examples needed no change.

## Guards: the two forms

Both forms work.

- A `this` parameter, `update(this: this & HasWhere, data: ...)`, compiles, keeps private-field access inside the method, and gives the clearest error: "The 'this' context of type 'PostCollection' is not assignable to method's 'this' of type 'PostCollection & HasWhere'". But `as never` on the argument no longer bypasses it, and six integration tests rely on that for `cursor`.
- A conditional on the argument, `data: CollectionStateOf<this>['hasWhere'] extends true ? X : never`, keeps the old error ("not assignable to parameter of type 'never'") and the `as never` bypass.

The tip uses the argument form where there is an argument, and the `this` form for the three delete methods, which already used a `this` parameter. The argument form costs more: moving all guards back to the class `State` saved 65,000 instantiations in the first version, because a signature that mentions `this` is instantiated again for every receiver type. I did not measure the guards at the tip.

## Measurements

Instantiation counts from `tsc --extendedDiagnostics` (`mise exec -- pnpm exec tsc --noEmit`), TypeScript 5.9.3, two runs each; both runs always gave the same number. "Package" is `packages/3-extensions/sql-orm-client` with the spike tests (`test/fulltext-search*`, `test/pipe-*`, `test/this-typed-*`) excluded. "Demo" is `examples/prisma-8-demo` against the built `dist`. The demo already defines four custom collection classes and uses them in a few files, so "no custom class in use" means no new use. The scripts are `measure-chain.sh.txt` and `gen-chain-probes.mjs.txt`; raw counts are in `this-typed-chaining-measurements.tsv.txt`. The baseline differs from the earlier spikes' tables because this script calls `tsc` directly and excludes a different set of files.

### States

| State | Package | Demo |
| --- | --- | --- |
| Branch point `9947eac755` | 1,529,500 | 745,802 |
| First version: `select`, `include`, `variant` and `prepared` read `CollectionStateOf<this>` | 1,701,672 (+172,172, +11.3%) | 778,119 (+32,317, +4.3%) |
| Tip: `select`, `include` and `variant` infer the state from a `this` parameter | 1,523,198 (−6,302, −0.4%) | 747,191 (+1,389, +0.2%) |

### Ten chained calls

Each probe has one chain of ten calls, `root.W.O.limit(10).W.O.offset(1).W.O.limit(5).W`, then `.all()`. In the package the root is `Post` and W and O are `where((p) => p.views.gte(100))` and `orderBy((p) => p.views.desc())`, or the class methods `published()` and `recent()`. In the demo the root is `User` and the class methods are `admins()` and `newestFirst()`. Numbers are the increase over a probe with the same imports and no chain, in the same state.

| Probe | Package, before | Package, tip | Demo, before | Demo, tip |
| --- | --- | --- | --- | --- |
| Plain collection | +354 | +70 | +356 | +97 |
| Custom class, base methods only | +230 | +61 | +296 | +78 |
| Custom class, its own methods | does not compile | +51 | does not compile | +62 |

The first version gave the same probe numbers as the tip. A chain is cheaper than before, likely because every step used to create a new `Omit`-based state type and now adds one of two small interfaces. The chain on a custom class costs no more than the same chain on a plain collection.

### Where the first version's cost came from

Package only, one run each (deterministic in every repeated run above). Each row changes the first version.

| Variant | Package | Errors in the included tests |
| --- | --- | --- |
| First version | 1,701,672 | 0 |
| `include` reads the class `State` | 1,561,250 | 0 |
| `variant` reads the class `State` | 1,613,497 | 0 |
| `select` reads the class `State` | 1,632,409 | 0 |
| `prepared` reads the class `State` | 1,695,556 | 0 |
| Guards read the class `State` | 1,636,451 | 42 |
| `select` infers the state from a `this` parameter | 1,634,859 | 0 |
| `select`, `include`, `variant` infer it, no second overload | 1,467,206 | 0 |
| The same, with a second overload on all three | 1,692,295 | 0 |
| The same, with a second overload on `select` and `variant` only (tip) | 1,523,198 | 0 |

A method signature that mentions `this` is instantiated again for every receiver type, and `include` has large signatures. A `this` parameter with an inferred type parameter does not mention the polymorphic `this`, so it is instantiated once per class type. The second overloads cost more than I expected, about 170,000 for `include`'s two; I did not confirm why. Without a second overload, `select` failed on a union of differently flagged collections and on `Pick<Collection, 'select'>`, which the earlier `pipe` spike's tests use, so `select` and `variant` keep one and `include` does not. The cheapest variant (−62,000) is available if those two cases may fail.

## `select` and `include`

`select` narrows the row. The class cannot survive it by intersection, because an intersection can only add row fields. It could only survive if every terminal method read the row from `this` and the subclass could be rebuilt with a new row type, which TypeScript cannot express for an arbitrary subclass. Custom methods are also written against the full row. I recommend that `select` keeps returning a plain `Collection`, as now, and that the documentation tell users to call custom methods before `select`.

`include` only adds fields, so it could return `this & RowSelection<Row & { author: ... }>`. I tried this on `include`'s first overload with `all()` reading `this[typeof RowType]`. The class and the widened row survived for `all()`, but 65 existing type tests failed, because `first()`, `select`, a second `include`, the write methods, `PreparedCollection` and the tests that infer the row from the type arguments all read the class `Row`. Making it work means changing every method that returns a row to read `this[typeof RowType]`, which is the same kind of per-receiver cost measured above, and rows would print as `Row & SimplifyDeep<Row & {...}>`. I reverted it. I recommend that `include` stays row-changing and returns a plain `Collection`.

## Include refinements and the registry of classes

Today the refinement callback gets `IncludeRefinementCollection<Contract, 'Post', Row, State, IsToMany>`, an `Omit` of the plain `Collection`. The registry of classes (`orm({ collections: { Post: PostCollection } })`) only exists in the type of the `orm()` result; the collection types do not carry it. At run time the refinement already gets the registered class (`#createCollection` looks it up in `this.registry`).

To give the refinement the registered class, the parent collection's type must carry the registry type, `{ Post: typeof PostCollection; User: typeof UserCollection }`, and `include` must look up `InstanceType<Registry[RelatedName]>` and remove the terminal methods from it. Two ways to carry it:

- A fifth type argument on `Collection`. Every chained return type must pass it on, and every named collection type in user code gains it. A custom class cannot name the registry in its own `extends Collection<C, 'User', Registry>`, because the registry refers to the class, so inside class bodies the registry is missing.
- A declared property, like the state: `orm()` returns `InstanceType<C[M]> & { readonly [RegistryType]: Registry }`. The state-only methods already return `this & ...`, so it survives them for free; `select`, `include` and `variant` would have to pass it on. `include` reads it with the same inferred `this` parameter the tip uses for the state, which avoids the per-receiver cost. Inside a class body `this` has no registry, so a class method that calls `include` with a refinement still gets the plain collection there.

A `this`-based return type does not help inside the refinement on its own: `this` is the parent's type, and nothing in it names the related model's class. What `this` gives is a place to carry the registry through chains once `orm()` puts it there.

Cost drivers: one more distinct type per collection type and registry; one more type lookup and one `Omit` over a class type per `include` with a refinement; and structural comparison of large class types when a refinement result is checked against `IncludeRefinementResult`. `Omit` over a class keeps the class's methods but binds their `this` to the class, so `posts.published()` inside the refinement would return the full class with its terminal methods, as the plain refinement does today.

## Not tested

- Include refinements with the registered class (not implemented, as asked).
- Autocomplete, error messages in the editor, and check times.
- Run-time tests beyond the package's 1,111 tests; the change is type-only apart from `#cloneSelf`, which builds the same clone as `#clone`. I did not run `pnpm test:integration` or the demo's tests.
- `Pick<Collection, 'include'>` and `Pick<Collection, 'variant'>` receivers. `include` has no second overload, so the first would likely fail there.
- The cost of the guards at the tip, and moving them to an inferred `this` parameter.
- Why the second overloads cost so much.
- The Mongo ORM client.
- Polymorphic variants on a custom class beyond the demo's `TaskCollection.bugs()`.

## Recommendation

Adopt the tip's design, as its own ticket, after the state-subtyping change it builds on:

- State-only methods return `this & HasWhere`, `this & HasOrderBy` or `this`.
- Guards read `CollectionStateOf<this>`; argument guards stay on the argument, argument-less guards use `this: this & HasWhere`.
- `select`, `include` and `variant` stay row-changing and infer the state from a `this` parameter; `select` and `variant` keep a second overload.
- Export `CollectionImpl`, `CollectionStateOf`, `HasWhere`, `HasOrderBy`, `StateType`, `AggregateIncludeReducers` and `IncludeScalar`, and add a test that exports a plain chain and a custom class with declaration output on, so a missing export fails in CI.
- Document that custom methods come before `select` and `include`.
- Record upgrade instructions: code that infers the state from `Collection`'s type arguments must read `[StateType]` instead, and plain chains now print as `CollectionImpl<...> & ... & HasWhere`.

It fixes all four cases in the question except the include refinement, fixes the class-against-filtered-class union from the previous spike, makes `include` work on `Base | Filtered`, and costs about nothing. Treat custom classes in include refinements as a separate decision: it needs the registry carried on every collection type and does not work inside class bodies.

## Files

- `packages/3-extensions/sql-orm-client/src/collection.ts`, `src/collection-internal-types.ts`, `src/exports/index.ts`: the change.
- `packages/3-extensions/sql-orm-client/test/this-typed-chaining.types.test-d.ts`: the type tests.
- `packages/3-extensions/sql-orm-client/test/generated-contract-types.test-d.ts`, `test/pipe-q1-conditional.types.test-d.ts`, `test/pipe-state-subtyping.types.test-d.ts`: updated assertions.
- `demo-probe-this-chaining.test-d.ts.txt`: the demo probe; copy it to `examples/prisma-8-demo/test/` to run it.
- `measure-chain.sh.txt`, `gen-chain-probes.mjs.txt`: the measurement scripts. Run `zsh projects/collection-scopes/spikes/measure-chain.sh.txt <label> <before|after>` from the repository root after building the demo's dependencies.
- `this-typed-chaining-measurements.tsv.txt`: every count. In its `bisect` rows, `tip` is the first version and `partial-fallbacks-2` is the tip.

## include through this

**Question:** can `include` keep the class the way the flags do, by returning `this` with a wider `[RowType]`?

**Answer:** yes, and it makes the package and the demo cheaper to check, not dearer. `db.Post.include('author').published()` keeps `PostCollection`, and its rows have `author`. Chained includes widen twice, `include` after `where` keeps `HasWhere`, `select` after `include` still narrows, and `update` after `where` and `include` returns the widened row. The package and its 1,117 tests, all 104 dependent packages, and the demo (with the probe, through `dist`) typecheck. The 65 tests that failed in the earlier attempt pass. Against the tip before this change (`d6b061c924`), the package costs 18% fewer instantiations and the demo 9.6% fewer.

### What was changed

`src/collection.ts`:

- `include` (both public overloads) gets a type parameter `Self extends IncludeReceiver = never` and a `this: Self` parameter, and returns `Self & RowSelection<CollectionRowOf<Self> & { [K in RelName]: ... }>`. The new row property holds only the rows so far plus the new relation key, not a `SimplifyDeep` of the whole row.
- `where`, `orderBy`, `limit`, `offset`, `distinct`, `distinctOn` and `cursor` get overload declarations with a type parameter `Self` and a `this: Self` parameter, and return `Self & HasWhere`, `Self & HasOrderBy` or `Self`. This replaces the polymorphic `this` return from the sections above. The implementations keep the polymorphic `this`, so private fields stay reachable. `cursor` and `distinctOn` read the flag as `CollectionStateOf<Self>`, with `Self extends StateCarrier`.
- Every public method that returns rows reads them as `CollectionRowOf<this>`: `all`, `first` (three overloads), `create` (two), `createAll`, `upsert`, `update`, `updateAll`, `delete`, `deleteAll`, and `prepared`. Each gets an overload declaration; the implementation keeps the class `Row`. The `select` overload that has a `this` parameter also infers the row, so `select` after `include` keeps the included relations.
- `declare readonly _row?: CollectionRowOf<this>`, so the framework's `ResultType<typeof q>`, which reads `_row`, sees the widened row.
- `combine` infers a branch's row from `RowSelection<infer BranchRow>` instead of from `CollectionImpl`'s type argument, and its constraint accepts an include refinement collection.

`src/collection-internal-types.ts`:

- `CollectionRowOf<C>` is `FlatRow<C[typeof RowType]>`. `FlatRow` is a shallow, distributive `{ [K in keyof R]: R[K] }`. The intersection `Row & { author: ... } & { comments: ... }` is flattened when it is read, so rows print and compare as plain objects. The pieces have no key in common, so a shallow flatten gives the same property types as today's rows.
- `IncludeRefinementValue` flattens a refined nested row the same way.
- `IncludeReceiver` (`{ readonly [RowType]: unknown }`) and `StateCarrier` (`{ readonly [StateType]: CollectionTypeState }`) are the constraints for `Self`.

`src/exports/index.ts` also exports `CollectionRowOf`, `IncludeReceiver`, `RowSelection` and `RowType`.

### Why a `this` type parameter and not the polymorphic `this`

Inside an include refinement, the collection is `Omit<Collection, terminals>`. `Omit` fixes the `this` type of every method to the plain `Collection`. With the polymorphic `this`, `posts.include('tags').orderBy(...)` inside a refinement returned `Collection & HasOrderBy` and lost `tags`. `examples/prisma7-adoption` does exactly this, and it failed with TS2339. With `this: Self`, `orderBy` keeps whatever type it was called on, so the row survives. It also means `include`, `select` and `where` work on a union of differently flagged collections: `Self` is inferred as the union.

I first tried to keep the polymorphic `this` and change the refinement type from `Omit<...>` to `Collection<...> & { all: never; ... }`. That fixed the row, but the `orm.test.ts` tests that narrow the refinement to a registered class with an `asserts` function failed with TS2589 ("Type instantiation is excessively deep"). I did not find the cause, and dropped it.

### What works and fails

| Case | Result |
| --- | --- |
| `db.Post.include('author').published()` | `PostCollection`; `first()` and `all()` return rows with `author`, equal to the plain collection's rows |
| `Post.include('author').published().include('comments')` | keeps the class; the row has `author` and `comments` |
| `Post.published().include('author')` | `PostCollection & HasWhere`; `delete`, `update` return the widened row |
| `Post.where(...).include('author').update(...)` | returns the widened row |
| `Post.include('author').published().select('id')` | row `{ id: number; author: ... }`; writes allowed |
| Plain collection rows | unchanged: `first()` on `db.Post` is the model row |
| `ResultType<typeof db.Post.include('author')>` and the nested and refined forms in `test/model-types.test-d.ts` | equal to the emitted `Shape<...>` types, as before |
| Inside a refinement: `posts.include('comments').orderBy(...)` | keeps `comments` |
| `include` on `Base \| Filtered`, `Filtered \| Ordered`, and on the class `published() \| recent()` union | works; it failed with TS2349 or TS2684 before |
| Include refinement with the registered class | still the plain refinement collection (unchanged, as asked) |
| Demo through `dist`: `db.User.include('posts').admins().newestFirst()`, `db.Post.include('user').forUser('u1').include('tags')`, `select` after `include`, an exported included chain | all compile |

### Casualties

All were fixed in the tests; each is a change users would see.

| What | Why | Where |
| --- | --- | --- |
| `ReturnType<typeof c.where>` and `ReturnType<C['orderBy']>` now give `HasWhere` or `HasOrderBy` alone | `ReturnType` of a method with a type parameter uses the parameter's constraint, `unknown` | the earlier spikes' tests; rewritten as `C & HasWhere`. I found no other use in the repository |
| Explicit type arguments on `include`, as in `typeof projects.include<'tasks'>` | `Self` is not inferred then, and defaults to `never`, so the result is `never` (a loud failure, not a silently wrong row) | `test/polymorphism.test-d.ts`, rewritten with a value: `const withTasks = projects.include('tasks')` |
| Reading the row from `Collection`'s third type argument | the row now lives in `[RowType]` | `RowOf` helpers in `test/include-cardinality.test-d.ts` and `test/generated-contract-types.test-d.ts` read `[RowType]` |
| Reading `[RowType]` directly after an include gives `Row & { author: ... }` | the flatten happens in `CollectionRowOf`, not in the property | the `pipe` spike's `RowOf` helper; its test wraps it in `FlatRow` |

### Measurements

Same method and scripts as above, two runs each, identical. Raw counts are in `this-typed-chaining-measurements.tsv.txt` under `include-this`.

| State | Package | Demo |
| --- | --- | --- |
| Branch point `9947eac755` | 1,529,500 | 745,802 |
| Tip before this change `d6b061c924` | 1,523,198 | 747,191 |
| include through this `492fa62bb1` | 1,249,149 (−274,049 against `d6b061c924`, −18.0%) | 675,347 (−71,844, −9.6%) |

Ten chained calls, as the increase over the probe with no chain:

| Probe | Package, `d6b061c924` | Package, now | Demo, `d6b061c924` | Demo, now |
| --- | --- | --- | --- | --- |
| Plain collection | +70 | +159 | +97 | +107 |
| Custom class, base methods only | +61 | +119 | +78 | +81 |
| Custom class, its own methods | +51 | +73 | +62 | +57 |

A single chain costs a little more, about 10 to 90 instantiations, because `Self` is inferred at each call. The whole programs cost much less. My guess is that two things save the most: `include` no longer builds a new `Collection<..., SimplifyDeep<Row & {...}>, S>` type with a deep `SimplifyDeep` at every call, and no method signature is built again for every receiver type. I did not measure the two separately.

### Not tested

- Run-time tests beyond the package's 1,117 and the typechecks; `pnpm test:integration` was not run.
- Editor display of the widened rows (they print as flat objects in compiler messages).
- Which part of the change saves the most.
- The cause of the TS2589 with the intersection-based refinement type.

### Recommendation

Adopt this version instead of the tip before it. Every row-reading method reads the row through `this`, `include` and the state-only methods take `this: Self`, and rows are flattened when read. It keeps the class through `include`, fixes `include` on unions and inside refinements after further chaining, and is cheaper than the branch point. Record upgrade instructions for the `ReturnType<C['where']>` pattern and for explicit type arguments on `include`.
