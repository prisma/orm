# symbol-table-resolve — Plan

**Spec:** `projects/symbol-table-resolve/spec.md`
**Linear Project:** omitted at operator request.

## At a glance

Four slices: one foundation slice delivering the eager binder in `psl-parser` (with red-slot identity and attribute-spec wiring), then the two interpreter conversions running in parallel, then the language-server conversion closing the project. Mixed shape: a two-stage stack whose middle stage is a parallel pair.

## Composition

### Stack (deliver in order)

1. **Slice `binder-core`** — Linear: omitted
   - **Outcome:** `psl-parser` exports `createBinder(...) → { binder, diagnostics }` per the spec's normative pseudo-code: red-slot caching in `red.ts` gives within-snapshot node identity; the universe scope turns injected type constructors into symbols; the two-phase eager pass resolves type references and attribute references by the decreed chain (declaring namespace → top level → universe, never siblings); `PSL_UNRESOLVED_REFERENCE` diagnostics are born here; cross-space references yield the explicit cross-space result kind. The attribute-spec parse-time context's `resolveReferencedModel` is served by the binder inside `psl-parser`.
   - **Builds on:** PR #30335 (`multifiile-psl`) — external, unmerged; this project stacks on it.
   - **Hands to:** the binder API + red-slot identity + diagnostic codes, stable for every conversion slice; parser tests pinning the scoping rule, universe-scope invalidation (identity across snapshots), and node-identity guarantees.
   - **Focus:** everything inside `psl-parser`. No consumer package changes; the four hand-rolled resolvers keep working untouched (spec's transitional-shape constraint: the binder is additive until a conversion slice claims its consumer).

2. _(after both parallel slices below)_ **Slice `lsp-conversion`** — Linear: omitted
   - **Outcome:** the language server's existing surfaces (completions, signature help, semantic tokens, diagnostics publishing) run on the binder: the span-scan reverse binding (`modelSymbolForNode` / `fieldSymbolForNode`) and both duplicated name-classification cascades are deleted; published diagnostics include the binder's; per-snapshot binder creation joins `project-artifacts.ts`'s drop-on-change discipline.
   - **Builds on:** `binder-core`'s hand-off; sequenced after the interpreter conversions by operator decree.
   - **Hands to:** project close-out; the reverse-binding API proven, ready for the follow-on features project (go-to-definition and kin, out of scope here).
   - **Focus:** conversion of existing surfaces only — no new LSP features (spec non-goal).

### Parallel group A (after `binder-core`, independent of group B)

- **Slice `sql-conversion`** — Linear: omitted
  - **Outcome:** the SQL interpreter answers type-reference, relation-target, and entity-reference questions exclusively through the binder: `resolveReferencedModel` in `psl-relation-resolution.ts`, the flattened name sets, and the attribute-node re-walks are deleted; the sibling-namespace scan's behavior change is named in the PR and pinned by shadowing-schema tests; binder diagnostics are adopted in place of locally-phrased unresolved-reference complaints.
  - **Builds on:** `binder-core`'s hand-off.
  - **Hands to:** project close-out (nothing downstream consumes SQL-specific state; the LSP slice waits on this by decree, not by dependency).
  - **Focus:** `packages/2-sql/2-authoring/contract-psl` only. Interpreter-internal indexes that are not name resolution (FK pairing, STI/MTI maps) stay as they are.

### Parallel group B (after `binder-core`, independent of group A)

- **Slice `mongo-conversion`** — Linear: omitted
  - **Outcome:** the Mongo interpreter resolves through the binder: `allModels.find(...)`, the flattened model-name set, and its `findModelAttributeNode` copy are deleted; namespace-blindness is corrected, named in the PR, and pinned by shadowing-schema tests; binder diagnostics adopted.
  - **Builds on:** `binder-core`'s hand-off.
  - **Hands to:** project close-out.
  - **Focus:** `packages/2-mongo-family/2-authoring/contract-psl` only.

## Dependencies (external)

- [ ] PR #30335 (`multifiile-psl`) merges — open at planning time; operator judges it will not stall. All slices stack on it; no independent landing path (spec transitional-shape constraint).
- [ ] Base-branch escapee, surfaced during D1: `integration-tests` typecheck is broken at the branch point itself — `test/integration/test/authoring/lsp-emit-parity.integration.test.ts:8` imports `createDocumentStore`, removed by `multifiile-psl`'s own commit `a54c338980`. Belongs to PR #30335 to fix; our stack inherits the red CI until it does. Not fixed here (out of scope; operator may wish to flag it on the PR themselves).

## Open items

- `PSL_UNRESOLVED_REFERENCE` is exported as a constant from the binder module but is not yet a member of the `PslDiagnosticCode` union (`framework-components/src/shared/psl-extension-block.ts`, where its sibling `PSL_DUPLICATE_DECLARATION` lives) — that file is outside the binder-core slice's walls. Land the union member in whichever slice or follow-up first lawfully touches `framework-components`; compilation is unaffected meanwhile (`ContributedPslDiagnosticCode` is `` `PSL_${string}` ``).
- ADR 163 line 49 carries the genuinely stale `buildSymbolTable({ document, sourceFile, scalarTypes, pslBlockDescriptors })` signature (the psl-parser README's copy was already fixed on the base branch; D4 verified rather than invented a correction). Out of every slice's scope — route as a small direct change after this project, or fold into whichever slice next touches `docs/`.
- Spec amendment (D2, implementer-discovered, orchestrator-accepted): `createBinder` takes `{ sources, symbolTable, typeConstructors, attributeSpecs }` — the `documents` option was unread (phase 1 reaches every node through the symbol table) and a dead parameter would falsely claim a dependency. Operator may veto.

## Sequencing rationale

The dependency graph alone would allow the LSP conversion to run parallel with the interpreter conversions — all three depend only on `binder-core`. The serialization of LSP after both interpreters is an explicit operator decree (design-decisions.md § 7), not a graph constraint: the interpreters exercise the binder's resolution semantics most deeply, so their conversions surface any semantic fault before the LSP builds on it. `sql-conversion` and `mongo-conversion` stay parallel — different packages, no shared files, no ordering decree between them. `prisma-7` appears nowhere by decree; its untouched status is a project-DoD condition, not a slice.
