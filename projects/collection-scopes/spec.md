# Collection chaining, query fragments, collection scopes and weighted full-text search

**Linear:** TML-3403 (a custom collection class loses its methods in the types), TML-3397 (a ternary between two collections can allow `deleteAll()`). No Linear project yet.
**Design records:** [ADR 258 — A collection keeps its class through the chain](../../docs/architecture%20docs/adrs/ADR%20258%20-%20A%20collection%20keeps%20its%20class%20through%20the%20chain.md), [ADR 259 — Query fragments are functions](../../docs/architecture%20docs/adrs/ADR%20259%20-%20Query%20fragments%20are%20functions.md), [ADR 260 — Packages offer collection scopes for their kinds of index](../../docs/architecture%20docs/adrs/ADR%20260%20-%20Packages%20offer%20collection%20scopes%20for%20their%20kinds%20of%20index.md). All Proposed.

## Purpose

A developer writes named queries once, as methods of a collection class or as functions, and uses them anywhere a collection of the model appears, with the collection's type staying sound however the query is composed. A package that introduces a kind of index can give applications a typed search built from the index's own definition, so the search cannot miss the index. The first such search is Postgres full-text search over several weighted fields.

## At a glance

```prisma
model Post {
  id          Int       @id
  title       String
  body        String?
  publishedAt DateTime?

  @@fullTextIndex([[title], body], name: "post_search")
}
```

```ts
const postScopes = fulltextSearchScopes<Contract, 'Post'>();

class PostCollection extends Collection<Contract, 'Post'> {
  published()   { return this.where((p) => p.publishedAt.isNotNull()); }
  newestFirst() { return this.orderBy((p) => p.publishedAt.desc()); }
  search(q: TsqueryArgument) { return this.pipe(postScopes.post_search(q)); }
}

const posts = await db.Post
  .published()
  .pipe((posts) => (input.q ? posts.search(websearchToTsquery(input.q)) : posts))
  .newestFirst()
  .limit(20)
  .all();
```

- Class methods chain, before and after built-in methods.
- `pipe` applies any function. The conditional yields a collection whose search filter is not known; `published()` already made it filtered, so `update` is allowed.
- `postScopes.post_search(q)` is a step built from the index's definition in the contract. The query it adds uses the index.

## Where things stand (grounded 2026-10-01)

- **A custom collection class loses its methods in the types after any chained call**, and inside include refinements. Every chaining method returns `Collection<TContract, ModelName, Row, State>`. The run time keeps the subclass. TML-3403.
- **The collection's type state is not part of assignability.** It appears only in method parameter types, so a filtered and an unfiltered collection are assignable to each other, and a ternary between them may keep the filtered one. TML-3397.
- **`Collection` has no `pipe` method.**
- **Single-column full-text search works.** `fullTextMatches`, `fullTextRank` and `fullTextHeadline` are column operations taking a `tsquery`; `@@fullTextIndex([field])` and the TypeScript `fullTextIndex` helper author a GIN index over one field.
- **The Postgres full-text index is stored as an opaque expression** in the contract. Nothing can recover the fields or language from it.
- **Spikes on the `bot` remote** prove the collection typing (`spike-this-typed-chaining`), the fragment helpers (`spike-pipe-fragments`) and the scope builder in its collection-taking form (`spike-scope-helper-authoring`). Write-ups are under `spikes/`.
- **There is no MySQL target.** The MongoDB ORM client is out of scope for delivery.

## Decided

- **A method is a step with the receiver bound** (ADR 258). The type state and the row are declared properties; unknown flags are `boolean`. `where` returns `Filtered<Self>`, `orderBy` returns `Ordered<Self>`, `include` returns `Including<Self, Rel>`, `limit`, `offset`, `distinct` and `cursor` return `Self`, and `pipe(step)` returns `step(this)`. `select` and `variant` return the shared `Collection` type.
- **A filtered collection is a subtype of an unfiltered one**, so a conditional reduces to the unfiltered type and any function body is sound. The query API has no control-flow methods.
- **Query fragments are functions** (ADR 259): `FieldExpression` for a row field named by codec, `rowFragment` with `RowOf` for a shared `select` and `include`, `sortField` for a sort field from a request.
- **A scope is a `Step<Self, Filtered<Self>>` that a package builds from an index definition** (ADR 260). `fulltextSearchScopes<Contract, 'Post'>()` returns one scope per full-text index on the model, named after the index. The ORM client provides the builder `defineIndexScopes`.
- **`@@fullTextIndex` takes fields in weight groups**, `name:` is the scope's name, and the contract records fields, weights and language as data. One renderer produces the index expression and the query expression.
- **A scope's order is a default** that `orderBy` anywhere in the chain replaces.
- **Nothing is added to the schema grammar or the contract's domain plane.** Scopes declared in the schema are a possible later step.

## Non-goals

- **The class of a related model inside an include refinement.** It needs the class registry in every collection's type and is a decision of its own (ADR 258, "Later decisions").
- **A default fragment per model** (a Rails default scope).
- **A run-time guard on `deleteAll` and `updateAll`.**
- **A general `fragment` builder**; `FieldExpression` covers the need.
- **Generated or stored `tsvector` columns.** Search documents are expression indexes.
- **Combining relevance with another sort key**, highlighting a whole search document, scope kinds other than full-text, MongoDB scopes, searches that are not filters (such as MongoDB Atlas Search stages), a MySQL target, and changes to the ParadeDB extension.

## Place in the larger world

- **ORM client (`sql-orm-client`).** The `Collection` type changes shape: state and row as declared properties, `this: Self` chaining methods, the named facts, `pipe`. It gains `FieldExpression`, `rowFragment`, `RowOf`, `sortField`, and `defineIndexScopes`. Public names grow (ADR 258, "Consequences").
- **Postgres target.** Owns the weighted full-text index: the attribute with weight groups, the structured index data, its DDL, `fullTextMatches` and `fullTextRank` over weight groups, and `fulltextSearchScopes`.
- **Postgres facade (`@prisma/orm-postgres`).** Re-exports the new client surface and the scope helper.
- **Contract and emitter.** Carry the full-text index as structured data; storage hashes of contracts that declare one change.
- **Upgrades.** Instructions for: `DefaultCollectionTypeState` flags as `boolean`; reading state and row with `CollectionStateOf` and `CollectionRowOf`; `ReturnType<C['where']>` giving only `HasWhere`; explicit type arguments on `include`; the new index representation.
- **Mongo ORM client.** Out of scope; ADR 260 records the MongoDB constraints.

## Cross-cutting requirements

- **Class methods are available after every method that keeps the model's rows**, on a root collection, a chained collection, after `include`, and inside `pipe`.
- **Any function body yields a sound type.** A ternary in either order, an early return, a `switch`, a loop, and `let` with `if` all refuse `update`, `delete` and `cursor` unless every path sets the flag.
- **Nothing that compiles on an unconditional chain today stops compiling**, apart from the patterns listed under Upgrades.
- **Every fragment and scope works at every site**: a root collection, a chained collection, a collection after `select` where the fragment allows it, an include refinement, and `this` inside a custom collection class.
- **The query expression and the index expression come from one renderer.** An integration test proves the planner uses the index, with sequential scans disabled and negative controls.
- **User input stays safe.** Scope operations take a `tsquery`; `sortField` rejects names outside the allowed list at run time.
- **Type checking does not get more expensive for an application that uses none of this**, measured on `examples/prisma-8-demo`. The spike measured 9.6% fewer instantiations.
- **Every negative type test fails for the stated reason**, checked by removing the directive and reading the error.

## Transitional-shape constraints

- **Green main between slices; each slice is one independently mergeable PR.**
- **The structured full-text index lands before any scope reads it.**
- **Spike branches are deleted after the ADRs are accepted.**

## Project Definition of Done

- [ ] Team-DoD floor (repo checks, docs, upgrade instructions, Linear close-out).
- [ ] ADR 258, ADR 259 and ADR 260 are Accepted and match what shipped, including their examples.
- [ ] TML-3403 is closed by type tests for chaining class methods; the include refinement part is split into its own ticket.
- [ ] TML-3397 is closed by a test: a ternary between a filtered and an unfiltered collection refuses `deleteAll`.
- [ ] `examples/prisma-8-demo` chains its custom collection methods, has a conditional list query written with `pipe`, a shared filter typed with `FieldExpression`, and a sort field from a request.
- [ ] A model with a weighted multi-field full-text index can be searched through a scope on a root collection, a chained collection, an include refinement, and a custom collection class, with whole-result assertions.
- [ ] Results are ordered by relevance by default, a title match ranks above a body match in a test, and an explicit `orderBy` replaces that order.
- [ ] `EXPLAIN` shows the planner using the declared index for a scope query.
- [ ] A test on the built, published packages shows the chaining types, the fragment helpers and the scope helper are typed through `dist`.
- [ ] A second, test-only kind of index gets a scope helper without any change to the ORM client.

## Open questions

None. The two points left for the scope-contribution discussion are decided as ADR 260 states them:

1. **The builder form** is `defineIndexScopes({ match, operation })`, or `operations` for several, as the authoring spike recommended (`spikes/helper-authoring.md`): a type guard for the package's kind of index and an ordinary function returning a filter and a default order. Only when an argument's type depends on the index does the author add the three-line interface that names `typeof operation<this['index']>`.
2. **The index lookup reads the contract type and model name the application writes**, `fulltextSearchScopes<Contract, 'Post'>()`. That is what lets index names complete and be checked where the scopes are made, and what makes a scope a value. The step each scope returns reads the contract, model and namespace from the collection it receives only to refuse a collection of another model.
