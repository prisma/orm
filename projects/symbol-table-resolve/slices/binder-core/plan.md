# binder-core — Dispatch plan

Slice spec: `projects/symbol-table-resolve/slices/binder-core/spec.md`. Branch: `binder-core` created from `origin/multifiile-psl` (PR #30335). All dispatches write tests before implementation per the repo rule.

### Dispatch 1: red-slot-identity

- **Outcome:** `syntax/red.ts` caches child wrappers in parent slots: repeated traversal to the same position returns the identical (`===`) `SyntaxNode`/`SyntaxToken` object, pinned by tests across `childAt`, `children()`, `firstChild`, `nextSibling`, `ancestors()`, `tokenAtOffset`, `coveringElement`; `pnpm test` green in `psl-parser`.
- **Builds on:** the slice spec's chosen design; `origin/multifiile-psl` checked out.
- **Hands to:** within-snapshot node identity — `WeakMap<SyntaxNode, …>` side tables are henceforth correct; green layer untouched.
- **Focus:** `src/syntax/red.ts` and its tests only. No binder code; no public API change.

### Dispatch 2: binder-phase-1

- **Outcome:** `createBinder(...) → { binder, diagnostics }` exists (interface + factory, package-internal): contributed-type scope built from an injected type-constructor registry; phase 1 registers declarations and resolves every field type reference through declaring namespace → top level → contributed types (never siblings); `declaredSymbol`/`symbolForNode` answer from `WeakMap` tables; unresolved type references emit `PSL_UNRESOLVED_REFERENCE`; `malformedType` fields are skipped silently; `typeContractSpaceId` references yield the explicit cross-space kind; references bind to first-wins symbols; tests pin the scope chain (shadowing schema), contributed-type-scope identity across two builds, and stable repeated-query results.
- **Builds on:** dispatch 1's node identity (the `WeakMap` tables).
- **Hands to:** a working binder for declarations + type references, with the diagnostic channel and contributed-type scope in place — the structure phase 2 extends.
- **Focus:** new binder + contributed-type-scope modules and tests. Attribute references untouched (phase 2); nothing exported from the package root yet.

### Dispatch 3: binder-phase-2-attributes

- **Outcome:** phase 2 resolves attribute references: attribute names against the injected spec registry (unknown attribute → diagnostic), `fieldRef` args against the declaring owner's fields, `referencedFieldRef` args against the phase-1 type target (cross-space → explicit kind, no diagnostic), `entityRef` args through the scope chain; the returned diagnostics carry every resolution failure; tests cover `@relation(fields:/references:)`, `@@index`, `@@id`, `@@unique`, `@@base`, and unknown-attribute cases.
- **Builds on:** dispatch 2's binder structure and phase-1 resolution results.
- **Hands to:** complete eager resolution per the parent spec's normative pseudo-code — the binder is semantically whole.
- **Focus:** phase 2 inside the binder module + tests. No consumer-facing helper yet.

### Dispatch 4: public-surface

- **Outcome:** the binder, its types, and an attribute-ctx helper (builds the ADR 249 parse-time context with `resolveReferencedModel` as a binder map read, demonstrated by test) are exported from `src/exports/index.ts`; the `psl-parser` README documents the binder and its scope chain, the now-public `SyntaxNode.childAt` with its identity guarantee (reviewer note, D1), and corrects the stale `scalarTypes`/`ScalarSymbol` text while touching that section; `pnpm build` + full package tests green; diff confined to `psl-parser` + `projects/symbol-table-resolve/`.
- **Builds on:** dispatch 3's semantically-whole binder.
- **Hands to:** the slice-DoD state — the stable API surface the three conversion slices consume.
- **Focus:** exports, helper, docs, final gates. No new resolution logic.

### Dispatch 5: combinator-binder-wiring (added by operator decree after D4 closed)

- **Outcome:** `AttributeCtx` carries an optional `binder: Binder`; the D4 context builders populate it; `fieldRef`/`referencedFieldRef`/`entityRef` consume the binder's phase-2 resolutions via `symbolForNode` (map read, no re-resolution) and emit no resolution diagnostics when the binder is present — the binder's diagnostics are the sole voice; legacy no-binder behavior byte-for-byte unchanged and pinned by the existing suite; README's binder section documents the ctx wiring; full gates green (workspace typecheck now excluding only `prisma7-adoption`).
- **Builds on:** dispatch 3's phase-2 resolutions and dispatch 4's context builders.
- **Hands to:** the slice-DoD state, now including single-voice diagnostics through the spec-interpretation path — conversion slices become pure deletions with no double-diagnostic intermediate state.
- **Focus:** `src/attribute-spec/` ctx types + the three reference combinators + `binder-context.ts` + tests. No consumer packages; no binder-semantics changes.

### Dispatch 6: required-binder-threading (added by operator decree after D5 closed)

- **Outcome:** `AttributeCtx.binder` is required; `resolveReferencedModel` is deleted from the context types; the combinators' binder-less fallback paths are removed; every context construction site — SQL (`sql-attribute-specs.ts`), Mongo (`mongo-attribute-specs.ts`), language server (`attribute-spec-resolution.ts`), plus whatever the compiler surfaces — threads a same-snapshot binder; `fieldRef`/`referencedFieldRef` arguments resolving to a non-field fail their parse without a second diagnostic; cross-space still parses; all affected package suites green.
- **Builds on:** dispatch 5's wiring.
- **Hands to:** the slice-DoD state under decision 10 — no dual path anywhere; conversion slices inherit consumers that already hold a binder.
- **Focus (widened by operator decree mid-dispatch):** ctx types + combinators + parse-machinery failure tracking + owner-aware registry view in `psl-parser`; in the three consumer packages: ctx-construction threading AND binder-diagnostic surfacing (collectors gain the binder's diagnostics; duplicate resolution-class emissions removed; registries completed). NOT the consumers' hand-rolled type-reference/relation machinery beyond what the threading already deleted (their slices, now correspondingly smaller). `contract-prisma7` verified clear.

Sizes: D1 S, D2 L, D3 M, D4 S, D5 M, D6 L. Sequential; no parallel-within-slice.
