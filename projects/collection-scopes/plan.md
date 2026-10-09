# Plan: collection chaining, query fragments and weighted full-text search

**Spec:** [spec.md](spec.md).

## Slices

### 1. A collection keeps its class through the chain — merged

ADR 265. Closed TML-3397 and the chaining part of TML-3403.

### 2. Fragment helpers — merged

ADR 259: `db.orm.fragment`, `collection.fragment`, `orderByField`, `CodecField`, and `with`.

### 3. Weighted full-text index as data — merged

`@@fullTextIndex` with weight groups, `fullText` indexes stored as data, one renderer, and `table.indexes.<name>` in the SQL query builder. Stacked on the foreign-key backing-index change, also merged.

### Defects (TML-3543)

**Outcome.** The row-lock methods return the receiver's type; `collection.fragment(body)` refuses a receiver that carries query state, at run time and where the type records it at compile time; the pending query fragment type-name upgrade instruction starts from rc.17. One pull request from main, independent of slice 4.

### 4. ORM queries name an index

**Outcome.** ORM `where` and `orderBy` callbacks receive `{ fns, indexes }` (ADR 270). An ORM query searches a weighted full-text index by naming it, at every site the spec lists; the demo does so; `EXPLAIN` proves the index is used.

**Builds on:** slice 3. **Hands to:** close-out.

Slice spec: [slices/4-orm-queries-name-an-index/spec.md](slices/4-orm-queries-name-an-index/spec.md).

## Sequence

- The defects pull request and slice 4 run in parallel; they touch different parts of `collection.ts`.

## After the last slice

- Set ADR 270 to Accepted.
- Demo gaps from the Definition of Done: a conditional list query with `with`, a `CodecField` filter in the demo's source.
- File the include-refinement class registry as its own ticket (ADR 265, "Later decisions").
- Manual QA across the feature, then Will's final verification.
- Delete the spike branches on `bot`: `spike-collection-scope-declared`, `spike-collection-scope-types`, `spike-collection-state-subtyping`, `spike-pipe-fragments`, `spike-scope-helper-api`, `spike-scope-helper-authoring`, `spike-this-typed-chaining`. First copy the draft ADR "Collection scopes derived from indexes" from `spike-collection-scope-declared` into `docs/design/` or the follow-up ticket, because the later collection-scopes design starts from it.
- Close-out per the projects README: move anything long-lived to `docs/`, delete `projects/collection-scopes/` here and on main (main carries `projects/collection-scopes/spikes/`).
- Then the collection-scopes and default-scopes discussions.
