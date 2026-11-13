# Slice: nested-variant-creates

Parent project `projects/nested-mutations/`. Outcome this slice contributes: a relation's mutator has `variant(value)`, and a nested create through it writes a complete row of that variant, whether the variant is stored in the base table or in its own table.

## At a glance

Inside `create()` and `update()` data, a relation callback on a polymorphic target can call `t.variant('feature')` and get the relation's mutator for that variant, as `db.Task.variant('feature')` gives the collection for that variant. `t.variant(v).create(…)` takes the base's fields plus the variant's own fields, without the discriminator, and writes the base row and, for a variant stored in its own table, the variant row. `connect`, `disconnect`, `where`, `updateAll` and `deleteAll` on the variant mutator act only on rows of that variant. `t.create(…)` without `variant()` on a polymorphic target becomes a type error, as `db.Task.create(…)` without `variant()` is.

```ts
await db.Project.where({ id: 1 }).update({
  tasks: (t) => [
    t.variant('bug').create({ title: 'Crash', severity: 'high' }),
    t.variant('feature').create([{ title: 'Dark mode', priority: 1 }]),
    t.variant('feature').where({ priority: 3 }).updateAll({ priority: 2 }),
    t.variant('bug').connect({ id: 7 }),
  ],
});
```

Illustrative; re-verify names against shipped code.

## Chosen design

**Rule for every decision below: the nested API does what the top-level `variant()` collection does** (decided 2026-11-13 by the project owner). A behaviour of the top-level API is followed unless it looks wrong, and then it is raised with the owner before it is built.

### What the top-level API does today

| Top-level call | Types | Runtime |
| --- | --- | --- |
| `db.Task.create(data)` on a polymorphic base | first overload's data is `never` (`ResolvedCreateInput`) | no check; a cast row is written as base fields (`polymorphism.test.ts:145` relies on it) |
| `db.Task.variant(v)` | returns a full collection of the variant | adds the discriminator filter to the collection's filters; refuses an undeclared value and a second `variant()` call |
| `.variant(v).create(data)` | `VariantCreateInput`: base `CreateInput` without the discriminator, plus the variant's `CreateInput`, both with relation fields | the ORM sets the discriminator. Variant in the base table: one `Insert`; callbacks on base relations run; a callback on a relation of the variant fails with `ORM.FIELD_UNKNOWN`. Variant in its own table: `createAllVariantGraph`, needs capability `returning`; every relation callback fails with `ORM.FIELD_UNKNOWN` (`variantCreateRowsOf` maps every key through `columnOfCallerField`) |
| `.variant(v).where(w).update/updateAll/delete/deleteAll` | variant-aware accessor in `where` | variant in the base table: discriminator filter; in its own table: `countMutationWhere` turns the condition into `pk IN (subquery over the variant table)` |
| `createAndCount`, `upsert`, `onConflict: 'skip'` on a variant in its own table | accepted | `ORM.OPERATION_UNSUPPORTED` |

### Surface

- `RelationMutator` gains `variant(value)`, typed as the collection's `variant()`: `value` is one of the target's discriminator values, and the method exists only when the target is a polymorphic base. It returns the **variant mutator**: the same methods as the mutator, each acting on that variant.
- The mutator's `variant` is built from the related collection's `variant(value)`. The runtime errors for an undeclared value and for a second `variant()` call are the collection's.
- **`create` on the variant mutator** takes one row or an array, typed as `VariantCreateInput` with the nested-create relaxation `MutationCreateInput` already applies (foreign keys that link to the parent are optional). Runtime is the top-level one: the ORM sets the discriminator; relation callbacks inside the row behave as in the table above.
- **`create` on the mutator without `variant()`** on a polymorphic target: its data becomes `never`, as the collection's `ResolvedCreateInput`. There is no runtime check, as at top level; a row passed past the types is written as today. The upgrade instructions for app authors describe the change.
- **`connect(criteria)`** on the variant mutator finds the row by the criteria and the variant condition; a row of another variant is not found and raises `ORM.RELATION_ROW_MISSING`.
- **`disconnect`** on the variant mutator is available where the target holds the link or a junction does (1:N, 1:1, M:N): the variant condition is added to the unlink `Update` or to the junction `Find`. On a relation whose key is on the parent (N:1), `disconnect`'s parameter is `never` on the variant mutator: today the parent's `Update` sets the key to null without reading the linked row, and an unlink limited to a variant needs the conditional unlink of slice `single-row-writes`. **When this branch is rebased onto `single-row-writes`, N:1 `disconnect` on the variant mutator is built in this slice on that unlink** (decided 2026-11-13).
- **`where`, `updateAll`, `deleteAll`** on the variant mutator: the descriptor holds the state of the variant collection, so the filter includes the variant condition. The `where` callback receives the variant-aware accessor, as `db.Task.variant(v).where(…)` does.
- Every rejection that applies to the mutator applies to the variant mutator unchanged (`create()` context, to-one, parent-link columns, array length on to-one).

### Translation

The create descriptor carries the variant value (`variant?: string`); `connect` and `disconnect` descriptors carry the variant collection's state, or its variant value, so the translation can add the variant condition. Filtered writes already carry state.

| Variant stored in | Nested create |
| --- | --- |
| Base table | one `Insert` from `createRowOf(…, variantValue, …)`: the discriminator is set and the variant's fields map to base-table columns. Through `addCreateWithRelations` with `variantValue` set, as top-level `createGraph`. |
| Own table | per row, the chain of `createAllVariantGraph`: an `Insert` into the base table, then an `Insert` into the variant table with a `PayloadData` edge from the base `Insert` for the key. The parent link is on the base `Insert`: its `PayloadData` from the parent on 1:N and 1:1, the parent's `PayloadData` from it on N:1, the junction `Insert`'s `PayloadData` from it on M:N. No `CrossJoin`: nothing reads the joined row. Refused without capability `returning`, as `createAll()` on such a variant. |

The variant table is aliased by the related collection's table scope, as the top-level variant create does. The base-table row and variant-table row splitting and the create defaults come from the functions top-level uses (`variantCreateRowsOf` or a part of it shared with it), not from a copy.

For `connect`, `disconnect` and filtered writes the variant condition is the one the collection builds: the discriminator `eq` for a variant in the base table, `pk IN (subquery over the variant table)` for one in its own table (`countMutationWhere`). Graph tests show which nodes get it.

```text
db.Project.where({ id: 1 }).update({ tasks: (t) => t.variant('feature').create({ title: 'Dark mode', priority: 1 }) })

n1 Find projects_tbl where id = 1
n2 Insert tasks { title, type: 'feature' }      <- PayloadData n1 (id->project_id)
n3 Insert features { priority: 1 }              <- PayloadData n2 (id->id)
result: n1
```

Illustrative; the printed form is the one the graph tests use.

## Size and PR split

Estimate before code: types and type tests about 350 lines; mutator runtime and translation about 250; graph unit tests about 200; integration tests on Postgres and SQLite about 400, including fixture additions; README, query docs and upgrade entry about 100. About 1,300 lines, so the slice ships as **two stacked PRs** of about 650 lines each, each complete on its own:

1. **Variant creates.** `variant()` on the mutator with `create` only on the variant mutator; the base `create` becomes `never` on a polymorphic target; both storage layouts on every relation layout, in `create()` and `update()`; tests, docs, upgrade entry. The other methods are absent from the variant mutator's type in this PR, so no exposed method is unimplemented (project constraint: each slice ships complete operations).
2. **Variant scoping of the other operations.** `connect`, `disconnect` (not N:1), `where`, `updateAll`, `deleteAll` on the variant mutator, with tests and docs.

## Coherence rationale

Both PRs are one change: the relation mutator gets the `variant()` the collection already has, and each operation on it does what the same operation does on the variant collection. PR 1 is the part the project DoD requires; PR 2 completes the mutator so it mirrors the collection, and reviews on its own because it touches only the descriptors of existing operations and their conditions.

## Scope

**In:** `RelationMutator.variant` and the variant mutator's types (`src/types.ts`) and runtime (`src/relation-mutator.ts`); the descriptor fields; the translation in `src/mutation-graph/nested-mutations.ts` for both storage layouts on 1:N, 1:1, N:1 and M:N; the variant condition on `connect`, `disconnect`, filtered writes; type tests (`test/*.test-d.ts`); graph tests in printed form; integration tests on Postgres and SQLite in `create()` and `update()`, one row and an array, on each relation layout the fixtures have, with a check that rows of another variant are left unchanged by `connect`, `disconnect`, `updateAll` and `deleteAll`; fixture additions to `test/integration/test/sql-orm-client/fixtures/polymorphism/contract.prisma` (and the SQLite builder contract) for the layouts it lacks (N:1 to a variant in its own table, M:N to `Task`), regenerated with the repo's fixture commands; the package README and user-facing query docs; an upgrade-instructions entry for app authors about `t.create` on a polymorphic target.

**Out:**
- N:1 `disconnect` on the variant mutator until rebased onto `single-row-writes` (then in).
- Relation callbacks inside a variant create that top level refuses (a relation of the variant; any relation for a variant in its own table). The types of both levels accept them and the runtime of both levels refuses them; making the two levels agree is a follow-up for both.
- The collection's second `create` overload (`MutationCreateInputWithRelations`), which accepts a polymorphic base's fields plus a relation callback without `variant()`; a follow-up for the top-level API.
- `onConflict` on nested variant creates (slice `create-on-conflict`, which refuses it on variants stored in their own table).
- `upsert`, `update`, `delete` on the variant mutator (slices `nested-upsert`, `single-row-writes`).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --- | --- | --- |
| A nested create on a polymorphic target without `variant()`, passed past the types | Written as today | Base fields only, as top-level `create` with a cast; no runtime check (owner decision 2026-11-13). |
| A variant in its own table on a contract without `returning` | Refused as `createAll()` refuses it | `assertReturningCapability`; check the SQLite without-returning test contract. |
| The discriminator passed in the variant's data | As top level | Absent from the types; the ORM's value is written. |

## Slice-specific done conditions

- [ ] The plan entry for slice 7 records the decisions above in place of its open questions.
- [ ] After a rebase onto `single-row-writes`, N:1 `disconnect` on the variant mutator is implemented and tested before this slice's last PR merges.

## Open Questions

None. Decided in the 2026-11-13 discussion: `t.create` without `variant()` on a polymorphic target is a type error with no runtime check; the variant mutator has every mutator operation scoped to the variant, with N:1 `disconnect` deferred to the rebase onto `single-row-writes`; relation callbacks inside a variant create behave as at top level.

## References

- Parent project: `projects/nested-mutations/spec.md`; plan entry: `projects/nested-mutations/plan.md` slice 7
- Design record: `projects/nested-mutations/mutation-graph.md`
- Slice specs it builds on: `slices/graph-creates/spec.md` (variant chain), `slices/filtered-many-writes/spec.md` (mutator shape)
- Code: `src/collection.ts` (`variant()`, `#create`, `#createAllRows`, `#refuseOnMtiVariant`), `src/mutation-graph/storage-rows.ts` (`createRowOf`, `variantCreateRowsOf`, `mtiCreateContextOf`), `src/mutation-graph/collection-graphs.ts` (`createGraph`, `createAllVariantGraph`, `countMutationWhere`), `src/types.ts` (`ResolvedCreateInput`, `VariantCreateInput`, `RelationMutator`)
- Linear issue: none (project not tracked in Linear by owner decision)
