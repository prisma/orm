# Brief: D3 — evidence and documentation

## Task

Show `whereUnique` working against a database, cover declaration emit for uniquely filtered chains in the demo, and document the method in the package README. No source change in `packages/3-extensions/sql-orm-client/src`.

## Scope

**In:**

- Integration tests under `test/integration/test/sql-orm-client/`, following the neighbouring tests' setup. After `whereUnique`: `first`, `update` and `delete` for a single-column key and for a compound key; a following `where` that excludes the row (result `null`); `first` with an `include`; a key that matches no row. Per the repo rule for sql-orm-client tests, assert the whole result shape (`toEqual`) with an explicit `select`.
- `examples/prisma-8-demo/test/collection-chaining.types.test-d.ts`: exported consts for a uniquely filtered chain from a plain collection, from a user class, with a following `where`, with an `include`, and its `prepared`. The demo's `declaration-emit` test must pass with them.
- `packages/3-extensions/sql-orm-client/README.md`: a `whereUnique` section in the style and position of its neighbours (see "Skipping rows that collide with a unique constraint" and "Custom collections"). It states: what the argument accepts and rejects, including `null`; which calls remain and which are compile errors; that it throws inside an `include` refinement; and the three accepted consequences, in one short list (a user-defined method or a `with(fragment)` can still add an order or a limit; row-lock methods return a plain collection; a conditional mixing a uniquely filtered collection with another one is not rejected). User-facing behaviour only: no description of the type encoding.
- If the existing `app` upgrade-instruction declaration needs nothing more for the `examples/` test change, leave it; `pnpm check:upgrade-coverage --mode pr` decides.

**Out:**

- Any change under `packages/3-extensions/sql-orm-client/src`. A defect found here is reported with a failing test, not patched.
- Other READMEs, architecture docs, ADRs.
- The Mongo ORM and `include` refinements.

## Completed when

- [ ] The integration tests above exist and pass with the repo's integration test command scoped to the new file(s).
- [ ] The demo's type test exports the chains above; `pnpm test declaration-emit` in `examples/prisma-8-demo` passes; root `pnpm turbo typecheck --continue --filter="...@internal/sql-orm-client" --filter="!prisma7-adoption"` passes.
- [ ] The README section exists; `pnpm check:upgrade-coverage --mode pr --prev origin/main --head HEAD` passes after committing.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal — even if it looks useful — halts and surfaces.

## Operational metadata

- **Model tier:** Opus (operator override: every dispatch).
- **Time-box:** 1.5 hours.
- **Halt conditions:**
  - An integration test shows `whereUnique` behaving differently from `where` with the same object.
  - An exported chain fails declaration emit.
  - The integration fixtures have no model with a compound primary key or compound unique constraint and adding one would mean regenerating shared fixtures used by other tests.
