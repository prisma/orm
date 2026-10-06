# Spike: `pipe` and small helpers for query fragments

**Date:** 2026-09-30
**Branch:** `spike-pipe-fragments`, started from `bot/spike-scope-helper-api` at `8641d5420e`.
**Question:** Prisma 7 users build query fragments as plain objects. In Prisma 8 a fragment is a function. Does a general `pipe(fn)` on collections, plus small typing helpers, serve the five common idioms: a `where` filled in from request values, the same with conditional spreads, a repeated fixed filter such as `deletedAt: null`, a named `select`/`include` with a derived row type, and a sort field taken from the request?

## Answer

Mostly yes, but `pipe` alone is not enough, and the conditional idioms need a different tool. `pipe` itself is cheap: it costs 608 instantiations in the demo when unused (+0.08%) and about 7 per call when chained. Conditional steps written with a ternary (`search ? c.where(...) : c`) type-check, but they are expensive (about 11,000 instantiations per use in the demo) and they are not always sound: TypeScript collapses the two branches into one of them, and for a custom collection class, or for a `where` branch against an `orderBy` branch, it keeps the branch that unlocks `update`. `pipe` does not cause this; a bare conditional does the same. A `when(value, step)` helper fixes it. Its result has the input's type, so the type state only records what is certain, custom classes keep their methods, and a step that changes the row is rejected. As a method on `Collection` it costs about 90 instantiations per use in the demo and 610 when unused; as a step for `pipe` it costs about 5,500 per use. A codec-keyed field type, `FieldExpression<Contract, 'pg/timestamptz@1', true>`, lets a plain function act as a row fragment for any model with that field. The real field type is assignable to it in both directions, including query operations, and it costs almost nothing. A `fragment` builder for collection fragments works everywhere, but it does not update the type state, and one definition costs about 10,000 instantiations in the demo for a reason I did not find. A `rowFragment` helper for named `select`/`include` sets works everywhere and is cheaper than writing the chain inline. A `sortField` helper checks a request string at run time and gives a typed `orderBy` selector. I recommend `pipe`, a `when` method, `FieldExpression`, `rowFragment` with `RowOf`, and `sortField`, and not the `fragment` builder for now.

## What was built

All code is in `packages/3-extensions/sql-orm-client`. The Postgres facade re-exports that package, so the demo sees the helpers as `@prisma/orm-postgres/orm-client`.

- `src/pipe-fragments.ts`: `when`, `fragment`, `stateFragment`, `rowFragment`, `sortField`, and their types (`FragmentQuery`, `FragmentRow`, `CollectionFragment`, `StateFragment`, `RowFragment`, `RowOf`).
- `src/types.ts`: three new exported types. `FieldExpression<TContract, CodecId, Nullable>` is the codec-keyed field type. `ModelFieldCodec<TContract, ModelName, FieldName, NsId>` gives a model field's codec id and nullability. `SortableFieldName<TContract, ModelName, NsId>` names the fields whose codec has the `order` trait. `FieldExpression` reuses the private `OpMatchesField` and `QueryOperationMethod` through a new private `CodecOperations`, which is `FieldOperations` keyed by codec id instead of by field.
- `test/fixtures/soft-delete/contract.d.ts`: a copy of the generated test contract with a nullable `deletedAt` (`pg/timestamptz-date@1`, column `deleted_at`) on `Post` and `Comment`. It was made by `contract-soft-delete.mjs.txt`. The emitter and PSL were not changed.
- `test/pipe-fragments-fixture.ts`: the same field added to the contract JSON at run time, a client, and a custom `SoftPostCollection`.
- `test/pipe-q1-conditional.types.test-d.ts`, `pipe-q2a-row-fragment.types.test-d.ts`, `pipe-q2b-collection-fragment.types.test-d.ts`, `pipe-q3-row-fragment.types.test-d.ts`, `pipe-q5-sort-field.types.test-d.ts`: type tests with `@ts-expect-error` negatives and `not.toBeAny()` checks.
- `test/pipe-fragments.test.ts`: 8 runtime tests. They check the SQL AST for `when`, `fragment` (including inside an include refinement), `rowFragment` and `sortField`, and the runtime errors. All pass.

The whole package typechecks with the new tests. `demo-probe-pipe.test-d.ts.txt` repeats the main checks inside `examples/prisma-8-demo` through the built `dist` output, with `deletedAt` added to the demo's `Post` in `contract.d.ts` (codec `pg/timestamptz-temporal@1`). It passes with the patch and fails with 9 errors without it.

Two experiments were committed, measured and then removed with new commits: `when` as a method on `Collection` (`840d372bb8`, removed in `1b727276fc`), and `where`/`orderBy` accepting `undefined` (`942acd62ee`, removed in `d9c0ce2ac6`). A third experiment, a declared `_state?: State` property on the collection class, was tried in the working tree only.

## 1. Conditional steps

### What the user writes

```ts
// a. conditional steps inside pipe
db.Post.pipe((c) => (search ? c.where((p) => p.title.eq(search)) : c))
  .pipe((c) => (sort ? c.orderBy((p) => p.id[sort]()) : c))
  .limit(10);

// b. the plain chain with let
let q = db.Post;
if (search) q = q.where((p) => p.title.eq(search));
if (sort) q = q.orderBy((p) => p.id[sort]());
q.limit(10);

// c. unconditional steps, for comparison
db.Post.where((p) => p.title.eq('x')).orderBy((p) => p.id.desc()).limit(10);

// d. the fix: when, as a pipe step or as a method
db.Post.pipe(when(search, (c, s) => c.where((p) => p.title.eq(s))))
  .pipe(when(sort, (c, dir) => c.orderBy((p) => p.id[dir]())));
db.Post.when(search, (c, s) => c.where((p) => p.title.eq(s)))
  .when(sort, (c, dir) => c.orderBy((p) => p.id[dir]()));
```

`when` passes the value to the step with falsy values removed from its type, so `s` is a `string` and `dir` is `'asc' | 'desc'`.

### The union does not survive a conditional

A ternary does not produce a union of two collection types. TypeScript reduces the union to one of its members, because collections of the same model that differ only in type state are assignable to each other. The type state appears only inside conditional parameter types (`update(data: State['hasWhere'] extends true ? ... : never)`), and method parameters are compared in both directions. So `const unfiltered: Filtered = db.Post` compiles.

Which member TypeScript keeps depends on the shapes, not on the code:

| Branches | Type kept | Effect |
| --- | --- | --- |
| `search ? Post.where(...) : Post`, either order | the unfiltered type | Sound. `update`, `delete` and `cursor` stay locked. |
| `search ? custom.Post.where(...) : custom.Post` (custom class) | the filtered base `Collection` | Unsound: `update` is unlocked although the filter may be missing. The custom methods are gone (TS2339). |
| `flag ? Post.where(...) : Post.orderBy(...)` | the filtered type | Unsound: `update` is unlocked although one branch has no filter. |

All later methods are callable on the kept type, with that type's state: `where`, `orderBy`, `select`, `include`, `limit`, `all` and `first` work; `update`, `delete` and `cursor` work only if the kept type unlocks them.

A union survives only when the user writes it, for example `Post as Base | Filtered`. Then `include` fails with TS2349, "Each member of the union type ... has signatures, but none of those signatures are compatible with each other." `where`, `orderBy`, `select`, `limit`, `offset`, `all`, `first`, `aggregate`, `groupBy`, `distinct`, `create` and `pipe` still work on that union.

`pipe` causes none of this. It returns what the step returns, and `search ? Post.where(...) : Post` without `pipe` gives the same type (tested).

### What works and what fails

- **a** type-checks. It has the soundness problems above. It is the most expensive form.
- **b** type-checks for a plain collection: `q` keeps its declared type, so the state stays sound. For a custom class it fails: `q = q.where(...)` gives TS2741 (or TS2739 with several custom methods), because `where` returns the base `Collection`, not the subclass. Declaring `let q: Collection<Contract, 'Post'> = this` compiles but drops the custom methods.
- **c** records every step: `cursor` and `update` are available.
- **d** `when` works on a root collection, a chained collection, a collection after `select`, an include refinement, a custom class root (the result is still `SoftPostCollection`) and `this` in a custom class (the result is still the class). The result keeps the input's state, so `update` and `cursor` stay locked unless they were already unlocked. A step that changes the row, such as `select('id')`, fails with TS2322: `Type 'Collection<Contract, "Post", { id: number; }, ...>' is not assignable to type 'RowSelection<DefaultModelRow<Contract, "Post", "public">>'`. The row check uses the declared `[RowType]` property; for `this`, TypeScript relates the row through the class's base type.

### Other fixes tried

- **`where` and `orderBy` accept `undefined`** (`942acd62ee`): `Post.where(search ? (p) => p.title.eq(search) : undefined).orderBy(sort ? (p) => p.id[sort]() : undefined)`. A new last overload returns the unchanged state. It works on root, chained, include refinement and `this`, and it is cheap per use. But it costs every `where` and `orderBy` call: +114,164 instantiations in the package (+7.5%) and +1,784 in the demo (+0.24%) when unused. It changes `ReturnType<typeof c.where>` to the new overload, which broke several of my own type aliases. It returns the base `Collection`, so custom methods are still lost. It covers only these two methods.
- **A checked type state** (working tree only): a declared `_state?: State` property makes the state part of assignability. Then a conditional produces a real union, and `include` on it fails with TS2349 (the other tested methods still work). `let` reassignment fails with TS2375. Functions typed with the root collection type reject filtered collections (TS2684). 17 existing casts in `test/collection-variant.test.ts` fail with TS2352. It would make the soundness problems visible, but it makes conditional code harder, so `when` would be needed anyway.
- **An overload of `pipe`** cannot help. TypeScript has already reduced the step's return type before `pipe` sees it.

The cleanest fix is `when` as a method. It keeps the caller's type, including custom classes and `this`. It records only what is certain. It rejects row changes. It needs no change to `where` or `orderBy`. It is the cheapest per use. The same function also works as a `pipe` step, but that form is about 60 times more expensive per use in the demo (see below).

### Cost

Instantiations over a probe where every site uses the unconditional chain c. "Further use" is (10 uses − 1 use) / 9.

| Form | Package, 1 use | Package, 10 uses | Package, further use | Demo, 1 use | Demo, 10 uses | Demo, further use |
| --- | --- | --- | --- | --- | --- | --- |
| a. ternary in `pipe` | +28,819 | +170,140 | 15,702 | +23,598 | +126,060 | 11,385 |
| b. `let` and `if` | +19,628 | +95,812 | 8,465 | +16,016 | +83,971 | 7,551 |
| d. `when` as a `pipe` step | +290 | +10,890 | 1,178 | +173 | +49,404 | 5,470 |
| d. `when` as a method | +49 | −2,745 | −310 | +56 | +842 | 87 |
| `where`/`orderBy` with `undefined` | +41 | −3,286 | −370 | +41 | +278 | 26 |

a and b are expensive because each site makes TypeScript compare two large collection types structurally: the ternary to reduce the union, the assignment to check it. `when` as a method compares only the row types. The method and `undefined` rows were measured in their own states (`840d372bb8`, `942acd62ee`) against the plain probe of that state.

## 2. Fragments matched by field shape

### a. A row fragment with a codec-keyed field type

```ts
type DeletedAt = FieldExpression<Contract, 'pg/timestamptz@1', true>;
const notDeleted = (p: { readonly deletedAt: DeletedAt }) => p.deletedAt.isNull();

db.Post.where(notDeleted);
db.Post.where((p) => and(notDeleted(p), p.title.eq(t)));
```

`FieldExpression` is built the same way as the row accessor's field type in `ScalarModelAccessor`, but from the codec id instead of a model field:

```ts
export type FieldExpression<TContract, CodecId extends string, Nullable extends boolean = false> =
  Expression<{ codecId: CodecId; nullable: Nullable }> &
  ComparisonMethods<CodecOutput<TContract, CodecId> | (Nullable extends true ? null : never), CodecTraitSet<TContract, CodecId>, CodecId> &
  CodecOperations<TContract, CodecId>;
```

What works:

- The real field type and `FieldExpression` are assignable to each other in both directions (tested with `toExtend` both ways). This includes the query operations: in the demo, `(p: { title: FieldExpression<Contract, 'pg/text@1'> }) => p.title.fullTextMatches(websearchToTsquery(q))` is accepted by `db.orm.public.Post.where(...)`.
- It works on a root collection, a chained collection, an include refinement, `this` in a custom class, and on two models that have the field (`Post` and `Comment`).
- It is rejected for a model without the field (`Tag`, `User`), for another codec (a `pg/int4@1` fragment on the text `title`), and for other nullability (a non-nullable `deletedAt` fragment on the nullable field).

What fails: the error for a missing field is poor. `db.Tag.where(notDeleted)` gives TS2769, "No overload matches this call. The last overload gave the following error", followed by a message about the shorthand filter object: `Type '(p: ...) => AnyExpression' has no properties in common with type 'Partial<{ name: ...; id: ...; }>'`.

Cost: about 350 instantiations once, then 1 to 3 per further use, in both the package and the demo. Nothing when unused in the demo.

### b. A collection fragment applied with `pipe`

```ts
const notDeleted = fragment<Contract>()(
  { deletedAt: { codecId: 'pg/timestamptz@1', nullable: true } },
  (c) => c.where((p) => p.deletedAt.isNull()).orderBy((p) => p.deletedAt.desc()),
);

db.Post.pipe(notDeleted);
db.Tag.pipe(notDeleted); // error
```

The contract is passed by a curried call, because the body's row type needs the codec types and operations and TypeScript cannot infer some type arguments while the user gives others. The body receives a `FragmentQuery`: an object with only `where`, `orderBy`, `limit` and `offset`, whose row has only the declared fields, typed with `FieldExpression`. At run time the body receives the real collection, and the fragment first checks that the model has the declared fields, throwing `ORM.FIELD_UNKNOWN` otherwise.

What works:

- The result has exactly the caller's type: a root collection, a chained collection (after `where` and `select`), a custom class root (still `SoftPostCollection`, with its methods), `this` in a custom class, and an include refinement.
- `db.Tag.pipe(notDeleted)` fails with TS2345, ending in `Property 'fragmentFieldMissing' is missing ... but required in type '{ readonly fragmentFieldMissing: "deletedAt"; }'`.
- The body cannot call `select` or `include` (TS2339, `Property 'select' does not exist on type 'FragmentQuery<...>'`) or use an undeclared field.
- Calling the fragment directly, `notDeleted(collection)`, works too and costs the same as `pipe`.

What does not work:

- The type state is not updated. After `pipe(notDeleted)`, `update` and `cursor` stay locked, although the fragment added a filter and an order.
- `stateFragment`, a variant whose result is `Collection<Contract, Model, Row, State with hasWhere and hasOrderBy set>`, unlocks `update` and `cursor` on a root collection, a chained collection and `this`. But the result is the base `Collection`, so a custom class root loses its methods (like `where` itself does), and it fails in an include refinement with TS2345: the refinement collection is an `Omit<Collection, ...>`, so it is `missing the following properties from type 'CollectionImpl<...>': contract, #installAggregateReducers, ...`.

Cost (over inline `where` and `orderBy` at the same sites): package +801 for the definition and one use, about 1,130 per further use; demo +10,837 and about 5,450 per further use. The definition alone costs 245 in the package and 10,274 in the demo. I narrowed the demo cost to the call that builds the fragment: the same call with an identity body, with explicit type arguments, or through `stateFragment` costs the same 10,000; declaring a value of the fragment type, or using `FragmentQuery` and `FragmentRow` directly, costs about 400. Declaration output is not the cause: it adds a constant 7,200 to every demo probe and does not change the differences. I did not find the cause.

## 3. Fragments that change the row type

```ts
const summary = rowFragment<Contract, 'Post'>()((c) => c.select('id', 'title').include('user'));
type PostSummary = RowOf<ReturnType<typeof summary>>;

db.Post.pipe(summary);
db.Post.where({ userId }).pipe(summary);
db.User.include('posts', (posts) => posts.pipe(summary));
```

The caller writes the contract and the model once. The body is typed against the plain `Collection<Contract, 'Post'>`, once. Applying it takes any `Post` collection, checked by its contract, model name and namespace, which are inferred as separate type parameters as the earlier spike recommended.

What works: a root collection, a chained collection, a collection after `select` (the step's `select` replaces the earlier one), an include refinement, and `this` in a custom class. The result row equals the row of the same chain written inline. `RowOf` names that row. `db.Comment.pipe(summary)` fails with TS2345: `The intersection ... was reduced to 'never' because property 'modelName' has conflicting types in some constituents.`

What does not work: the caller's type state is not kept. The result has the default state, so `db.Post.where(...).pipe(summary).update(...)` stays locked.

Plain functions without a helper:

| How the parameter is typed | Result |
| --- | --- |
| `(c: Pick<typeof db.Post, 'select'>) => c.select('id', 'title').include('user')` | Works everywhere, including after `select` and in an include refinement. Rejects `Comment` (TS2684). No helper needed. |
| `(c: typeof db.Post) => ...` | Fails after `select` (TS2684, the narrower `_row`) and in an include refinement (TS2684, the refinement collection lacks `contract`, `groupBy` and 42 more). |
| `(c: Collection<Contract, 'Post'>) => ...` | Fails on the client root: `Type '"public"' is not assignable to type 'never'` for `namespaceId` (TS2684). |
| `<C extends Collection<Contract, 'Post', unknown, CollectionTypeState>>(c: C) => ...` | The body fails: with the state as a type parameter, `include('user')` gets TS2345, parameter of type `never`. |

These errors appear as TS2684 on the `this` argument, not on the step, because `pipe` infers `Self` from both.

Cost (over the same `select` and `include` written inline): `rowFragment` +270 for the definition and one use in the demo, then about −1,060 per further use, because the body is typed once instead of once per site. The definition alone costs 164 in the demo. The `Pick` function costs about 4,800 per use in the demo, because each site compares the collection's `select` method with the picked one.

## 4. Cost of chaining

Ten steps (`where`, `orderBy`, `limit`, `offset`, and so on) on one collection:

| Probe | Package | Demo |
| --- | --- | --- |
| Ten steps chained directly, over no chain | +1,916 | +399 |
| The same ten steps, each in its own `pipe`, over no chain | +1,984 | +467 |
| Cost of the ten `pipe` calls | +68 | +68 |

`pipe` present but unused, re-measured at the branch point: +2,113 in the package (+0.14%) and +608 in the demo (+0.08%). The demo number matches the earlier spike.

## 5. A sort field from a string

```ts
db.Post.orderBy(sortField(db.Post, input.sort, input.direction));
db.Post.orderBy(sortField(db.Post, input.sort, 'desc', ['title', 'createdAt']));
```

`sortField(collection, name, direction?, allowed?)` returns `(row: { readonly [K in Allowed]: Orderable }) => OrderByItem`. `Allowed` defaults to every sortable field of the model.

- The typed side: the `allowed` list only takes fields whose codec has the `order` trait. `'nope'` and `'embedding'` fail with TS2322, `Type '"nope"' is not assignable to type 'SortableFieldName<Contract, "Post", "public">'`. A relation name also fails. The selector only fits a model that has the allowed fields: `db.Tag.orderBy(sortField(db.Post, ...))` fails with TS2345, `Property 'title' is missing in type 'ModelAccessor<Contract, "Tag", "public">'`.
- The run-time side: an unknown name, a field without the `order` trait, a relation, or a name outside `allowed` throws `ORM.ARGUMENT_INVALID` with `Cannot sort Post by "nope"`. The trait is read from the context's codec descriptors.
- It works on a root collection, a chained collection, an include refinement and `this`. Because it goes through `orderBy`, `cursor` is unlocked afterwards.

Cost (over `orderBy((p) => p.title.desc())`): about 1,250 for the first use and 80 to 100 per further use, in both the package and the demo.

## Summary table

| Idiom and form | Works on root, chained, include, `this` | Result type | Type state | Rejects the wrong model or row change | Demo cost per further use | Unused cost in the demo |
| --- | --- | --- | --- | --- | --- | --- |
| 1a. Ternary in `pipe` | Yes | One branch, picked by TypeScript | Unsound for custom classes and mixed branches | Not applicable | 11,385 | 0 |
| 1b. `let` and `if` | Not for custom classes (TS2741) | Declared type | Sound | Not applicable | 7,551 | 0 |
| 1d. `when` as a `pipe` step | Yes | Input type | Sound, only what is certain | Yes (TS2322) | 5,470 | 0 |
| 1d. `when` as a method | Yes | Input type | Sound, only what is certain | Yes (TS2322) | 87 | +610 |
| 1d. `where`/`orderBy` with `undefined` | Yes, custom methods lost | Base `Collection` | Sound | Not applicable | 26 | +1,784 (package +114,164) |
| 2a. Row fragment with `FieldExpression` | Yes | Same as `where` | As `where` | Yes (TS2769, poor message) | 1 | 0 |
| 2b. `fragment` | Yes | Caller's type | Not updated | Yes (TS2345, TS2339) | 5,450, plus 10,274 per definition | 0 |
| 2b. `stateFragment` | Not in include refinements | Base `Collection` | Updated | Yes | not measured | 0 |
| 3. `rowFragment` | Yes, also after `select` | New row, default state | Caller's state lost | Yes (TS2345) | −1,058 | 0 |
| 3. `Pick<typeof db.Post, 'select'>` function | Yes | New row, root state | Caller's state lost | Yes (TS2684) | 4,807 | 0 |
| 4. `pipe` chain | Yes | Step's type | As the steps | Not applicable | about 7 per `pipe` | +608 |
| 5. `sortField` | Yes | As `orderBy` | `hasOrderBy` set | Yes (TS2322, TS2345, run-time error) | 97 | 0 |

## Measurements

Instantiation counts from `tsc --extendedDiagnostics`, TypeScript 5.9.3. Every count was measured twice and both runs gave the same number. "Package" is the typecheck of `packages/3-extensions/sql-orm-client` with the spike tests (`test/fulltext-search*`, `test/pipe-*`) excluded. "Demo" is the typecheck of `examples/prisma-8-demo` against the built `dist` output. A probe is copied to `test/zz-probe.test-d.ts`, so it is always checked after the existing tests. Demo probes run with `deletedAt` added to `Post`. Check times are left out: the load average was 24 to 31 during the runs.

### States

| State | Package | Demo |
| --- | --- | --- |
| Branch point, `pipe` removed | 1,514,560 | 744,593 |
| Branch point `8641d5420e` (with `pipe`) | 1,516,673 (+2,113) | 745,201 (+608) |
| Spike helpers `cfa8961584`, unused | 1,527,498 (+10,825 over the branch point, +0.71%) | 745,201 (+0) |
| `when` method `840d372bb8`, unused | 1,529,624 (+2,126 over the helpers) | 745,811 (+610, +0.08%) |
| `where`/`orderBy` with `undefined` `942acd62ee`, unused | 1,641,662 (+114,164, +7.47%) | 746,985 (+1,784, +0.24%) |

The package's +10,825 for the helpers is the cost of checking their source, which only this package pays.

### Probes

Each probe has ten sites: (1) the root, (2) after `where`, (3) after `select`, (4) an include refinement, (5) `this` in a class method, (6) after `orderBy`, (7) an include refinement after `where`, (8) `this` followed by `limit`, (9) the root with `first`, (10) after `where` and `limit`. With N uses, the first N sites use the form and the rest use the plain form; a form's definitions are written only when N > 0. The numbers are the increase over the probe with 0 uses in the same state.

| Case | Plain form | Package, 1 use | Package, 10 uses | Demo, 1 use | Demo, 10 uses |
| --- | --- | --- | --- | --- | --- |
| 1a | unconditional chain | +28,819 | +170,140 | +23,598 | +126,060 |
| 1b | unconditional chain | +19,628 | +95,812 | +16,016 | +83,971 |
| 1d `when` step | unconditional chain | +290 | +10,890 | +173 | +49,404 |
| 1d `when` method | unconditional chain | +49 | −2,745 | +56 | +842 |
| `where`/`orderBy` with `undefined` | unconditional chain | +41 | −3,286 | +41 | +278 |
| 2a | inline `where` | +332 | +361 | +352 | +362 |
| 2b `fragment` with `pipe` | inline `where` and `orderBy` | +801 | +11,011 | +10,837 | +59,889 |
| 2b `fragment` called directly | inline `where` and `orderBy` | +787 | +11,195 | +10,823 | +60,070 |
| 3 `rowFragment` | inline `select` and `include` | +306 | −20,783 | +270 | −9,249 |
| 3 `Pick` function | inline `select` and `include` | +19 | +41,912 | +19 | +43,278 |
| 5 `sortField` | `orderBy` on `title` | +1,252 | +1,944 | +1,239 | +2,108 |

The 0-use probes counted 1,568,190 to 1,584,906 in the package and 758,884 to 765,215 in the demo.

Costs are not additive across sites. With one site at a time, `when` as a `pipe` step costs 86 to 179 in the demo at every site except two: −652 at site 4 and +10,647 at site 7, an include refinement after `where`. Together the ten sites cost 49,404. `fragment` shows the same pattern: 10,000 to 10,800 at every site (mostly the definition) and 21,324 at site 7. The `when` method, which passes no generic function as an argument, costs 842 for all ten sites.

## Not tested

- `GroupedCollection`, prepared collections, polymorphic variants (`.variant()`), contracts with several namespaces, and the Mongo ORM client.
- Steps inside `when` or `fragment` that use relation filters (`some`, `every`) or `and`/`or` combinations.
- Autocomplete in the editor, check times and editor latency.
- The demo at run time. It was only typechecked; its `contract.json` was not changed.
- The cost of `stateFragment`.
- The cause of the 10,000-instantiation cost of one `fragment` definition in the demo.
- The full test suites. Only the package typecheck, the demo typecheck and the new runtime tests were run.
- `when` used together with the earlier spike's full-text helpers.

## Recommendation

Add, in this order:

1. **Keep `pipe`**, typed with a `this` parameter. It costs +0.08% in the demo when unused and about 7 instantiations per call, and it lets fragment values compose.
2. **Add `when` as a method on `Collection`**. The conditional idioms (1 and 2 in the research ranking) are the most common, and the obvious code, a ternary, is both expensive and unsound in two cases. `when` keeps the caller's type and states only what is certain. It costs +610 in the demo when unused and about 90 per use. Export the same function as a `pipe` step only if composition needs it; it costs about 60 times more per use.
3. **Add `FieldExpression`**. Row fragments typed by codec cover the fixed-filter idiom (3) for any model with the field, with operations, at almost no cost. Improve the missing-field error, which today reports the shorthand overload.
4. **Add `rowFragment` and `RowOf`** for the named `select`/`include` idiom (4). They work everywhere, the row type can be named, and they are cheaper than the inline chain. Document the `Pick<typeof db.Post, 'select'>` pattern for users who want no helper, and its cost.
5. **Add `sortField`** for the request sort idiom (5). It is small, checks at run time, and costs about 100 per use.

Do not add the `fragment` builder yet. Row fragments with `FieldExpression` already cover the common filter case, the builder does not update the type state, `stateFragment` fails in include refinements, and a single definition costs about 10,000 instantiations in the demo for an unknown reason. Do not make `where` and `orderBy` accept `undefined`: it costs +7.5% in the package and changes `ReturnType` of `where`.

Separately from `pipe`: the type state is not checked by assignability, so a ternary between a custom class and its filtered collection, or between a `where` branch and an `orderBy` branch, unlocks `update` in code that exists today. This deserves its own ticket. Making the state checked is not a drop-in fix (see "Other fixes tried").

## Files

- `measure-pipe.sh.txt`: measures one state: the package and the demo twice each, and every probe in a directory twice. The package and the demo run in parallel.
- `gen-pipe-probes.mjs.txt`: writes the probes. With no arguments it writes the main cases and case 4; `name@k` writes a probe where only site k uses the form.
- `contract-soft-delete.mjs.txt`: adds a nullable `deletedAt` to named models of an emitted `contract.d.ts`. It made the package fixture and patches the demo during measurement.
- `demo-probe-pipe.test-d.ts.txt`: the main checks inside the demo through `dist`.
- `print-probe-pipe.test-d.ts.txt` and `print-probe-pipe.errors.txt`: the deliberate errors used to read the messages and printed types above.
- `pipe-fragments-measurements.tsv.txt`: every count, per state and run.

Commits on the branch: `cfa8961584` (helpers and tests), `840d372bb8` and `1b727276fc` (`when` method, added and removed), `942acd62ee` and `d9c0ce2ac6` (`where`/`orderBy` with `undefined`, added and removed), and the commit with this file.
