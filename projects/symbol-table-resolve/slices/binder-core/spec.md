# Slice: binder-core

Parent project `projects/symbol-table-resolve/`. Outcome: `psl-parser` gains the eager binder — the single authoritative resolver every later slice converts its consumer onto.

## At a glance

Adds red-slot child caching to `syntax/red.ts` (within-snapshot node identity) and a new binder module exporting `createBinder(...) → { binder, diagnostics }`, resolving all type and attribute references eagerly per snapshot under the decreed scope chain. Unblocks the SQL, Mongo, and LSP conversion slices; no consumer package changes.

## Chosen design

Normative pseudo-code and API live in the parent spec — `projects/symbol-table-resolve/spec.md` § "At a glance" / "The eager pass". Slice-level specifics:

- **Red-slot caching** (`src/syntax/red.ts`): `SyntaxNode` gains a lazily-filled child-slot array; `childAt` (and everything built on it — `children()`, `firstChild`, `nextSibling`, `tokenAtOffset`, `coveringElement`) returns the cached wrapper on repeat access. Roslyn's `GetRed` design, single-threaded variant. Green layer untouched.
- **Contributed-type scope** (new module in `psl-parser`): builds `name → ContributedTypeSymbol` once from an injected type-constructor registry; the object is config-derived and shared across snapshots.
- **Binder** (new module in `psl-parser`, interface + factory per repo pattern): two-phase eager pass over the symbol table (phase 1 declarations + type references, phase 2 attribute references reading phase-1 results); side tables are `WeakMap<SyntaxNode, …>`; queries `declaredSymbol(node)` / `symbolForNode(node)`; diagnostics returned beside the binder, `PSL_UNRESOLVED_REFERENCE` code family, cross-space references yield an explicit cross-space result kind with no diagnostic.
- **Attribute-ctx helper**: `psl-parser` exports a helper that builds the ADR 249 parse-time context from a binder, so each conversion slice wires `resolveReferencedModel` as one map read. Consumers are not modified in this slice — the four existing hand-rolled implementations keep working (parent spec, transitional-shape constraint).
- **Exports** via `src/exports/index.ts`; tests written before implementation per repo rule.
- **Combinator wiring (D5, operator-decreed after D4 closed; hardened by D6):** the parse-time `AttributeCtx` carries the whole `Binder` — **required** as of D6 (decision 10); `resolveReferencedModel` is deleted from the context types. The reference combinators (`fieldRef`, `referencedFieldRef`, `entityRef`) consume the binder's already-computed resolutions via `symbolForNode` (one map read, never a re-resolution) and emit **no** resolution diagnostics of their own — the binder's returned diagnostics are the sole voice (parent spec, cross-cutting requirement 2). There is no binder-less path. A field reference resolving to a non-field fails its parse without a second diagnostic; cross-space parses successfully with resolution deferred. Every context construction site — including the three consumer packages' — threads a same-snapshot binder.

## Coherence rationale

One package, one subject: the binder and the node-identity substrate it requires. Every line of the diff lands in `psl-parser` (plus project artifacts); the reviewer reads a self-contained new capability with its tests, with zero behavior change for any existing consumer.

## Scope

**In:** `packages/1-framework/2-authoring/psl-parser` — `src/syntax/red.ts`, new binder + contributed-type-scope modules, attribute-ctx helper, the D5 combinator wiring (`src/attribute-spec/` ctx types + reference combinators), `src/exports/index.ts`, package tests; branch originally stacked on `origin/multifiile-psl` (PR #30335), rebased onto `main` after its squash-merge.

**Out:** the SQL/Mongo/LSP consumers' hand-rolled type-reference and relation resolution (their conversion slices) — D6 touches only their attribute-context construction sites; `contract-prisma7` (non-goal — if it turns out to construct attribute contexts, halt for operator ruling); laziness or cross-snapshot memo retention; incremental reparse; new LSP features.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Green nodes shared/position-free | Caches live only on red nodes; green layer must stay untouched | Decided in discussion — green-keyed caches would go stale silently once sharing exists (design-decisions § 1) |
| Cross-space reference (`typeContractSpaceId` set) | Explicit `crossSpace` resolution kind, **no** diagnostic | Replaces today's documented silent skip in `field-ref.ts` |
| Field with `malformedType` | Skip resolution, no diagnostic | Existing flag exists precisely to prevent cascades |
| Duplicate declarations | References bind to the first-wins symbol | Symbol table's documented first-wins policy; binder must not re-emit duplicate diagnostics |
| Reopened namespaces (`namespace X {}` twice) | One merged `NamespaceSymbol`; scope covers members of all blocks | Already merged by the table; binder consumes the merged scope |
| Model shadowing a contributed scalar (`model Uuid`) | User declaration wins, silently | Operator-decreed (spec § Cross-cutting 1) |

## Slice-specific done conditions

- [ ] Diff touches only `psl-parser`, `projects/symbol-table-resolve/`, the attribute-context construction sites in `2-sql/2-authoring/contract-psl` and `2-mongo-family/2-authoring/contract-psl` (D6; the language server needed none), and one additive `and` combinator in `0-foundation/utils` where the `Result` type lives (review round, operator-designed) — nothing else in those packages.
- [ ] A `fieldRef`/`referencedFieldRef` argument resolving to a non-field fails its parse with no second diagnostic; cross-space still parses; pinned by tests.
- [ ] Contexts carry the binder as a compile-level requirement wherever a reference combinator can appear (decision 10 — `resolveReferencedModel` no longer exists; the once-planned attribute-ctx builder helpers were deleted in review: zero production callers, their purpose died with the callback they replaced).
- [ ] A resolution failure inside an attribute argument yields exactly one diagnostic — the binder's, carrying its reference class; neither the combinators nor a consumer's residual validators re-voice it, pinned by exact-set assertions in each converted consumer.

## Open Questions

None — all design questions were settled in discussion (see `projects/symbol-table-resolve/design-decisions.md`).

## References

- Parent project: `projects/symbol-table-resolve/spec.md`
- Linear issue: omitted at operator request.
- Relevant ADRs: 249 (attribute-spec contexts), 253 (red-root source ownership), 126 (descriptor injection precedent).
