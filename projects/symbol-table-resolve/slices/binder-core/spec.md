# Slice: binder-core

Parent project `projects/symbol-table-resolve/`. Outcome: `psl-parser` gains the eager binder — the single authoritative resolver every later slice converts its consumer onto.

## At a glance

Adds red-slot child caching to `syntax/red.ts` (within-snapshot node identity) and a new binder module exporting `createBinder(...) → { binder, diagnostics }`, resolving all type and attribute references eagerly per snapshot under the decreed scope chain. Unblocks the SQL, Mongo, and LSP conversion slices; no consumer package changes.

## Chosen design

Normative pseudo-code and API live in the parent spec — `projects/symbol-table-resolve/spec.md` § "At a glance" / "The eager pass". Slice-level specifics:

- **Red-slot caching** (`src/syntax/red.ts`): `SyntaxNode` gains a lazily-filled child-slot array; `childAt` (and everything built on it — `children()`, `firstChild`, `nextSibling`, `tokenAtOffset`, `coveringElement`) returns the cached wrapper on repeat access. Roslyn's `GetRed` design, single-threaded variant. Green layer untouched.
- **Universe scope** (new module in `psl-parser`): builds `name → UniverseSymbol` once from an injected type-constructor registry; the object is config-derived and shared across snapshots.
- **Binder** (new module in `psl-parser`, interface + factory per repo pattern): two-phase eager pass over the symbol table (phase 1 declarations + type references, phase 2 attribute references reading phase-1 results); side tables are `WeakMap<SyntaxNode, …>`; queries `declaredSymbol(node)` / `symbolForNode(node)`; diagnostics returned beside the binder, `PSL_UNRESOLVED_REFERENCE` code family, cross-space references yield an explicit cross-space result kind with no diagnostic.
- **Attribute-ctx helper**: `psl-parser` exports a helper that builds the ADR 249 parse-time context from a binder, so each conversion slice wires `resolveReferencedModel` as one map read. Consumers are not modified in this slice — the four existing hand-rolled implementations keep working (parent spec, transitional-shape constraint).
- **Exports** via `src/exports/index.ts`; tests written before implementation per repo rule.

## Coherence rationale

One package, one subject: the binder and the node-identity substrate it requires. Every line of the diff lands in `psl-parser` (plus project artifacts); the reviewer reads a self-contained new capability with its tests, with zero behavior change for any existing consumer.

## Scope

**In:** `packages/1-framework/2-authoring/psl-parser` — `src/syntax/red.ts`, new binder + universe-scope modules, attribute-ctx helper, `src/exports/index.ts`, package tests; branch stacks on `origin/multifiile-psl` (PR #30335).

**Out:** any change to SQL/Mongo interpreters, language server, or `contract-prisma7` (later slices / non-goals); laziness or cross-snapshot memo retention; incremental reparse; new LSP features.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Green nodes shared/position-free | Caches live only on red nodes; green layer must stay untouched | Decided in discussion — green-keyed caches would go stale silently once sharing exists (design-decisions § 1) |
| Cross-space reference (`typeContractSpaceId` set) | Explicit `crossSpace` resolution kind, **no** diagnostic | Replaces today's documented silent skip in `field-ref.ts` |
| Field with `malformedType` | Skip resolution, no diagnostic | Existing flag exists precisely to prevent cascades |
| Duplicate declarations | References bind to the first-wins symbol | Symbol table's documented first-wins policy; binder must not re-emit duplicate diagnostics |
| Reopened namespaces (`namespace X {}` twice) | One merged `NamespaceSymbol`; scope covers members of all blocks | Already merged by the table; binder consumes the merged scope |
| Model shadowing a universe scalar (`model Uuid`) | User declaration wins, silently | Operator-decreed (spec § Cross-cutting 1) |

## Slice-specific done conditions

- [ ] Diff touches only `psl-parser` and `projects/symbol-table-resolve/` (verifiable via `git diff --stat` against `origin/multifiile-psl`).
- [ ] The attribute-ctx helper is exported and covered by a test demonstrating `resolveReferencedModel` as a binder map read.

## Open Questions

None — all design questions were settled in discussion (see `projects/symbol-table-resolve/design-decisions.md`).

## References

- Parent project: `projects/symbol-table-resolve/spec.md`
- Linear issue: omitted at operator request.
- Relevant ADRs: 249 (attribute-spec contexts), 253 (red-root source ownership), 126 (descriptor injection precedent).
