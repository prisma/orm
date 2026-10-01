# Spike: how an extension author writes an index scope helper

**Date:** 2026-09-29
**Branch:** `spike-scope-helper-authoring`, started from `bot/model-scopes-design` at `037cad4edd`.
**Question:** how does an extension author write `fulltextSearchScopes(collection).<indexName>(q, options)` so that its types come from the way the function is written, with as little hand-written type-level code as possible?

## Answer

The author can write ordinary functions and let one ORM client builder derive the helper's type, with one exception. When an operation's arguments depend on the literal index, TypeScript cannot apply the author's generic function to the literal index inside the builder's types. Every trick that tries this (conditional `infer`, curried functions, instantiation expressions on the builder's parameter) falls back to the constraint and loses the literal types. What does work is an instantiation expression written by the author on their own named function: `typeof fulltext<this['index']>`. So the recommended building block is `defineIndexOperation<Kind>({ match, operation })`. The author writes an ordinary generic function, a type guard, and a three-line interface whose only member is `readonly operation: typeof fulltext<this['index']>`. The builder derives the members, the argument lists (with literal option types) and the "same collection type out as in" result from that. It needs no casts, the consumer types are exact on root, chained and include-refinement collections, it survives the build to `dist/*.d.mts` and is consumed cleanly by `examples/prisma-8-demo`, and it costs about 1,000 instantiations when defined and about 1,700 more for ten uses. When the arguments do not depend on the index, a simpler builder (`defineIndexScopes`) needs no type-level code at all.

## Comparison

"Type lines" counts lines the author writes that exist only for the type checker, not counting the match shape type and its type guard, which every approach needs (7 lines plus the guard function). "Instantiations" is the `sql-orm-client` package typecheck; see "Measurements".

| # | Approach | Type lines | Casts | Literal option types | Exact collection type out | Root / chained / include / custom `this` | Runtime args checked against types | Unused cost | Helper cost for ten uses |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Hand-written mapped type (control) | 17 | 1 | yes | yes | yes / yes / yes / needs `<PostCollection>` | no (the cast hides it) | +742 | +724 |
| 2 | Builder, non-generic operation | 0 | 0 | not applicable | yes | yes / yes / yes / needs `<PostCollection>` | yes | +1,055 | +1,149 |
| 3a | Builder, generic operation | 0 | 0 | **no**, widened to `string` | yes | as 2 | yes | not measured | not measured |
| 3b | Builder, curried generic operation | 0 | 0 | **no**, widened to `string` | no, the builder only sees `{ filter }` | not tested | yes | not measured | not measured |
| 3c | Builder, instantiation expression on its own parameter | 0 | 0 | **no**, resolves to the constraint | no | not tested | no | not measured | not measured |
| 3d | Builder, placeholder types (`IndexElement<'options.fields'>`) | 0 | 0 | yes | yes | as 2 | yes | +1,059 | +1,395 |
| 3e | Builder, interface with `this` slots | 12 | 0 | yes | yes, but the alias name is lost (see errors) | as 2 | **no**, types written twice | +719 | +996 |
| 4a | Several operations, placeholder types | 0 | 0 | yes | yes | root tested; the others not tested | yes | +1,073 | +1,498 |
| 4b | Several operations, instantiated kind | 4 | 0 | yes | yes | root (runtime test), chained and include tested; custom `this` not tested | yes | +1,014 | +1,800 |
| 5 | Operation returns a collection | 0 | 0 | yes (with placeholders) | declared, **not checked** | as 2 | no, return type trusted | +16,913 | +17,249 |
| **6** | **Instantiated kind: `typeof fulltext<this['index']>`** | **3** | **0** | **yes** | **yes** | **as 2** | **yes** | **+971** | **+1,693** |

"Unused cost" is against the branch point (1,511,763). "Helper cost for ten uses" is against a control file with the same ten collection expressions and no helper call (1,543,842). The chained, selected and included collections in those ten expressions cost about 31,500 instantiations on their own; the helpers add 0.05% to 0.12% on top. Only approach 5 costs noticeably more, because naming a collection of "any model, any state" is expensive.

All consumer checks are type tests in `packages/3-extensions/sql-orm-client/test/helper-authoring/*.test-d.ts`. Each approach runs the same checks: only matching indexes are offered; wrong names are rejected (physical name, btree index, brin index); the result equals the input collection type (`toEqualTypeOf<typeof input>`); option types come from the literal index (`only: 'body'` is an error on an index over `title` alone); nothing is `any`; a model with no matching index has no members. `runtime.test.ts` checks that five of the helpers add the filter and order to the real query plan, including inside an include refinement.

## Setup

- **Fixture contract.** `test/helper-authoring/fixture.ts` replaces the `posts` indexes of the test contract type with: the existing btree index, `post_title_body_search` (gin, `options: { fields: [['title','subtitle'],['body']], language: 'english' }`), `post_title_search` (gin, `fields: [['title']]`, `language: 'simple'`) and a brin index. The runtime test adds two of them to the contract JSON before hydration. The emitter and PSL were not changed. `Collection` was not changed.
- **Shared ORM client code** (`src/helper-authoring/core.ts`, about 25 type lines): `IndexData` (the runtime index fields), `ScopeRefinement` (`{ filter, orderBy? }`), `IndexScopeContext<Index>` (`{ index, tableName }`), `CollectionIndexes<C>` (reads contract, model and namespace from any collection value's type, including the `Omit<...>` type of an include refinement) and `IndexScopeName<Index>` (`prefix`, else `name`). `types.ts` gains `ModelTableIndexes`, which reuses the existing model-to-table resolution.
- **Choice: the first argument of an operation is `{ index, tableName }`, not the bare index.** The author needs the table name to build column references. This keeps the rest of the argument list free for the consumer's arguments.
- **Choice: an operation returns a `{ filter, orderBy }` value** (except in approach 5). The builder applies it with `where` and `orderBy`.
- **The helper is a free function**, `helper(collection)`. It returns an object with one member per matching index.

## The author's code for each approach

Imports are left out. `FullTextIndexShape` and `isFullTextIndex` are in `fixture.ts`:

```ts
export type FullTextIndexShape = IndexData & {
  readonly type: 'gin';
  readonly options: { readonly fields: readonly (readonly string[])[]; readonly language: string };
};
export function isFullTextIndex(index: IndexData): index is FullTextIndexShape { ... }
```

### 1. Hand-written types (control)

17 type lines, 1 cast. The author must know `Extract`, key remapping with `as`, conditional `infer`, and two ORM client helper types. The runtime member type (`only?: string`) and the declared member type are unrelated; the cast hides any mismatch.

```ts
type FullTextFields<Index> = Index extends {
  readonly options: { readonly fields: readonly (readonly (infer Field)[])[] };
}
  ? Field
  : never;

export type FulltextSearchScopes<C> = {
  readonly [Index in Extract<CollectionIndexes<C>[number], FullTextIndexShape> as IndexScopeName<Index>]: (
    query: FakeTsQuery,
    options?: { readonly only?: FullTextFields<Index> },
  ) => C;
};

export function fulltextSearchScopes<C extends object>(collection: C): FulltextSearchScopes<C> {
  const { indexes, tableName } = collectionScopeTarget(collection);
  const members: Record<string, (query: FakeTsQuery, options?: { readonly only?: string }) => C> = {};
  for (const index of indexes) {
    if (!isFullTextIndex(index)) continue;
    members[scopeNameOf(index)] = (query, options) =>
      applyRefinement(collection, {
        filter: textSearchFilter(tableName, options?.only ?? index.options.fields[0]?.[0] ?? 'id', query),
        orderBy: rankOrder(tableName, 'id'),
      });
  }
  return members as FulltextSearchScopes<C>;
}
```

### 2. Builder with a non-generic operation

No type lines. Inference gets everything: the matched shape from the type guard, the argument list from the annotated parameters, and `C` from the call.

```ts
export const fulltextSearchScopes = defineIndexScopes({
  match: isFullTextIndex,
  operation: ({ index, tableName }, query: FakeTsQuery, options?: { readonly language?: string }) => ({
    filter: textSearchFilter(tableName, index.options.fields[0]?.[0] ?? options?.language ?? 'id', query),
    orderBy: rankOrder(tableName, 'id'),
  }),
});
```

One limit of inference: an inline type guard with an unannotated parameter, `match: (index): index is FullTextIndexShape => ...`, still gives the right helper type, but the operation's `index` is then typed as the plain `IndexData`. TypeScript types the operation before it has fixed `Match`. The author sees errors TS18048, TS18046 and TS4111 on `index.options.fields`. Annotating the parameter (`(index: IndexData): index is ...`) or passing a named guard fixes it. Probe: `helper-probe-inline-type-guard.ts.txt`. The same inline guard works in the several-operation builder (4a).

The builder's signature:

```ts
export function defineIndexScopes<Match extends IndexData, Args extends readonly unknown[]>(definition: {
  readonly match: (index: IndexData) => index is Match;
  readonly operation: (scope: IndexScopeContext<Match>, ...args: Args) => ScopeRefinement;
}): <C extends object>(collection: C) => IndexScopes<C, Match, Args>;
```

### 3. Arguments that depend on the literal index

**3a. A generic operation passed to the builder of approach 2.** It compiles, but `only` becomes `string`, and `{ only: 'not-a-field' }` is accepted. TypeScript infers `Args` from the generic function's base signature, where `I` is replaced by its constraint.

**3b. A curried operation** `<I>(scope) => (query, options?) => ...`, with the builder reading the inner function type for each literal index through `Operation extends (scope: IndexScopeContext<Index>) => infer Inner`. Same result: `only?: string`. In plain TypeScript without the builder's constraint, the conditional type does not match at all and gives its false branch. My reading: `infer` takes the widened parameters from the base signature, and the following assignability check, which does use `I = Index`, then fails because a literal union does not accept `string`.

**3c. An instantiation expression on the builder's own parameter**, `typeof definition.operation<Index>`. When the parameter's type is a type parameter with a non-generic constraint, TypeScript reports TS2635 ("Type 'F' has no signatures for which the type argument list is applicable"). When the constraint is itself a generic function type, it compiles, but TypeScript resolves the expression against the constraint, not the author's function: the member type is `(...args: never[]) => ScopeRefinement`.

Probes for 3a to 3c: `helper-probe-generic-operation.ts.txt` and `helper-probe-plain-typescript.ts.txt`. Overloads were not built: the author would need one overload per index, and the author does not know the indexes.

**3d. Placeholder types.** The author marks a parameter type with `IndexElement<'options.fields'>` (the union of the leaf values of the array at that path) or `IndexValue<'path'>` (the value at the path). Inside the author's function the value is a `string`. The builder replaces each placeholder with the literal type from the matched index. No type lines; the author's code stays ordinary.

```ts
export const fulltextSearchScopes = defineIndexScopes({
  match: isFullTextIndex,
  operation: (
    { index, tableName },
    query: FakeTsQuery,
    options?: { readonly only?: IndexElement<'options.fields'> },
  ) => ({
    filter: textSearchFilter(tableName, options?.only ?? index.options.fields[0]?.[0] ?? 'id', query),
    orderBy: rankOrder(tableName, 'id'),
  }),
});
```

Drawbacks, from `helper-probe-author-mistakes.ts.txt`: a misspelled path is not an error for the author; it turns the option type into `never`, and only the consumer sees "Type 'string' is not assignable to type 'undefined'". A placeholder is replaced only in an argument or in a property of an object argument; one level deeper it stays a branded string. The path syntax is a small language the ORM client would have to document and maintain, and it cannot express anything beyond "value at path" and "leaves at path".

**3e. An interface with `this` slots**, as in the earlier spikes. 12 type lines. The runtime operation declares its argument types again (`only?: string`), and nothing checks the two against each other.

```ts
type FullTextFields<Index> = Index extends {
  readonly options: { readonly fields: readonly (readonly (infer Field)[])[] };
}
  ? Field
  : never;

interface FullTextOptions<Index> {
  readonly only?: FullTextFields<Index>;
}

interface FullTextScopeKind extends IndexScopeKind {
  readonly match: FullTextIndexShape;
  readonly member: (query: FakeTsQuery, options?: FullTextOptions<this['index']>) => this['collection'];
}

export const fulltextSearchScopes = defineIndexScopeKind<FullTextScopeKind>({
  match: isFullTextIndex,
  operation: ({ index, tableName }, query: FakeTsQuery, options?: { readonly only?: string }) => ({ ... }),
});
```

Writing `options?: { readonly only?: FullTextFields<this['index']> }` inline fails with TS2526, as the earlier spike found. The result type is written as `this['collection']`, and TypeScript prints it as `CollectionImpl<...> & { ... }` instead of `Collection<...>`. A consumer that exports a value of that type gets TS7056, TS4023 and TS4094 (see "Errors").

### 4. Several operations per index

The answer does not change. Both forms give exact types, and the consumer writes `helper(posts).post_title_body_search.fulltext(q, { only: 'title' })`.

**4a. Placeholders:**

```ts
export const fulltextSearchScopes = defineIndexScopeOperations({
  match: (index): index is FullTextIndexShape => isFullTextIndex(index),
  operations: {
    fulltext: ({ index, tableName }, query: FakeTsQuery, options?: { readonly only?: IndexElement<'options.fields'> }) => ({ ... }),
    phrase: ({ index, tableName }, query: FakeTsQuery) => ({ filter: ... }),
  },
});
```

**4b. Instantiated kind:** one interface line per operation. An interface property cannot hold a nested object type that uses `this` (TS2526), so each operation is a top-level property of the interface.

```ts
function fulltext<I extends FullTextIndexShape>(
  { index, tableName }: IndexScopeContext<I>,
  query: FakeTsQuery,
  options?: { readonly only?: I['options']['fields'][number][number] },
) { return { filter: ..., orderBy: ... }; }

function phrase<I extends FullTextIndexShape>({ index, tableName }: IndexScopeContext<I>, query: FakeTsQuery) {
  return { filter: ... };
}

interface FullText extends IndexOperationsKind<FullTextIndexShape> {
  readonly fulltext: typeof fulltext<this['index']>;
  readonly phrase: typeof phrase<this['index']>;
}

export const fulltextSearchScopes = defineIndexOperations<FullText>({
  match: isFullTextIndex,
  operations: { fulltext, phrase },
});
```

### 5. The operation returns a collection

```ts
export const fulltextSearchScopes = defineCollectionIndexScopes({
  match: isFullTextIndex,
  operation: ({ index, tableName }, collection, query: FakeTsQuery, options?: { readonly only?: IndexElement<'options.fields'> }) =>
    collection
      .where(textSearchFilter(tableName, options?.only ?? index.options.fields[0]?.[0] ?? 'id', query))
      .orderBy(rankOrder(tableName, 'id').map((item) => () => item)),
});
```

The input collection's exact type cannot flow through a non-generic function. The builder types `collection` as `Collection<Contract<SqlStorage>, string, unknown, CollectionTypeState>`: any model, any state. What is lost:

- **The builder cannot check the result.** An operation that returns `collection.where(...).select('id')` is accepted, and the consumer's type still says it gets full rows. Probe M4.
- **Field accessors are untyped.** The model is `string`, so `where((p) => p.title...)` has no typed fields. The author builds expressions from the index data, as in the other approaches.
- **Writing it generically does not help.** `<T extends ScopeTargetCollection>(scope, collection: T, q): T => collection.where(...)` fails with TS2375: `where` returns a `Collection`, not `T`. The author would need a cast. Probe M5.
- **It costs more.** Naming the "any model" collection type adds about 16,000 instantiations to the package.

### 6. Instantiated kind (recommended)

3 type lines, no casts. The operation is an ordinary generic function; its option type is an indexed access on its own type parameter.

```ts
function fulltext<I extends FullTextIndexShape>(
  { index, tableName }: IndexScopeContext<I>,
  query: FakeTsQuery,
  options?: { readonly only?: I['options']['fields'][number][number] },
) {
  return {
    filter: textSearchFilter(tableName, options?.only ?? index.options.fields[0]?.[0] ?? 'id', query),
    orderBy: rankOrder(tableName, 'id'),
  };
}

interface FullText extends IndexOperationKind<FullTextIndexShape> {
  readonly operation: typeof fulltext<this['index']>;
}

export const fulltextSearchScopes = defineIndexOperation<FullText>({
  match: isFullTextIndex,
  operation: fulltext,
});
```

Why it works: an instantiation expression on a named function value (`typeof fulltext<X>`) is allowed wherever `X` is a type, including `this['index']`. The ORM client fills `this['index']` with each literal index by intersecting the interface with `{ index: Index }`, as the earlier spikes did for their slots. The builder then reads the instantiated function's parameters after the first one.

Why the interface cannot be removed: the application `typeof fulltext<...>` must name the author's function. Only the author's module can name it. The builder only sees a type parameter (3c).

The builder also checks that the runtime `operation` is assignable to the interface's `operation` at the match type. Passing a different function is error TS2322 (probe M6). This check is what approaches 1 and 3e lack.

## Where the helper can be used

| Place | Result |
| --- | --- |
| Root collection `helper(db.public.Post)` | Exact, for every approach. |
| Chained collection `helper(db.public.Post.where(...).select('id','title'))` | Exact. The row type chosen before the call is kept: `.limit(10).all()` gives `{ id: number; title: string }[]`. |
| Include refinement `include('posts', (posts) => helper(posts).x(q).select('id'))` | Exact. The refinement collection is an `Omit<Collection, ...>` type; `CollectionIndexes` reads `ctx`, `modelName` and `namespaceId` from it structurally, so it works without a special case. |
| A custom class, from outside `helper(custom.public.Post)` | Exact: the result is `PostCollection`. |
| `this` inside a custom class method | **Fails for every approach** with TS2339: "Property 'post_title_search' does not exist on type 'IndexOperationScopes<FullText, this>'". `this` is a type parameter, so the member names of the mapped type are not known. Writing `helper<PostCollection>(this)` fixes it, and the result is `PostCollection`. |

**The type state is not updated.** The result is the input type, so after a scope that adds a filter and an order, `hasWhere` and `hasOrderBy` in the type state keep their earlier values. The task asked for "the same collection type as its input", and this is the consequence. It matters only for features gated on that state.

## Printed types

From `helper-probe-printed-types.ts.txt`, with default error truncation. The helper itself:

| # | Printed type of the helper |
| --- | --- |
| 1 | `<C extends object>(collection: C) => FulltextSearchScopes<C>` |
| 2 | `<C extends object>(collection: C) => IndexScopes<C, FullTextIndexShape, [query: FakeTsQuery, options?: { readonly language?: string; } \| undefined]>` |
| 3d | `<C extends object>(collection: C) => IndexScopes<C, FullTextIndexShape, [query: FakeTsQuery, options?: { readonly only?: IndexElement<"options.fields">; } \| undefined]>` |
| 3e | `<C extends object>(collection: C) => IndexKindScopes<FullTextScopeKind, C>` |
| 4a | `<C extends object>(collection: C) => IndexScopeOperations<C, FullTextIndexShape, { fulltext: ({ index, tableName }: IndexScopeContext<FullTextIndexShape>, query: FakeTsQuery, options?: { ...; } \| undefined) => { ...; }; phrase: ...; }>` |
| 4b | `<C extends object>(collection: C) => IndexOperationsScopes<FullText, C>` |
| 5 | `<C extends object>(collection: C) => CollectionIndexScopes<C, FullTextIndexShape, [query: FakeTsQuery, options?: ...]>` |
| 6 | `<C extends object>(collection: C) => IndexOperationScopes<FullText, C>` |

The helper's result on `db.public.Post`, approach 6: `IndexOperationScopes<FullText, Collection<HelperContract, "Post", DefaultModelRow<HelperContract, "Post", "public">, WithNsId<DefaultCollectionTypeState, "public">>>`. The other approaches print the same with their own alias name.

An operation, approaches 1, 3d, 4a, 4b, 5 and 6 (all identical):

```
(query: FakeTsQuery, options?: { readonly only?: "title" | "body" | "subtitle"; } | undefined) => Collection<HelperContract, "Post", DefaultModelRow<HelperContract, "Post", "public">, WithNsId<...>>
```

Approach 3e prints the option as `FullTextOptions<{ readonly name: "post_title_body_search_0a1b2c3d"; readonly prefix: ...; ... }>` and the result as `CollectionImpl<...> & { ...; }`.

A wrong option value, approach 6: `Type '"body"' is not assignable to type '"title"'.` A wrong name: `Property 'post_title_body_search_0a1b2c3d' does not exist on type 'IndexOperationScopes<FullText, Collection<...>>'. Did you mean 'post_title_body_search'?`

No conditional type appears in any printed type.

## Measurements

`tsc --extendedDiagnostics` on `packages/3-extensions/sql-orm-client`, through `pnpm typecheck -p`. Every configuration was run twice and both runs gave the same counts. Script: `helper-measure.mjs.txt`. Check times were 3.2 s to 3.8 s for every configuration, which is within noise, so they are left out.

Each configuration includes the whole package and excludes the files of the other approaches one by one, so files are checked in the package's normal order. A first attempt listed the approach's files under `files`, which moves them to the front of the check order. That changed the counts by about 25,000, and one approach measured below the baseline. Those numbers were discarded.

| Configuration | Instantiations | Change from branch point | Types |
| --- | --- | --- | --- |
| Branch point `037cad4edd` | 1,511,763 | | 245,099 |
| This branch, all helper files excluded | 1,511,914 | +151 | 245,134 |
| Fixture only | 1,512,291 | +528 | 245,322 |
| Control: fixture plus ten collection expressions, no helper | 1,543,842 | +32,079 | 249,148 |
| 1 unused / ten uses | 1,512,505 / 1,544,566 | +742 / +32,803 | 245,397 / 249,356 |
| 2 unused / ten uses | 1,512,818 / 1,544,991 | +1,055 / +33,228 | 245,592 / 249,498 |
| 3d unused / ten uses | 1,512,822 / 1,545,237 | +1,059 / +33,474 | 245,600 / 249,562 |
| 3e unused / ten uses | 1,512,482 / 1,544,838 | +719 / +33,075 | 245,448 / 249,488 |
| 4a unused / ten uses | 1,512,836 / 1,545,340 | +1,073 / +33,577 | 245,603 / 249,594 |
| 4b unused / ten uses | 1,512,777 / 1,545,642 | +1,014 / +33,879 | 245,639 / 250,300 |
| 5 unused / ten uses | 1,528,676 / 1,561,091 | +16,913 / +49,328 | 247,465 / 251,427 |
| **6 unused / ten uses** | **1,512,734 / 1,545,535** | **+971 / +33,772** | 245,620 / 250,265 |

"Unused" includes the builder, the fixture and the author's helper definition, with no call. "Ten uses" adds `*.ten.ts`: ten statements that call the helper on a root collection, chained collections, a selected collection, two include refinements, the result of another helper call, and with and without options. The control file has the same ten statements without the helper.

**Demo.** `examples/prisma-8-demo` typecheck against built `dist` output: 744,593 at the branch point; 744,593 with the builders exported from the ORM client and two helpers exported from the Postgres facade but unused; 757,986 (+1.8%) with the probe file, which has about fifteen helper calls and an application-level helper. Script: `helper-demo-check.mjs.txt`.

## Built output and another package

Approaches 6 and 3d were built and consumed from another package.

- **The ORM client** exports `defineIndexOperation`, `defineIndexOperations`, `defineIndexScopes` and their types from `@internal/sql-orm-client`. They reach `@prisma/orm-family-sql/orm-client` and `@prisma/orm-postgres/orm-client` through the existing re-exports.
- **The Postgres facade** defines `fulltextSearchScopes` (approach 6) and `fulltextSearchScopesWithPlaceholders` (approach 3d) in `packages/3-extensions/postgres/src/runtime/fulltext-search-scopes.ts` and exports them from `@internal/postgres/runtime`. The facade builds with no error.
- **The emitted declarations are small and readable.** `@prisma/orm-postgres/dist/runtime.d.mts` contains the `FullTextIndex` type, `declare function fulltext<I extends FullTextIndex>(...)`, `interface FullText { readonly operation: typeof fulltext<this['index']>; }` and `declare const fulltextSearchScopes: <C extends object>(collection: C) => import("@prisma/orm-family-sql/orm-client").IndexOperationScopes<FullText, C>`. The shell build rewrote the module specifier to the published name. No TS2742, no inlined collection type.
- **The demo consumes it.** `helper-demo-probe.test-d.ts.txt` runs inside `examples/prisma-8-demo` against the real `db` from `src/prisma/db.ts`, with `options` added to the demo's `post_title_search` index in `contract.d.ts` for the run (the script restores the file). It checks root, chained and include-refinement collections, literal options, rejected names, a model with no index, and an application-level helper written against the published `defineIndexOperation`. It passes with no error.
- **Approach 3e has a declaration problem on the consumer side.** Exporting a value returned by a 3e operation fails with TS7056, TS4023 and TS4094, because its type is the expanded `CollectionImpl<...> & {...}` with a private member. Probe: `helper-probe-slots-exported-results.ts.txt`.

## TypeScript errors hit

| Error | Where | How it was avoided |
| --- | --- | --- |
| TS18048, TS18046, TS4111 | Approach 2 with an inline type guard whose parameter has no annotation: the operation's `index` is `IndexData`. | A named guard, or annotate the guard's parameter. |
| TS2677 and TS2322 | A match type that is not assignable to `IndexData` (probe M1). | The author writes `IndexData & { ... }`. |
| TS2526 | `this['index']` inside a nested object type in an interface (3e, 4b). | A separate generic interface (3e); one top-level property per operation (4b). |
| TS2536 | The builder's own `(Kind & { index })['operation']` with an unconstrained `Kind`. | Constrain `Kind extends IndexOperationKind`. |
| TS2635 | Instantiation expression on a parameter whose type is a type parameter (3c). | Not avoidable in the builder. The author writes the instantiation instead (approach 6). |
| None, but wrong types | Generic or curried operation into a builder (3a, 3b), instantiation expression against a generic constraint (3c). | Not avoidable. |
| TS2339 | `helper(this)` inside a custom collection class, every approach. | `helper<PostCollection>(this)`. |
| TS7056, TS4023, TS4094 | Exporting a result of approach 3e. | The ten-use files were changed to expression statements so all approaches are measured the same way. |
| TS2375 | Approach 5 written generically (probe M5). | Not avoidable without a cast. |
| TS2322 | Approach 6 with a runtime operation that does not match the interface (probe M6). | This is the intended check. |
| Runtime `Unknown column "body"` | The runtime test used a field that is not a column of the test table. | Used `title`. |
| Lint `noBannedTypes` | `toEqualTypeOf<{}>()` in type tests. | Assert `keyof` is `never`. |

No "excessively deep" error (TS2589) and no circular reference error appeared.

## Not tested

- An index without `prefix`; the name falls back to `name`, but no test covers it.
- `GroupedCollection`, prepared collections, `.variant()` collections, contracts with several namespaces, the Mongo ORM client.
- Approaches 1, 2, 3e, 4a, 4b and 5 through built output. Only 6 and 3d were built and consumed.
- Editor hover in an IDE. Printed types come from error messages.
- The real Postgres full-text operations. The runtime uses `BinaryExpr` stand-ins and a `FakeTsQuery` in the package, and `AnyExpression` in the facade.
- Declaration merging or registries. This spike only covers the helper's authoring.
- Whether a scope should update `hasWhere` and `hasOrderBy` in the type state.

## Recommendation

The ORM client exports one building block, in two forms, and the shared types:

```ts
/** The fields every index entry has at runtime. */
export interface IndexData {
  readonly name: string;
  readonly prefix?: string;
  readonly unique: boolean;
  readonly type?: string;
  readonly columns?: readonly string[];
  readonly expression?: string;
  readonly options?: Record<string, unknown>;
}

/** The first argument of every scope operation. */
export interface IndexScopeContext<Index> {
  readonly index: Index;
  readonly tableName: string;
}

/** What a scope operation returns. The ORM client applies it to the collection. */
export interface ScopeRefinement {
  readonly filter: AnyExpression;
  readonly orderBy?: readonly OrderByItem[];
}

/** Names an operation's type for one index: `operation: typeof myOperation<this['index']>`. */
export interface IndexOperationKind<Match extends IndexData = IndexData> {
  readonly match: Match;
  readonly index: Match;
  readonly operation: unknown;
}

export function defineIndexOperation<Kind extends IndexOperationKind>(definition: {
  readonly match: (index: IndexData) => index is Kind['match'];
  readonly operation: OperationFor<Kind, Kind['match']> &
    ((scope: IndexScopeContext<Kind['match']>, ...args: never[]) => ScopeRefinement);
}): <C extends object>(collection: C) => IndexOperationScopes<Kind, C>;

/** Several operations per index: each property other than `match` and `index` is one operation. */
export interface IndexOperationsKind<Match extends IndexData = IndexData> {
  readonly match: Match;
  readonly index: Match;
}

export function defineIndexOperations<Kind extends IndexOperationsKind>(definition: {
  readonly match: (index: IndexData) => index is Kind['match'];
  readonly operations: {
    readonly [Name in OperationNames<Kind>]: (Kind & { readonly index: Kind['match'] })[Name] &
      ((scope: IndexScopeContext<Kind['match']>, ...args: never[]) => ScopeRefinement);
  };
}): <C extends object>(collection: C) => IndexOperationsScopes<Kind, C>;
```

The result types, not exported as building blocks but visible in hovers:

```ts
type OperationFor<Kind extends IndexOperationKind, Index> = (Kind & { readonly index: Index })['operation'];

type MemberOf<Operation, C> = Operation extends (scope: never, ...args: infer Args) => ScopeRefinement
  ? (...args: Args) => C
  : never;

export type IndexOperationScopes<Kind extends IndexOperationKind, C> = {
  readonly [Index in Extract<CollectionIndexes<C>[number], Kind['match']> as IndexScopeName<Index>]: MemberOf<
    OperationFor<Kind, Index>,
    C
  >;
};
```

A complete extension, as built in the Postgres facade and consumed by the demo:

```ts
import {
  defineIndexOperation,
  type IndexData,
  type IndexOperationKind,
  type IndexScopeContext,
} from '@prisma/orm-postgres/orm-client';
import { type AnyExpression, BinaryExpr, ColumnRef, OrderByItem } from '@prisma/orm-family-sql/relational-core/ast';

type FullTextIndex = IndexData & {
  readonly type: 'gin';
  readonly options: { readonly fields: readonly (readonly string[])[]; readonly language: string };
};

function isFullTextIndex(index: IndexData): index is FullTextIndex {
  const options = index.options;
  return (
    index.type === 'gin' &&
    options !== undefined &&
    Array.isArray(options['fields']) &&
    typeof options['language'] === 'string'
  );
}

function fulltext<I extends FullTextIndex>(
  { index, tableName }: IndexScopeContext<I>,
  query: AnyExpression,
  options?: { readonly only?: I['options']['fields'][number][number] },
) {
  const column = ColumnRef.of(tableName, options?.only ?? index.options.fields[0]?.[0] ?? 'id');
  return { filter: new BinaryExpr('eq', column, query), orderBy: [OrderByItem.desc(column)] };
}

interface FullText extends IndexOperationKind<FullTextIndex> {
  readonly operation: typeof fulltext<this['index']>;
}

export const fulltextSearchScopes = defineIndexOperation<FullText>({
  match: isFullTextIndex,
  operation: fulltext,
});
```

The consumer:

```ts
fulltextSearchScopes(db.orm.public.Post).post_title_search(query);                   // typeof db.orm.public.Post
fulltextSearchScopes(posts.where(...).select('id')).post_title_search(query, { only: 'title' });
db.orm.public.User.include('posts', (p) => fulltextSearchScopes(p).post_title_search(query).select('id'));
fulltextSearchScopes(db.orm.public.Post).post_title_search(query, { only: 'body' }); // error: not a field of the index
```

Keep `defineIndexScopes` (approach 2) as well if operations whose arguments do not depend on the index are common: it needs no interface at all. Do not ship the placeholder types (3d): they work, but a misspelled path fails silently for the author and the path syntax is a new language to maintain. Do not use approach 5: it cannot check what the operation returns.

## Files

- Code: `packages/3-extensions/sql-orm-client/src/helper-authoring/` (builders), `test/helper-authoring/` (fixture, one file per approach, type tests, ten-use files, runtime test), `src/types.ts` (`ModelTableIndexes`), `src/exports/index.ts`, `packages/3-extensions/postgres/src/runtime/fulltext-search-scopes.ts`.
- Probes in this folder, written to sit in `packages/3-extensions/sql-orm-client/test/helper-authoring/` unless noted: `helper-probe-generic-operation.ts.txt` (3a to 3c), `helper-probe-plain-typescript.ts.txt` (3b and 3c without the repo; place anywhere), `helper-probe-inline-type-guard.ts.txt`, `helper-probe-author-mistakes.ts.txt` (M1 to M6), `helper-probe-printed-types.ts.txt`, `helper-probe-slots-exported-results.ts.txt`, `helper-demo-probe.test-d.ts.txt` (goes in `examples/prisma-8-demo/test/`).
- Scripts: `helper-measure.mjs.txt`, `helper-demo-check.mjs.txt`. Both run from the repo root.
