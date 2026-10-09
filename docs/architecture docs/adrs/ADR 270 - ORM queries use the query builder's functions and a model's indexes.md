# ADR 270 — ORM queries use the query builder's functions and a model's indexes

**Status:** Accepted
**Date:** 2026-10-09
**Builds on:** [ADR 265 — A collection keeps its class through the chain](ADR%20265%20-%20A%20collection%20keeps%20its%20class%20through%20the%20chain.md), [ADR 259 — Query fragments are functions](ADR%20259%20-%20Query%20fragments%20are%20functions.md), [ADR 206 — Operations as TypeScript functions](ADR%20206%20-%20Operations%20as%20TypeScript%20functions.md), [ADR 210 — Index-type registry](ADR%20210%20-%20Index-type%20registry.md), [ADR 236 — Target-contributed model attributes](ADR%20236%20-%20Target-contributed%20model%20attributes.md)

---

## At a glance

A schema author declares a full-text index over three fields. A match in the title or subtitle counts more than a match in the body:

```prisma
model Post {
  id       Int     @id
  title    String
  subtitle String?
  body     String?

  @@fullTextIndex([[title, subtitle], body], name: "post_search")
}
```

An ORM query searches that index by its name:

```ts
const q = websearchToTsquery(input.search);

const posts = await db.Post
  .where((p, { fns, indexes }) => fns.fullTextMatches(indexes.post_search, q))
  .orderBy((p, { fns, indexes }) => fns.fullTextRank(indexes.post_search, q).desc())
  .limit(20)
  .all();
```

The same search in the SQL query builder reads the same way:

```ts
const post = db.sql.public.post;

post
  .select('id', 'title')
  .where((f, fns) => fns.fullTextMatches(post.indexes.post_search, q))
  .orderBy((f, fns) => fns.fullTextRank(post.indexes.post_search, q), { direction: 'desc' });
```

- `fns` holds the functions the SQL query builder offers: the built-in ones such as `eq`, `and` and `or`, and every operation the contract's target and extensions register, such as Postgres's `fullTextMatches` and `fullTextRank`.
- `indexes` holds the indexes of the model's table, keyed by the name the schema gave each. `indexes.post_search` carries the index's columns, weights and language from the contract.
- The query names the index and restates nothing, so the search document it renders is the one the index was built over, and Postgres uses the index.

## Decision

1. **Every ORM callback that receives a model accessor to build a condition or an order also receives a second argument, `{ fns, indexes }`.** That covers `where` and `orderBy`, wherever they are called: on a root collection, after other methods, inside a fragment, inside an include refinement, and inside a relation filter.
2. **`fns` is the SQL query builder's function surface for the contract.** Its functions accept ORM fields as arguments, because an ORM field is already a query expression. A function that returns a condition can be passed to `where` and combined with `and`, `or` and `not`. A function that returns a value has `asc()` and `desc()`, as an operation on an ORM field already does, so `orderBy` accepts it.
3. **`indexes` is the model's table's indexes, as the SQL query builder's `table.indexes` gives them.** Each is an index reference: the index's columns bound to the table as this query reads it, its type and its options. Inside an include refinement or a relation filter, the columns are bound to the related table's alias, so the reference is correct there too.
4. **The ORM and the SQL query builder share the function surface and the index reference.** Both are built by the same code, in `@internal/sql-relational-core`, which both lanes depend on, so a function or an index type added by a target or extension reaches both lanes without further work.
5. **Nothing is added to the contract, the schema language or the `Collection` type's chaining methods.** The callbacks gain an argument; existing callbacks that take one argument keep working.

## Why

### The ORM cannot search several fields today

A Postgres full-text index can span several fields in weight groups, and the contract stores its groups and language as data ([ADR 236](ADR%20236%20-%20Target-contributed%20model%20attributes.md)). A SQL query builder query can name the index, so the query reads the weights and language from the contract and cannot drift from the index.

The ORM has none of this. Its search operations attach to one field, according to the field's data type (ADR 206): `p.title.fullTextMatches(q)` searches the title alone. A search over the title and the body together, weighted as the index weights them, cannot be written in the ORM at all. An application that needs it drops to the SQL query builder.

### Naming the index is what the application wants to say

Postgres uses an expression index only for a query whose expression is the same as the index's. If a query lists the fields again, in another order or with another language, Postgres reads the whole table and reports nothing. The way to make a query match the index is to build the query from the index's own definition. An index reference does exactly that, and the SQL query builder already proves it with `EXPLAIN` in its integration tests.

So the ORM needs to name the index, not restate it.

### Reusing the query builder's functions keeps one mechanism

The alternative to `fns` is to give the index reference its own methods, `indexes.post_search.matches(q)`. That needs a second way for packages to attach operations: today an operation attaches to a field by the field's data type, and these would attach to an index by the index's type. That mechanism was designed for collection scopes (see "Later decision" below) and is a larger change than this one.

`fns` needs nothing new from packages. `fullTextMatches` and `fullTextRank` already accept an index reference as their document, and the ORM's execution context already holds the operation registry the SQL query builder reads `fns` from. Code that searches looks the same in both lanes, which is what an application moving a query between them expects.

### Why an argument, not a member of the model accessor

The model accessor's members are the model's fields. A member named `indexes` or `fns` would collide with a field of that name. The second argument has no such collision, and it is the same position the SQL query builder uses for `fns`.

## How it works

### The second argument

```ts
interface ModelCallbackTools<TContract, ModelName, NsId> {
  readonly fns: OrmFunctions<TContract>;
  readonly indexes: ModelIndexReferences<TContract, ModelName, NsId>;
}
```

`OrmFunctions<TContract>` is the SQL query builder's `Functions` for the contract, except that two kinds of result also have `asc()` and `desc()`: a query operation's result that is a value, not a condition, and the expression `fns.raw` returns. Such a result keeps its own members, such as the `within()` of ParadeDB's proximity chain. A reusable condition names the argument's type, `ModelCallbackTools<Contract, 'Post'>`, which the ORM client exports with `OrmFunctions` and `ModelIndexReferences`. The ORM builds the object once per callback call, from the collection's execution context and the table reference it already holds for the model accessor. `indexes` is a lazy getter, as on the SQL query builder's table proxy, so a callback that does not read it costs nothing at run time. `fns.raw` binds an interpolated value through the adapter's raw codec inferer, which the database clients pass to `orm({ rawCodecInferer })`.

### Where the shared code lives

`@internal/sql-relational-core/functions` holds the function surface: `Functions`, `BuiltinFunctions` and `createFunctions`. `@internal/sql-relational-core/index-reference` holds the index reference: `IndexReference`, `TableIndexReferences` and `createIndexReferences`, which keys a table's indexes by authored name and takes the column expressions from the lane that asks, so each lane binds the columns to its own table reference. The SQL query builder's `table.indexes` and `fns` and the ORM's second argument are built from these.

### Index references in the ORM

The ORM resolves the model to its storage table, as it already does for the model accessor, and builds one reference per index: its columns as column expressions on the table reference this query uses, its `type` and its `options`. The key is the index's authored name: the `name:` the schema gave it, or its `map:` name. An unnamed index, such as a foreign key's backing index, appears under its default prefix. A name more than one index of the table shares is left out of the type and refused when read, as in the SQL query builder.

A fragment for any model with given fields (ADR 259) does not know which model it runs on, so the `indexes` its body receives has no members, in its type and at run time. Its `fns` is complete.

### Ordering by a function's value

`orderBy` takes an order item, which an ORM field's `asc()` and `desc()` produce. The ORM gives a value-returning function's result the same `asc()` and `desc()`. Several `orderBy` calls append, as they do today:

```ts
db.Post
  .where((p, { fns, indexes }) => fns.fullTextMatches(indexes.post_search, q))
  .orderBy((p, { fns, indexes }) => fns.fullTextRank(indexes.post_search, q).desc())
  .orderBy((p) => p.id.asc());
```

### A reusable search

An application that searches in many places names the search once, with what already exists:

```ts
class PostCollection extends Collection<Contract, 'Post'> {
  search(query: string) {
    const q = websearchToTsquery(query);
    return this
      .where((p, { fns, indexes }) => fns.fullTextMatches(indexes.post_search, q))
      .orderBy((p, { fns, indexes }) => fns.fullTextRank(indexes.post_search, q).desc());
  }
}

db.Post.search(input.search).limit(20).all();
```

Inside an include refinement the custom class is not available (ADR 265, "Later decisions"), so the same body is written as a fragment for one model and run with `with`:

```ts
const search = (query: string) => {
  const q = websearchToTsquery(query);
  return db.Post.fragment((posts) =>
    posts
      .where((p, { fns, indexes }) => fns.fullTextMatches(indexes.post_search, q))
      .orderBy((p, { fns, indexes }) => fns.fullTextRank(indexes.post_search, q).desc()),
  );
};

db.User.where({ id }).include('posts', (posts) => posts.with(search(input.search)).limit(3));
```

## Responsibilities

| Party | Owns |
| --- | --- |
| Target or extension | Its operations, as today (ADR 206), and its index types (ADR 210). An operation that takes an index reference reads its columns and options. |
| `@internal/sql-relational-core` | The function surface (`/functions`) and the index reference (`/index-reference`), built the same way for both lanes. |
| SQL query builder | `table.indexes` and `fns` in its callbacks, as today. |
| ORM client | The second callback argument: `fns` and the model's `indexes`, bound to the table reference the query uses. |

## Consequences

- **The ORM can search several fields, weighted as the index weights them.** It also gains every other `fns` function, such as `fns.eq` between two fields and `fns.websearchToTsquery`, which until now only the SQL query builder had.
- **An operation can be written two ways in the ORM.** `p.title.fullTextMatches(q)` and `fns.fullTextMatches(p.title, q)` mean the same thing. The field form stays; it is shorter for one field.
- **The model accessor's callbacks gain a parameter in their type.** Code that annotates a callback's type with one parameter keeps compiling, because a function with fewer parameters is assignable to one with more.
- **The index's name is part of the application's code.** Renaming an index in the schema breaks the queries that name it, at compile time. This is the same as renaming a field.
- **A query can still write a search document by hand**, with `fullTextDocument(...)` from `@prisma/orm-postgres/target/full-text` or a single column. It gets no error when it differs from every index, only a sequential scan. Naming the index is the form the documentation leads with.
- **An operation whose implementation is generic loses its type parameters in the ORM.** The ORM's `fns` gives each operation's results `asc()` and `desc()` by mapping its signatures, and a mapped generic signature keeps its parameters at their constraints. Up to four overloads keep their parameters. No operation in this repository is generic or has more than two overloads; a type test checks that the ORM's `fns` keeps the SQL query builder's signature for every operation the Postgres target, pgvector, ParadeDB and PostGIS register.
- **The MongoDB ORM client is unchanged.** It has no `fns` surface and its indexes have no names in the contract.
- **Type-checking cost is small.** Measured with `tsc --extendedDiagnostics`, twice each with identical counts. On `examples/prisma-8-demo`, the merge base checks in 793,326 instantiations. With this change and the demo not using the feature, 788,361 (−0.6%); the drop comes from moving the index reference to the shared package, where its type resolves only the columns an index covers. Ten uses at different sites (`where` and `orderBy` on a root and a chained collection, an include refinement, a relation filter, a fragment, a custom collection method, a `first` filter, `fns.eq` between two fields and an `orderBy` array) add 1,287 (+0.16%). In the ORM client package, without this change's tests, 1,876,427 at the merge base and 1,885,961 with the change (+0.5%, which includes a new index in the test fixture); ten uses add 12,398 (+0.66%).

## Later decision: collection scopes built from indexes

The next step is for the ORM to offer each search index as a scope on the model's collection, so the application writes no query:

```ts
db.Post.scopes.search.fulltext(q).where({ userId }).limit(10).all();
```

That design was drafted and spiked in September 2026. The package that owns an index type supplies its scope operations through an interface the ORM defines. The ORM finds a model's scopes from its indexes in the contract, and the contract declares no scopes. A scope is reached through a reserved `scopes` member, so an index name cannot collide with a collection method. The spikes measured about 0.5% more type checking on the demo application when unused and about 2% when used. A shorter form, `db.Post.search.fulltext(q)`, was dropped for its cost.

It is a separate decision because it adds a contribution interface for packages, a reserved collection member and a type registry, and because it needs this decision first: a scope operation is a `where` and an `orderBy` that name an index, which is what this decision makes possible.

## Alternatives considered

- **A helper exported by the Postgres package**, `fulltextSearchScopes(db.Post).post_search(q)`, which reads the model's full-text indexes from the contract and returns a fragment for each. It needs a generic builder in the ORM so that each package can type its helper, and each package must write one. Naming the index in an ordinary query gives the same result without either, and leaves the automatic form to collection scopes.
- **Methods on the index reference**, `indexes.post_search.matches(q)`. It needs packages to attach operations to index types, a second attachment mechanism beside the one by data type. That mechanism belongs to collection scopes.
- **Only `fns`, with the weights written in the query**, `fns.fullTextMatches(fullTextDocument([[p.title, p.subtitle], [p.body]]), q)`. Any difference from the index silently disables it. It remains possible, but it is not the way to search an index.
- **Scopes declared in the contract's domain plane**, mapped to a storage index. A domain entry would carry nothing beyond a name the index already has, and the contract must not describe one query interface.
- **`indexes` and `fns` as members of the model accessor.** They would collide with fields of the same names.
