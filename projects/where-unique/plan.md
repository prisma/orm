# where-unique — Plan

**Spec:** `projects/where-unique/spec.md`
**Linear Project:** none. No Linear project or issues exist for this work yet.

## At a glance

The project has three slices.

1. The first adds `whereUnique` to the SQL ORM client at the top level of a query.
2. The second makes `whereUnique` usable inside an `include` refinement, where it yields one value instead of an array. It is stacked on the first.
3. The third adds `whereUnique` to the Mongo ORM. It shares no code with the SQL slices and can run alongside the second, after the first has merged.

## Composition

### Stack (deliver in order)

1. **Slice `sql-where-unique`**. Linear: none. Folder: `projects/where-unique/slices/sql-where-unique/`
   - **Outcome:** On the SQL ORM client:
     - `whereUnique(criterion)` exists on every collection, accepts one object per primary key or unique constraint, and returns `UniquelyFiltered<Self>`;
     - after it, `where`, `variant`, `include`, `select`, `first`, `update` and `delete` work with unchanged result types, and every many-record method in the spec's "At a glance" table is a compile error;
     - `UniqueConstraintCriterion` no longer admits `null`, so `conflictOn` and `connect` reject it too;
     - `whereUnique` is not callable inside an `include` refinement callback.
   - **Builds on:** Nothing. The encoding is already proven on the real class; see `spikes/rejection-encoding.patch` and spec decision 3.
   - **Hands to:**
     - the exported facts `HasUniqueFilter` and `UniquelyFiltered<C>`;
     - the rejection requirement on the many-record methods, in the two forms decision 3 describes;
     - `whereUnique` listed among the members removed from the refinement collection, which slice 2 lifts.
   - **Focus:**
     - the `whereUnique` method and its compilation to the same filter expressions as the object form of `where`;
     - removing `CollectionTypeState.hasUniqueFilter` and adding the absent-key requirement;
     - the overload changes on `orderBy`, `limit`, `offset`, `cursor`, `distinct`, `distinctOn`, `all`, `aggregate`, `updateAll`, `updateAndCount`, `deleteAll` and `deleteAndCount`;
     - the `null` exclusion in `UniqueConstraintCriterion`, with its upgrade instruction for callers of `conflictOn` and `connect`;
     - type tests for every accepted and rejected argument shape and every available and rejected call, including a user subclass whose scopes call many-record methods on `this`;
     - integration tests for `first`, `update` and `delete` after `whereUnique`, with a compound key and with an include;
     - exported uniquely filtered chains in the demo's declaration tests, so declaration emit stays covered;
     - the package README section.

     The spike patch is evidence, not the implementation: its `whereUnique` body, its internal names and its test are rewritten here, tests first.

2. **Slice `include-unique`**. Linear: none. Folder: `projects/where-unique/slices/include-unique/`
   - **Outcome:** Inside an `include` refinement on a to-many relation, a refinement that calls `whereUnique` gives the relation the type `Row | null` and returns one value or `null` at runtime. A uniquely filtered `combine()` branch does the same. The refinement scalars (`count()`, `sum()`, …) are a compile error after `whereUnique`. A to-one relation is unchanged.
   - **Builds on:** Slice 1's `HasUniqueFilter` fact and its removal of `whereUnique` from the refinement collection.
   - **Hands to:** Project close-out for the SQL side. The spec's include example type-checks and runs.
   - **Focus:**
     - a runtime flag in the collection state, set by `whereUnique`, since type state does not exist at runtime and `include()` only sees the refined collection's state;
     - a "single value" indication on the include, separate from the relation's cardinality (which also describes the join), read at both result-shaping sites in `collection-dispatch.ts`;
     - the added branch in `RefinedIncludeRelationValue`;
     - tracing how `combine()` branch values are typed and shaped, then applying the same rule;
     - the model-fragment route: slice 1 makes `whereUnique` throw on a refinement collection, because `posts.with(Post.fragment((p) => p.whereUnique(...)))` type-checks there and `with` returns the fragment's result type without `HasUniqueFilter`. Lifting the refusal would give a single value at runtime under an array type, so this slice must settle that route before it removes the throw;
     - type tests and integration tests, including a many-to-many relation and a nested include;
     - the README addition.

### Parallel group A (after slice 1; independent of slice 2)

- **Slice `mongo-where-unique`**. Linear: none. Folder: `projects/where-unique/slices/mongo-where-unique/`
  - **Outcome:** On the Mongo ORM, `whereUnique(criterion)` accepts `{ _id }` or one object per admitted unique index and returns `MongoUniquelyFilteredCollection`, which offers `where`, `variant`, `include`, `select`, `first`, `update`, `delete` and `upsert` and nothing else. `null` values, partial unique indexes and indexes on embedded paths are not accepted.
  - **Builds on:** Nothing in code. It follows slice 1 by the spec's ordering, and reuses its decisions on names and on the rule that an argument must guarantee at most one record.
  - **Hands to:** Project close-out. Both families satisfy the spec's cross-cutting requirements.
  - **Focus:**
    - `MongoUniqueIndexCriterion`, derived from the storage collection's `indexes` tuple in the emitted contract type: `unique: true`, no `partialFilterExpression`, every key a top-level scalar field of the model;
    - the `MongoUniquelyFilteredCollection` interface over the existing `MongoCollectionImpl`, with every method that stays on it returning the same interface;
    - type tests against a contract that has a plain unique index, a compound one, a partial one (the variant-scoped index in `examples/mongo-demo` is the existing case) and a model with only `_id`;
    - integration tests for `first`, `update`, `delete` and `upsert` after `whereUnique`;
    - the package README section.

## Dependencies (external)

- [ ] **Package release.** Users get each slice through the next published release after it merges. The workspace is at `8.0.0-rc.14`; no release carrying this work is published yet.
- [ ] **Linear.** No project or issues exist. If the work is tracked in Linear, use one issue per slice so that a slice PR merging does not close the others.

## Sequencing rationale

- **Why SQL first.** It carried the project's one technical risk, the rejection encoding, and it settles the shared names and rules the Mongo slice follows.
- **Why the include change is its own slice.** It adds runtime state and changes result shaping, which the top-level method does not need; reviewing it together with twelve reshaped method signatures would be two reviews in one PR. Slice 1 keeps `whereUnique` out of refinement callbacks, so the array form never ships and slice 2 is not a breaking change.
- **Why Mongo is not stacked on slice 2.** It touches a different package and none of slice 2's code. It can start as soon as slice 1 has merged.
