# Collection chaining, query fragments and weighted full-text search

**Design records:** [ADR 265 — A collection keeps its class through the chain](../../docs/architecture%20docs/adrs/ADR%20265%20-%20A%20collection%20keeps%20its%20class%20through%20the%20chain.md) (Accepted), [ADR 259 — Query fragments are functions](../../docs/architecture%20docs/adrs/ADR%20259%20-%20Query%20fragments%20are%20functions.md) (Accepted), [ADR 270 — ORM queries use the query builder's functions and a model's indexes](../../docs/architecture%20docs/adrs/ADR%20270%20-%20ORM%20queries%20use%20the%20query%20builder's%20functions%20and%20a%20model's%20indexes.md) (Proposed).

## Purpose

A developer writes named queries once, as methods of a collection class or as functions, and uses them anywhere a collection of the model appears, with the collection's type staying sound however the query is composed. A query can search a weighted full-text index over several fields by naming the index, in the ORM as in the SQL query builder, so the search cannot miss the index.

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
class PostCollection extends Collection<Contract, 'Post'> {
  published()   { return this.where((p) => p.publishedAt.isNotNull()); }
  newestFirst() { return this.orderBy((p) => p.publishedAt.desc()); }
  search(q: TsqueryArgument) {
    return this
      .where((p, { fns, indexes }) => fns.fullTextMatches(indexes.post_search, q))
      .orderBy((p, { fns, indexes }) => fns.fullTextRank(indexes.post_search, q).desc());
  }
}

const posts = await db.Post
  .published()
  .with((posts) => (input.q ? posts.search(websearchToTsquery(input.q)) : posts))
  .newestFirst()
  .limit(20)
  .all();
```

- Class methods chain, before and after built-in methods.
- `with` runs any function. The conditional yields a collection whose search filter is not known; `published()` already made it filtered, so `update` is allowed.
- `search` names the index `post_search`. Its weights and language come from the contract, so the query uses the index.

## Vocabulary

- A **query fragment**, or **fragment**, is a function from a collection to a collection, run with `collection.with(fn)`.
- A **scope** is a fragment that only imposes conditions on the query. The word is kept free for a later per-model default scope.
- A **row fragment** is a function of the model accessor, which `where` and `orderBy` take.
- Public names: `QueryFragment`, `DeclaredFieldsFragment`, `FragmentFacts`, `db.orm.fragment(fields, body)`, `collection.fragment(body)`, `collection.with(fn)`.

## Where things stand (2026-10-09)

- **Slice 1, a collection keeps its class through the chain:** merged (ADR 265).
- **Slice 2, fragment helpers:** merged (ADR 259), then renamed: `apply` → `with`, `scope` → `fragment`, `Fragment` → `QueryFragment`, `FieldFragment` → `DeclaredFieldsFragment`.
- **A foreign key names its backing index, and the contract build removes duplicate indexes:** merged (ADR 161, section "A foreign key names its backing index").
- **Slice 3, the weighted full-text index:** merged. `@@fullTextIndex` takes weight groups, the contract stores `fullText` indexes as `{ weightGroups, language }`, one renderer produces the index and the query expression, and the SQL query builder names an index with `table.indexes.<name>` (ADR 210, ADR 236).
- **The ORM cannot search several fields.** Its search operations attach to one field (`p.title.fullTextMatches(q)`), it has no `fns`, and it cannot name an index. Slice 4 closes this.
- **Defects found on main** (TML-3543): the row-lock methods drop a custom class from the type, `where(x).fragment(body)` silently drops the `where`, and the pending upgrade instruction for the query fragment type names starts from the wrong release.

## Decided

- **A chaining method has the shape of a fragment** (ADR 265). The type state and the row are declared properties; unknown flags are `boolean`. A filtered collection is a subtype of an unfiltered one, so any function body is sound. The query API has no control-flow methods; `when()` is rejected.
- **Query fragments are functions** (ADR 259): `db.orm.fragment(fields, body)` for any model with the given fields, `collection.fragment(body)` for one model, `orderByField` for an order field from a request. A fragment's fields are declared with the contract DSL's field builders or `{ codecId, nullable }`, never by pointing at a model's field.
- **The weighted full-text index is data in the contract**, and a query names the index rather than restating it.
- **ORM callbacks for `where` and `orderBy` receive a second argument, `{ fns, indexes }`** (ADR 270): the SQL query builder's functions, and the model's table's indexes as index references. Packages need no new mechanism.
- **Nothing is added to the schema grammar, the contract's domain plane, or the `Collection` type's chaining methods.**

## Later decision: collection scopes built from indexes

The ORM offers each search index as a scope on the model's collection, so the application writes no query: `db.Post.scopes.search.fulltext(q).where(...)`. Designed and spiked in September 2026 (draft ADR "Collection scopes derived from indexes" on branch `spike-collection-scope-declared`; `spikes/type-composition.md`, `spikes/declared-scopes.md`): the package that owns an index type supplies scope operations through an ORM-defined interface, the ORM derives a model's scopes from its indexes, and the contract declares none. ADR 270 records it under "Later decision". It is designed after this project closes.

## Non-goals

- **Collection scopes built from indexes** (above).
- **A default scope per model** (a Rails default scope).
- **The class of a related model inside an include refinement** (ADR 265, "Later decisions").
- **A run-time guard on `deleteAll` and `updateAll`.**
- **Selecting fields by shape across models.**
- **Generated or stored `tsvector` columns, MongoDB, a MySQL target.**

## Place in the larger world

- **ORM client (`sql-orm-client`).** The second callback argument on `where` and `orderBy`, with `fns` and the model's index references.
- **SQL query builder (`sql-builder`) and a package both lanes use.** The function surface and the index reference move to code both lanes share.
- **Postgres target.** No change for slice 4: `fullTextMatches` and `fullTextRank` already accept an index reference.
- **Postgres facade (`@prisma/orm-postgres`).** Re-exports whatever new public types the callback argument needs.
- **Upgrades.** None expected for slice 4: the change is additive.

## Cross-cutting requirements

- **Class methods are available after every method that keeps the model's rows**, including the row-lock methods.
- **Any function body yields a sound type.**
- **Nothing that compiles today stops compiling**, apart from patterns covered by upgrade instructions.
- **A search written by naming an index works at every site**: a root collection, a chained collection, an include refinement, a relation filter, `this` in a custom class, and the body of a fragment for one model.
- **The query expression and the index expression come from one renderer**, proven with `EXPLAIN` against a real database, with negative controls.
- **User input stays safe.** Search operations take a `tsquery`; `orderByField` rejects names outside the allowed list.
- **Type checking does not get more expensive for an application that uses none of this**, measured on `examples/prisma-8-demo`.
- **Every negative type test fails for the stated reason**, checked by removing the directive and reading the error.

## Project Definition of Done

- [ ] Team-DoD floor (repo checks, docs, upgrade instructions, Linear close-out).
- [ ] ADR 265 and ADR 259 Accepted and matching what shipped (done); ADR 270 Accepted and matching what ships.
- [ ] TML-3403 closed by type tests for chaining class methods; the include-refinement part filed as its own ticket.
- [ ] TML-3397 closed by a test: a ternary between a filtered and an unfiltered collection refuses `deleteAll` (done).
- [ ] TML-3543 merged: the lock methods keep the class, `fragment` refuses a receiver with query state, the upgrade instruction starts from rc.17.
- [ ] `examples/prisma-8-demo` chains its custom collection methods (done), has a conditional list query written with `with`, a shared filter typed with `CodecField` in its source, a sort field from a request (done), and searches posts across weighted fields through the ORM by naming the index.
- [ ] An ORM query that names a weighted full-text index works on a root collection, a chained collection, an include refinement, a relation filter and a custom class method, with whole-result assertions.
- [ ] A title match ranks above a body match through the ORM.
- [ ] `EXPLAIN` shows the planner using the declared index for an ORM query that names it.
- [ ] A test on the built packages shows the chaining types, the fragment helpers and the second callback argument typed through `dist`.

## Open questions

None.
