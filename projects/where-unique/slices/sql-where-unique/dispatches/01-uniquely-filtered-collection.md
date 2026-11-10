# Brief: D1 — uniquely filtered collection

## Task

In `packages/3-extensions/sql-orm-client`, add `whereUnique(criterion)` to the collection class and make the twelve many-record methods refuse a uniquely filtered collection at compile time, following the slice spec's "Chosen design". Write the type tests first and watch them fail, then implement.

## Scope

**In:**

- `whereUnique` on `CollectionBase` (`src/collection.ts`), object form only, compiling through the same path as the object form of `where`.
- `HasUniqueFilter`, `UniquelyFiltered<C>` and the internal "key is absent" requirement in `src/collection-types.ts`; removal of `hasUniqueFilter` from `CollectionTypeState` and `DefaultCollectionTypeState` (`src/types.ts`) and from any test that names it.
- The overload changes on `orderBy`, `limit`, `offset`, `cursor`, `distinct`, `distinctOn`, `all`, `aggregate`, `updateAll`, `updateAndCount`, `deleteAll`, `deleteAndCount`.
- `whereUnique` added to the members the include refinement collection removes (`src/collection-internal-types.ts`).
- `HasUniqueFilter` and `UniquelyFiltered` exported from `src/exports/index.ts`, and re-exported wherever `HasWhere` / `Filtered` are re-exported for users.
- Package type tests (`test/*.types.test-d.ts`) and a unit test showing `whereUnique` produces the same compiled filter as `where` with the same object.

**Out:**

- Removing `null` from `UniqueConstraintCriterion` (dispatch 2).
- Integration tests, `examples/**`, the README, upgrade-instruction declarations (dispatches 2 and 3).
- Anything about `include` refinements beyond hiding the method; no runtime flag in `CollectionState`.
- The Mongo ORM.

## Completed when

- [ ] A type test file covers: each single-record call after `whereUnique` (`first`, `update`, `delete`, a following `where`, `variant` where the fixture allows, `include`, `select`, `with`, a row-lock method) with its result type; each of the twelve many-record methods rejected, also after a following `where`, `include` and `select`; a non-unique field, a partial compound key and a callback rejected as arguments; a compound key accepted; `whereUnique` absent inside an `include` refinement callback; a user subclass whose methods call `orderBy`, `limit`, `offset`, `all`, `aggregate` and `where(...).deleteAll()` on `this`, and whose own methods are callable after `whereUnique`.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm lint` pass in `packages/3-extensions/sql-orm-client`.
- [ ] `pnpm turbo typecheck --continue --filter="...@internal/sql-orm-client" --filter="!prisma7-adoption"` passes from the repo root.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal — even if it looks useful — halts and surfaces.

## References

- Slice spec: `projects/where-unique/slices/sql-where-unique/spec.md` — read "Chosen design" and the whole "Pre-investigated edge cases" table before writing any signature. Each row is a form that was tried on the real class and failed, with the test that caught it.
- Slice plan entry: `projects/where-unique/slices/sql-where-unique/plan.md` § Dispatch 1.
- Project spec decision 3: `projects/where-unique/spec.md`.
- Spike: `projects/where-unique/spikes/rejection-encoding.patch`. It was written against commit `7bc1b4dd20` and does not apply to the current code, which has since gained `with`, `fragment`, row locks and runtime write guards. Read it for the shape of each overload; do not try to apply it. Its `whereUnique` body, its internal names and its test are yours to rewrite.

## Operational metadata

- **Model tier:** Opus — type-level design judgment on a class with many overloads.
- **Time-box:** 2 hours.
- **Halt conditions:**
  - The encoding cannot be made to pass the package's existing type tests or the dependents' typecheck on the current code. Report which test fails and what you tried; do not weaken or delete an existing test to get through.
  - A many-record method exists on the class that is not in the list of twelve, or one of the twelve no longer exists. Report it; do not decide its treatment.
  - Completing the task needs a change outside `packages/3-extensions/sql-orm-client` other than a re-export.
