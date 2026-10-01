# Plan: collection chaining, query fragments, collection scopes and weighted full-text search

**Spec:** [spec.md](spec.md). No slice starts until the operator has reviewed ADR 258 and ADR 259.

## Slices

### 1. A collection keeps its class through the chain

**Outcome.** Class methods chain, conditionals are sound, and `pipe` exists. ADR 258 in full, apart from its "Later decisions". Closes TML-3397 and the chaining part of TML-3403.

**Builds on:** nothing. **Hands to:** slices 2 and 4 a `Collection` whose methods are steps, the named facts `Filtered`, `Ordered`, `Including`, `Step`, and `pipe`.

Slice spec: [slices/1-collection-keeps-its-class/spec.md](slices/1-collection-keeps-its-class/spec.md). Reference implementation: `bot/spike-this-typed-chaining`, write-up `spikes/this-typed-chaining.md`.

### 2. Fragment helpers

**Outcome.** `FieldExpression`, `rowFragment`, `RowOf` and `sortField` are exported from the ORM client and the Postgres facade, and the demo uses them. ADR 259.

**Builds on:** slice 1. **Hands to:** the demo and docs a complete fragment surface.

Reference: `bot/spike-pipe-fragments`, write-up `spikes/pipe-fragments.md`. The spike's `when`, `fragment` and `stateFragment` do not land.

### 3. Weighted full-text index as data

**Outcome.** `@@fullTextIndex` and the TypeScript `fullTextIndex` helper take fields in weight groups, the contract records fields, weights and language as data, and one renderer produces the index DDL and the query expression. `fullTextMatches` and `fullTextRank` accept weight groups in the SQL builder.

**Builds on:** nothing. Runs in parallel with slice 1. **Hands to:** slice 4 a structured index readable from the contract type.

### 4. Scope helpers

**Outcome.** The ORM client exports `defineIndexScopes`; the Postgres package exports `fulltextSearchScopes`; the demo searches posts across fields through a scope on a custom collection class. ADR 260.

**Builds on:** slices 1 and 3, and the design discussion on how packages contribute scopes. **Hands to:** close-out.

Reference: `bot/spike-scope-helper-authoring`, write-up `spikes/helper-authoring.md`. The spike's helper takes the collection; the slice produces steps typed `Step<Self, Filtered<Self>>`.

## Sequence

- Parallel: slice 1 and slice 3.
- Then slice 2 (after 1) in parallel with slice 4 (after 1 and 3).

## After the last slice

- Set ADR 258, ADR 259 and ADR 260 to Accepted in the slice that completes their examples.
- File the include refinement registry as its own ticket and design.
- Delete the spike branches on `bot`.
- Close-out per the projects README: move anything long-lived to `docs/`, delete `projects/collection-scopes/`.
