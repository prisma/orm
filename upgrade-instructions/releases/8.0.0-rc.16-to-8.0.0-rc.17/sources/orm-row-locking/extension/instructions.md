---
changes:
  - id: collection-state-carries-locking
    summary: "CollectionState in @internal/sql-orm-client has a new required key, locking; a state literal built without spreading emptyState() must add it, carrying an existing state's value."
    detection:
      glob: "**/*.ts"
      contains:
        - "CollectionState"
---

## `collection-state-carries-locking`

`CollectionState` in `@internal/sql-orm-client` now has a required `locking: ReadonlyArray<LockingClause> | undefined`, the row locks the collection's `forUpdate()`, `forNoKeyUpdate()`, `forShare()` and `forKeyShare()` recorded. Where you build a state literal, start from `{ ...emptyState(), ... }`, or, when you derive it from an existing state, spread that state or copy `locking: state.locking`. Setting `locking: undefined` while deriving from a locked state drops the caller's lock without an error.
