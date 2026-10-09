# Slice 4: ORM queries name an index

**Project:** [spec](../../spec.md), [plan](../../plan.md). **Design:** [ADR 270](../../../../docs/architecture%20docs/adrs/ADR%20270%20-%20ORM%20queries%20use%20the%20query%20builder's%20functions%20and%20a%20model's%20indexes.md).

## At a glance

```ts
db.Post
  .where((p, { fns, indexes }) => fns.fullTextMatches(indexes.post_search, q))
  .orderBy((p, { fns, indexes }) => fns.fullTextRank(indexes.post_search, q).desc())
  .limit(20)
  .all();
```

## Chosen design

- **The second argument.** Every ORM callback that receives a model accessor and returns a condition or an order item receives `{ fns, indexes }` as its second argument. That is `where` and `orderBy` on a collection, the same methods inside an include refinement and inside fragment bodies, and the predicate callbacks of relation filters (`some`, `every`, `none`). Existing one-parameter callbacks, including row fragments typed with `CodecField`, keep compiling.
- **`fns`.** The SQL query builder's function surface for the contract: the built-in functions and every registered query operation, typed as the SQL query builder types them for the same contract. ORM fields are accepted where a function takes an expression. A result that is not a condition gets `asc()` and `desc()` in the ORM, as a field operation's result already does, so `orderBy` takes it. A condition result composes with `and`, `or` and `not` and goes to `where`.
- **`indexes`.** The indexes of the table the collection's model is stored in, keyed by authored name (the `name:` prefix, else the `map:` name), each an index reference `{ columns, type, options }` whose columns are column expressions on the table reference the query uses: the root table, or the alias the ORM gives a related table in an include refinement or a relation filter. A name more than one index shares is absent from the type and refused with `ORM.ARGUMENT_INVALID` when read. The getter is lazy.
- **Fragments for any model** (`db.orm.fragment(fields, body)`): the body's callbacks receive `fns` and an `indexes` with no members.
- **Shared code.** The function surface (`Functions`, `createFunctions`) and the index reference (type and construction) move out of `sql-builder` into a package both lanes depend on, most likely `@internal/sql-relational-core`. `sql-builder` keeps its public behaviour unchanged. `pnpm lint:deps` decides the final home.
- **Variants.** On a collection narrowed by `variant`, `indexes` is the indexes of the base model's table. A variant stored in its own table (multi-table inheritance) does not expose that table's indexes in this slice.

## Coherence rationale

One addition with one shape: the ORM's callbacks gain what the SQL query builder's callbacks already have. The run-time pieces exist (ORM fields are query expressions, `where` accepts an expression, the Postgres operations accept an index reference, the execution context holds the operation registry); the work is sharing the code and typing the argument.

## Scope

In: `packages/3-extensions/sql-orm-client` (callback signatures and their implementation, model accessor construction, types, README), `packages/2-sql/4-lanes/sql-builder` and the shared package the function surface and index reference move to, `packages/9-public/@prisma/orm-postgres` re-exports if a new public type is needed, `examples/prisma-8-demo` (an ORM search over a weighted index), `skills-contrib/prisma-8` references for ORM full-text search, ADR 270, ADR 236's paragraph on naming the index.

Out: collection scopes built from indexes; methods on index references; the MongoDB ORM client; `having` on grouped collections; aggregate functions in ORM callbacks; multi-table inheritance variant tables.

## Pre-investigated edge cases

- `where` has three overloads (callback, direct expression, shorthand object). A callback with two parameters must still select the callback overload, and the shorthand object must not be read as a callback.
- `orderBy` accepts a callback or an array of callbacks; each element receives the second argument.
- A row fragment written as `(row: { deletedAt: DeletedAt }) => ...` must keep matching the callback type.
- Inside an include refinement and a relation filter, the ORM qualifies columns with an alias. The index reference's columns must use the same alias, or Postgres fails with "missing FROM-clause entry". Prove it with a query that includes and filters on the same model.
- `fns.fullTextMatches` refuses a non-full-text index at run time with `RUNTIME.ARGUMENT_INVALID`, and its type refuses one at compile time; both must hold through the ORM.
- `ORM.*` and `RUNTIME.*` error prefixes: the ambiguous-name refusal reuses the SQL query builder's `ORM.ARGUMENT_INVALID`.
- Type cost: measure `examples/prisma-8-demo` and the client package before and after, unused and with ten uses at different sites, and record the numbers in ADR 270. The argument's type must not be rebuilt per receiver type (ADR 265's cost lessons: infer from `this` parameters, avoid the polymorphic `this` in large signatures).

## Slice-specific done conditions

- Type tests: `fns` and `indexes` in `where` and `orderBy` on a root collection, a chained collection, an include refinement, a relation filter, `this` in a custom class, and the body of a fragment for one model; a misspelled index name, a non-full-text index passed to `fullTextMatches`, and `language` passed with an index are compile errors; one-parameter callbacks and `CodecField` row fragments still compile.
- Integration tests against a real Postgres (one file, run alone): an ORM search over a weighted index returns whole-shape results at each site above; a title match ranks above a body match; `EXPLAIN` with sequential scans disabled shows the index used, with a negative control that restates different groups.
- The demo searches posts over a weighted index through the ORM, and its test exercises it.
- `examples/prisma-8-demo` declaration-emit test still passes; a type test through `dist` covers the second argument.
- Cost recorded in ADR 270.

## Open questions

None.
