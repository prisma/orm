# Slice: sql-where-unique

Parent project `projects/where-unique/`. This slice gives the SQL ORM client the top-level `whereUnique`: a query that addresses at most one record, with the many-record operations uncallable afterwards.

## At a glance

`Collection` in `packages/3-extensions/sql-orm-client` gains `whereUnique(criterion)`. After it, the single-record operations work as after `where`, and the many-record methods are compile errors. `UniqueConstraintCriterion` stops admitting `null`. The include slice and the Mongo slice build on the names and rules set here.

## Chosen design

### The method

```ts
whereUnique<Self>(this: Self, criterion: UniqueConstraintCriterion<TContract, ModelName>): UniquelyFiltered<Self>;
```

- Object form only. The criterion compiles through the same path as the object form of `where` (`shorthandToWhereExpr`, then `normalizeWhereArg`), so the filter expressions are the same.
- The returned collection is the same class: `UniquelyFiltered<Self> = Self & HasWhere & HasUniqueFilter`.
- It is not callable inside an `include` refinement callback: `whereUnique` joins the members that `IncludeRefinementCollection` removes. Slice `include-unique` lifts this.
- It also throws at runtime when called on a refinement collection (`includeRefinementMode`). A model fragment's body is typed against the plain collection, so `posts.with(Post.fragment((p) => p.whereUnique(...)))` inside a refinement type-checks; the runtime refusal closes that route. The error is an `ORM.INCLUDE_INVALID`-style `ormError` naming `whereUnique`, following the existing refinement-mode check in the class.

### Type state

- `HasUniqueFilter` is `HasTypeState<{ readonly uniqueFilter: true }>`.
- `CollectionTypeState.hasUniqueFilter: boolean` and its copy in `DefaultCollectionTypeState` are removed. Nothing reads them, and the key `uniqueFilter` must be absent from the base state for the rejection to work.
- A requirement type states "the key is absent": `HasTypeState<{ readonly hasWhere: boolean; readonly uniqueFilter?: never }>`. `hasWhere` is there only so the state object is not all-optional. The spike called it `AllowsManyRows`; the name is internal and the implementer may choose a better one.

### Rejecting the many-record methods

Two forms, as the project spec's decision 3 records. Both were needed on the real class.

| Methods | Form |
|---|---|
| `all`, `aggregate`, `groupBy`, `updateAll`, `updateAndCount`, `deleteAll`, `deleteAndCount` | every overload takes `this: Self & <requirement>`, generic in `Self` |
| `prepared.all`, `prepared.aggregate` | `PreparedCollection` carries the collection's type state as a phantom member (`HasTypeState<State>`); its `all` and `aggregate` take `this: Self & <requirement>`, generic in `Self`. No member is removed, so `prepared` has the same member types on every collection. Fallback if this cannot keep a uniquely filtered collection assignable to the wide `Collection` type: leave `prepared` untouched. |
| `orderBy`, `limit`, `offset`, `cursor`, `distinct`, `distinctOn` | two overloads: first `this: Self` with `Self` constrained by a conditional that is `never` for a uniquely filtered collection; second `this: Self & <requirement>` |

Methods that stay callable after `whereUnique`: `where`, `variant`, `include`, `select`, `first`, `update`, `delete`, `with`, and the row-lock methods `forUpdate`, `forNoKeyUpdate`, `forShare`, `forKeyShare`. `upsert`, `create*` and `fragment` are unchanged.

The row-lock methods are left exactly as they are. They return a plain `Collection` for every receiver, so after `whereUnique(...).forUpdate()` the type-state facts and the user subclass are gone, `first()` is the intended call, and `all()` compiles. The project spec records this as an accepted consequence.

### The criterion type

`UniqueConstraintCriterion` maps each constraint column to the field's row type without `null`. `conflictOn` and `connect` use the same type and get the same rule.

### Exports

`HasUniqueFilter` and `UniquelyFiltered` are exported from the package, next to `HasWhere` and `Filtered`. Without them an exported uniquely filtered chain fails declaration emit.

## Coherence rationale

Everything here is one statement about the SQL collection's types: a uniquely filtered collection exists, and each method either accepts it or refuses it. The `null` exclusion is the same statement applied to the argument. A reviewer reads one method, one type-state fact, and a uniform change to twelve signatures.

## Scope

**In:**

- `whereUnique` on `CollectionBase`, with its runtime compilation.
- The type-state fact, the requirement, and the overload changes on the twelve methods above.
- `null` removed from `UniqueConstraintCriterion`.
- `whereUnique` removed from the refinement collection.
- Type tests and unit tests in the package; integration tests against a database.
- Exported uniquely filtered chains added to `examples/prisma-8-demo/test/collection-chaining.types.test-d.ts`, which is where declaration emit is checked.
- The package README section.
- Upgrade-instruction declarations: an `extension` one for the `null` exclusion, and an `app` one because a file under `examples/` changes.

**Out:**

- `whereUnique` inside `include` refinements, the runtime flag in `CollectionState`, and `combine()` branches: slice `include-unique`.
- The Mongo ORM: slice `mongo-where-unique`.
- A runtime check for a user scope or a `with(fragment)` that adds an order or a limit to a uniquely filtered collection. The project spec lists detecting that as a non-goal.
- Any change to `where(...).update()` and `where(...).delete()`.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --- | --- | --- |
| The spike patch no longer applies | Re-establish the encoding on current `main` first | The patch was written against `7bc1b4dd20`. `main` has since gained query fragments (`with`, `fragment`, `fragments.ts`), row locks and runtime write guards in this package. If the encoding cannot be made to pass the package's type tests and the dependents' typecheck on the new code, stop and return to design discussion. |
| A non-generic `this: <requirement>` | Do not use it | It rejects nothing: an intersection is assignable when any one member is. |
| `this: this & <requirement>` on a fallback overload | Do not use it | It breaks calls on a union of collections and on an `Omit` of a collection; `collection-conditionals` and `collection-guards` type tests cover both. |
| Only the `Self & <requirement>` form on a method returning the collection | Do not use it | An exported `plain.User.where(...).orderBy(...)` then stops printing as `Collection<...>` and fails declaration emit in the demo. |
| A non-generic `this` in the second overload of those methods | Do not use it | A user class method such as `after(id) { return this.ordered().cursor({ id }) }` loses its polymorphic return type; the demo's `declaration-consumer` fixture covers it. |
| Fragments | Check, do not assume | A fragment body or a `with(fn)` callback that calls a many-record method runs against a receiver type; confirm the existing fragment type tests still pass and that a uniquely filtered collection is accepted by `with`. |
| `prisma7-adoption` typecheck | Ignore | It fails on a Prisma 7 engine download on this machine, before compiling. |

## Slice-specific done conditions

- [ ] `pnpm turbo typecheck --continue --filter="...@internal/sql-orm-client" --filter="!prisma7-adoption"` passes, and the demo's `declaration-emit` test passes.
- [ ] `pnpm check:upgrade-coverage --mode pr` passes against the PR base.

## Open Questions

None.

## References

- Parent project: `projects/where-unique/spec.md`
- Spike: `projects/where-unique/spikes/rejection-encoding.patch` (against `7bc1b4dd20`; evidence, not the implementation)
- Linear issue: none
