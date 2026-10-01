# Spike: a plain helper that offers a model's full-text indexes as searches

**Date:** 2026-09-29
**Branch:** `spike-scope-helper-api`, started from `bot/model-scopes-design` at `037cad4edd`.
**Question:** can a package export a plain function that takes any collection and offers that model's full-text indexes as typed searches, with no change to `Collection`, the contract's domain plane or the schema language? Which call shape is best?

## Answer

Yes. All five shapes work and meet every requirement, with one exception: the curried form used on its own (D) cannot autocomplete the index name, because the name is written before the collection is known. The cost is small for every shape. With the helpers present but unused, the demo's instantiation count does not change at all. One use costs 200 to 900 instantiations in the demo, and each further use costs 50 to 140. Adding `pipe` to `Collection` (E) costs 608 instantiations in the demo (+0.08%) when it is typed with a `this` parameter, but 15,828 (+2.1%) when it is typed with the polymorphic `this` type. The main trap was `this` inside a custom collection class: a helper that reads the model from `C['modelName']` silently stops checking names there. Inferring the contract, model and namespace as separate type parameters fixes it for every shape. I recommend option C, `searchFullText(collection, 'index_name', query, options)`: it has the clearest error messages, autocompletes, is cheap, needs no change to `Collection`, and the application can wrap it in a one-line method.

## What was built

All code is in `packages/3-extensions/sql-orm-client`. The Postgres facade re-exports that package whole as `@prisma/orm-postgres/orm-client`, so the helpers are available there without further change. I put them in the ORM client package rather than the Postgres extension package so that the ORM client's own test fixtures could be used. For a real delivery they belong with the Postgres extension; the type machinery does not depend on where they live.

- `src/fulltext-search.ts`: the five helpers, their types, and a stub runtime.
- `src/types.ts`: one new exported type, `ModelTableIndexes<Contract, Model, NsId>`, which finds the model's table and returns its `indexes` tuple. It reuses the existing private `ModelDef` and `ResolvedNsId`.
- `src/collection.ts`: only for option E, one new method `pipe`.
- `test/fulltext-search-fixture.ts`: the test contract with two full-text indexes on `posts`, written as structured data (see below).
- `test/fulltext-search.types.test-d.ts` (A to D) and `test/fulltext-search-pipe.types.test-d.ts` (E): type tests, with `@ts-expect-error` negatives.
- `test/fulltext-search.test.ts`: 5 runtime tests. All pass.

**The index data.** The fixture replaces the `posts` table's `indexes` tuple in the contract type. The full-text entries look like this:

```ts
{
  readonly name: 'post_title_body_search_0a1b2c3d';
  readonly prefix: 'post_title_body_search';
  readonly expression: string;
  readonly type: 'gin';
  readonly unique: false;
  readonly options: {
    readonly fields: readonly [readonly ['title', 'subtitle'], readonly ['body']];
    readonly language: 'english';
  };
}
```

The helper treats an index as full-text when it matches `{ prefix: string; type: 'gin'; options: { fields: readonly (readonly string[])[]; language: string } }`. The member name is `prefix`. The runtime test puts the same entries into the contract JSON. Contract hydration requires `columns` or `expression` on every index, so the entries carry an `expression`; hydration kept `prefix` and `options`. For the demo, `demo-contract-fulltext-index.mjs.txt` adds `options: { fields: [['title']], language: 'english' }` to the demo's existing `post_title_search` index in `contract.d.ts`. The measuring script applies it and restores the file afterwards. The emitter and PSL were not changed.

**The query argument.** The ORM client package cannot import the Postgres target's `TsqueryArgument` without breaking the layering rules, so the stub uses its own `FullTextQuery` object made by `fullTextQuery(text)`. This does not affect the type questions.

**The runtime stub.** Every helper ends in the same function. It reads the index from `collection.ctx.context.contract` at run time, then calls the collection's public `where` with a placeholder `LIKE` expression on the first field (or on `only`) and `orderBy` with that column descending. The result is a real collection: the tests chain `.limit()`, `.all()` and a custom class method on it, check the generated `WHERE` and `ORDER BY`, and check that a custom class instance stays an instance of that class.

## The options

```ts
// A. object of functions
fulltextSearchScopes(db.Post).post_title_body_search(q, { only: 'title' });
// B. object of objects with operations (and per-index data such as `language`)
fulltextScopeObjects(db.Post).post_title_body_search.fulltext(q);
// C. one function, the index name as an argument
searchFullText(db.Post, 'post_title_body_search', q, { only: 'body' });
// D. curried, collection last
fullTextSearch('post_title_body_search', q)(db.Post);
// E. D applied through a generic pipe on Collection
db.Post.where({ userId }).pipe(fullTextSearch('post_title_body_search', q)).limit(10);
```

In a custom collection class the application writes a short method:

```ts
class PostCollection extends Collection<Contract, 'Post'> {
  search(q: FullTextQuery) {
    return searchFullText(this, 'post_title_body_search', q);
  }
}
```

`pipe` is typed as `pipe<Self, Result>(this: Self, step: (collection: Self) => Result): Result`. `fullTextSearch` has two overloads. The first takes its collection type from the context, so inside `.pipe(...)` it knows the model, checks the name and autocompletes it. The second is used when there is no context, as in D: it returns a function whose parameter is checked when a collection is passed to it.

I did not find a clearly better sixth option. The variants I tried are recorded under "TypeScript errors hit".

## Requirements

Every cell is backed by a type test in the package that fails when the behaviour breaks, and the demo probe (`demo-probe-helpers.test-d.ts.txt`) repeats the main checks through the built `dist` output. Without the index data in the demo contract, that probe fails with 16 errors; with it, it passes.

| Requirement | A | B | C | D | E |
| --- | --- | --- | --- | --- | --- |
| 1. Root, chained, include refinement, `this` in a custom class | Yes | Yes | Yes | Yes | Yes |
| 2. Result has the input's type; chaining and the final row type unchanged | Yes | Yes | Yes | Yes | Yes |
| 3. Only the model's full-text indexes; none for a model without them; wrong name is an error | Yes | Yes | Yes | Yes, when the collection is passed in | Yes, at the `pipe` call |
| 3. The name autocompletes | Yes, as a member | Yes, as a member | Yes | No | Yes, also inside a class |
| 4. An option typed from the index literal (`only?: 'title' \| 'subtitle' \| 'body'`) | Yes | Yes, plus `language` typed as `'english'` | Yes | Yes, checked when the collection is passed in | Yes |
| 5. Client constructed exactly as today | Yes | Yes | Yes | Yes | Yes |
| 6. No `any` | Yes | Yes | Yes | Yes | Yes |
| 7. Works through `dist` from `examples/prisma-8-demo` | Yes | Yes | Yes | Yes | Yes |
| Changes `Collection` | No | No | No | No | Adds `pipe` |

Autocomplete was checked with the TypeScript language service (`completions.mjs.txt` run on `completions-probe.ts.txt`). For D the service offers only the text already typed.

A step made by `fullTextSearch` can be stored in a variable and applied later with `pipe`. It is still checked when applied. `pipe` also works with an annotated return type and inside an array literal.

## Measurements

Instantiation counts from `tsc --extendedDiagnostics`, TypeScript 5.9.3. Every count was measured twice and both runs gave the same number. "Package" is the typecheck of `packages/3-extensions/sql-orm-client` with the new `test/fulltext-search*` tests excluded. "Demo" is the typecheck of `examples/prisma-8-demo` against the built `dist` output. Check times are left out: the machine was shared with other work (load average 7 to 14).

**Cost when the helpers exist but are not used**

| State | Package | Demo |
| --- | --- | --- |
| Baseline (`037cad4edd`) | 1,511,763 | 744,593 |
| A to D present, not used (`10a7a9628a`) | 1,514,637 (+2,874, +0.19%) | 744,593 (+0) |
| A to D plus `pipe` typed with a `this` parameter (`103f1e07d5`, kept) | 1,516,673 (+4,910, +0.32%) | 745,201 (+608, +0.08%) |
| A to D plus `pipe` typed with the polymorphic `this` type (`86bfcbc7e3`, not kept) | 1,531,027 (+19,264, +1.27%) | 760,421 (+15,828, +2.13%) |

The package's +2,874 for A to D is the cost of checking the helper's own source file, which only the ORM client package pays. The demo, a consumer, pays nothing.

**Cost of use**

Each probe has the same ten call sites: the root collection, three chained collections, two include refinements, two methods of a custom class, a root call with `only`, and a chained call with `orderBy`. The "0 uses" probe has the sites without the helper. The "1 use" probe sends only the first site (the root) through the helper; the "10 uses" probe sends all ten. The numbers are the increase over the "0 uses" probe measured in the same state. The demo contract is patched in all three demo probes.

| Option | Package, 1 use | Package, 10 uses | Package, each further use | Demo, 1 use | Demo, 10 uses | Demo, each further use |
| --- | --- | --- | --- | --- | --- | --- |
| A | +351 | +1,339 | about 110 | +206 | +692 | about 54 |
| B | +352 | +1,346 | about 110 | +207 | +699 | about 55 |
| C | +331 | +1,439 | about 123 | +412 | +1,131 | about 80 |
| D | +687 | +2,391 | about 189 | +885 | +2,129 | about 138 |
| E, `this` parameter | +414 | +1,840 | about 158 | +475 | +1,443 | about 108 |
| E, polymorphic `this` (not kept) | +467 | +11,515 | about 1,228 | +508 | +9,981 | about 1,053 |

The "0 uses" probes counted 1,552,707 (package) and 760,096 (demo) with A to D present, and 1,554,818 and 760,658 with the kept `pipe`. A, B and C were measured at `10a7a9628a`; D and E at `103f1e07d5`, with the final `fullTextSearch` overloads. D measured at `10a7a9628a` with its first overload gave nearly the same numbers (+682, +2,419, +944, +2,262). A measured again with the polymorphic `pipe` present gave +369 and +1,540 (package) and +224 and +827 (demo).

## What TypeScript prints

From error messages, which are close to what a hover shows. `Post` is `db.public.Post` in the package test.

| Option | What is printed |
| --- | --- |
| A, the object | `FullTextSearchScopes<CollectionImpl<SearchContract, "Post", DefaultModelRow<SearchContract, "Post", "public">, WithNsId<DefaultCollectionTypeState, "public">> & { ...; }, SearchContract, "Post", "public">` |
| A, a member | `FullTextSearchFunction<{ readonly name: "post_title_body_search_0a1b2c3d"; readonly prefix: "post_title_body_search"; readonly expression: string; readonly type: "gin"; readonly unique: false; readonly options: { ...; }; }, CollectionImpl<...> & { ...; }>` |
| B, an operation | `(query: FullTextQuery, options?: FullTextSearchOptions<{ readonly name: "post_title_body_search_0a1b2c3d"; ...; }> \| undefined) => CollectionImpl<...> & { ...; }` |
| C, the function | `<C extends SearchableCollection, TContract extends Contract<SqlStorage>, ModelName extends string, Name extends ModelFullTextIndexes<TContract, ModelName, NsId>["prefix"], NsId extends string = never>(collection: C & CollectionCoordinates<TContract, ModelName, NsId>, name: Name, query: FullTextQuery, options?: FullT...` |
| D, the step | `FullTextSearchStep<"post_title_body_search", undefined>` |
| E, `pipe` | `<Self, Result>(this: Self, step: (collection: Self) => Result) => Result` |
| Result of A, B, C and D | `CollectionImpl<SearchContract, "Post", ...> & { ...; }`. The `Collection` alias name is lost, as in the earlier spikes. After one more call such as `.limit(1)` it prints as `Collection<SearchContract, "Post", ...>` again. |
| Result of E after `.limit(1)` | `Collection<SearchContract, "Post", DefaultModelRow<SearchContract, "Post", "public">, WithNsId<DefaultCollectionTypeState, "public">>` |

Error messages for a wrong index name (`posts_user_id_idx`, a plain B-tree index):

- **A:** `Property 'posts_user_id_idx' does not exist on type 'FullTextSearchScopes<CollectionImpl<...> & { ...; }, SearchContract, "Post", "public">'.`
- **B:** the same, on `FullTextScopeObjects<...>`.
- **C:** `Argument of type '"posts_user_id_idx"' is not assignable to parameter of type '"post_title_body_search" | "post_title_search"'.` This is the clearest message.
- **D:** `Argument of type 'Collection<SearchContract, "Post", ...>' is not assignable to parameter of type 'CollectionImpl<...> & { ...; } & CollectionCoordinates<...> & { ...; }'` followed by `Property 'fullTextIndexNotOnModel' is missing ... but required in type '{ readonly fullTextIndexNotOnModel: "posts_user_id_idx"; }'.` Inside a class the message is longer and also says `'this' could be instantiated with a different subtype of constraint 'PostCollection'`.
- **E:** `Argument of type 'FullTextSearchStep<"posts_user_id_idx", undefined>' is not assignable to parameter of type '(collection: Collection<...>) => ...'`, then the same `fullTextIndexNotOnModel` line as D. TypeScript reports the error against the second overload.

For a wrong `only` value, A, B and C print `Type '"body"' is not assignable to type '"title"'.` D and E end with `required in type '{ readonly fullTextSearchFieldNotInIndex: "body"; }'`.

## TypeScript errors hit

1. **TS2536, "Type 'number' cannot be used to index type 'ModelTableIndexes<...>'".** `ModelTableIndexes` of a generic collection is not known to be an array. Fixed with `Extract<ModelTableIndexes<...>, readonly unknown[]>[number]`.
2. **TS2394, "This overload signature is not compatible with its implementation signature".** The implementation of `fullTextSearch` returned `(collection: SearchableCollection) => SearchableCollection`, which the generic second overload does not match. Fixed by making the implementation return `<C extends SearchableCollection>(collection: C) => C`.
3. **TS2339 inside a custom class: "Property 'post_title_body_search' does not exist on type 'FullTextSearchScopes<this>'".** The first version computed the members from `C['modelName']` and `C['ctx']['context']['contract']`. For `this`, those types are not resolved, so the mapped type had no members. The same first version gave **no error at all** for a wrong name in C and D inside a class: the name was checked against an unresolved type and accepted. Both were fixed by inferring the contract, model name and namespace as their own type parameters from the argument, with `collection: C & CollectionCoordinates<TContract, ModelName, NsId>`. TypeScript infers them from the class's declared base type even when the argument is `this`. `NsId` defaults to `never`, which is what a custom class's type state holds. The return type stays `C`, so `this` is kept.
4. **TS2578, unused `@ts-expect-error`, for E inside a class.** `this.pipe(fullTextSearch('posts_user_id_idx', q))` was accepted, for the same reason as item 3: the first overload took its collection type `C` from the context and checked the name against `C['modelName']`. Fixed with the same coordinate inference in that overload.
5. **Cost of the polymorphic `this` type in `pipe`.** `pipe<Result>(step: (collection: this) => Result)` compiled and passed every test, but cost +15,828 instantiations in the unchanged demo and about 1,000 per use. Typing it with a `this` parameter, `pipe<Self, Result>(this: Self, step: (collection: Self) => Result)`, passed the same tests at +608 and about 108 per use. Both versions are committed so the numbers can be reproduced.
6. **Runtime: `ContractValidationError: Index "post_title_body_search_0a1b2c3d": exactly one of columns or expression must be set.`** Fixed by giving the fixture's full-text index JSON an `expression`.
7. **Runtime: `Unknown column "body" in table "posts"`.** The fixture's field names are only typing data; `body` does not exist on the test table. The runtime test now expects this error, which shows that `only` reaches the query.
8. Minor: TS6133 and TS6196 for an unused variable in a probe and an unused type alias.

## Not tested

- `GroupedCollection`, prepared collections, polymorphic variants (`.variant()`), contracts where one model's table sits in another namespace, and the Mongo ORM client.
- Real full-text SQL. The runtime uses a placeholder `LIKE` filter and does not call `fullTextMatches` or `fullTextRank`.
- The demo was only typechecked. Its `contract.json` was not changed and no demo runtime test was run.
- The helpers read `ctx`, `modelName`, `namespaceId` and `tableName` from the collection. These are public members marked `@internal` in their doc comments. They appear in the built `.d.mts` today. If the build ever strips `@internal` members, the helpers break.
- Check time and editor latency. Only instantiation counts were measured.
- The full test suites. Only the new tests and the two typechecks were run.
- A helper's result state: the search adds a filter and an order, but the result type is the input type, so `hasWhere` and `hasOrderBy` in the type state are not updated. `cursor()`, which needs `hasOrderBy`, is not unlocked by a search. This matches the requirement that the type is unchanged, but a real design must decide it.

## Recommendation

**Option C, `searchFullText(collection, name, query, options?)`.**

- It meets every requirement, including autocomplete for the name and for `only`.
- It gives the clearest error message: a wrong name lists the valid names.
- It costs about as little as A and B: about 80 instantiations per use in the demo and nothing when unused.
- It needs no change to `Collection`. A and B need a runtime object built per call with one member per index; C is one function.
- The application names its own method in one line, which covers the "short name" case.

**E is a reasonable addition, not a replacement.** With the `this` parameter it costs +0.08% in the demo when unused and about 108 per use. It adds composition: a search step is a value that can be stored, passed around and applied to any collection, and the name still autocompletes at the `pipe` call. Its error messages are the worst of the five. If `pipe` is added, it must be typed with a `this` parameter, not the polymorphic `this` type.

**Whichever shape is chosen, infer the contract, model and namespace as separate type parameters.** Reading them through `C['modelName']` looks equivalent and passes tests on root collections, but silently skips the name check inside a custom class.

## Files

- `measure-helper.sh.txt`: measures one state; each typecheck twice. `SKIP_BASE=1` skips the runs without a probe.
- `run-measurements.sh.txt`: generates the probes, builds, and runs `measure-helper.sh.txt` for a list of options.
- `gen-probes.mjs.txt`: writes the 0, 1 and 10 use probes for the package and the demo.
- `demo-contract-fulltext-index.mjs.txt`: adds the structured full-text data to the demo's `contract.d.ts`.
- `demo-probe-helpers.test-d.ts.txt`: the requirement checks run inside `examples/prisma-8-demo` through `dist`.
- `print-probe.test-d.ts.txt`: the deliberate errors used to read printed types.
- `completions.mjs.txt` and `completions-probe.ts.txt`: the language-service script and the sites it queries.
