# symbol-table-resolve — design-decision record

Outcome of the design discussion (2026-09-18) that preceded [`spec.md`](./spec.md). Each entry names the decision, the reasoning that drives it, the assumptions it rests on, and the alternatives rejected. If an assumption below falsifies mid-flight, halt and re-enter discussion (invariant I12).

## 1. Red-slot caching gives within-snapshot node identity

**Decision.** The red layer caches each child wrapper in its parent red node's slot on first access (Roslyn's `SyntaxNode.GetRed` design, verified against Roslyn source). Two traversals to the same position return the same object for the snapshot's lifetime.

**Why.** Today `red.ts` allocates fresh wrappers on every `children()` / `childAt` / `findAncestor` call, so identity-keyed caches (`WeakMap`) would silently never hit — the LSP already falls back to span-equality scans because of this. Caching in the parent slot is a contained change (`SyntaxNode` already holds `parent` and `index`) and also removes per-request wrapper churn in every consumer.

**Assumes.** All traversal descends from the single registered root, so each position materializes exactly one wrapper — the same property PR #30335's `PslSources` already relies on for red roots.

**Rejected.**
- *Span-keyed memos with the red layer untouched* — workable (rust-analyzer's pointer style) but keeps the allocation churn and leaves span keys valid only within one parse anyway.
- *Keying caches on green nodes* — wrong, not merely inferior: green nodes erase position, and resolution is a function of position; green subtrees are shareable across snapshots by design, so a green-keyed cache would serve pre-edit resolutions after an edit — stale answers with no error — the moment incremental reparse or hash-consing arrives.

## 2. One scoping rule: declaring namespace → top level → contributed types; never siblings

**Decision.** Operator decree: an unqualified reference resolves against same-namespace declarations first, then top level. Sibling namespaces are never consulted.

**Why.** Four resolvers answer this differently today; the SQL interpreter consults sibling namespaces in arbitrary key order, which is order-dependent and surprising. A single binder must canonize one rule; lexical scoping is the LSP's current rule and matches every surveyed language.

**Consequence accepted.** The SQL and Mongo interpreters change behavior for schemas where a namespaced model shadows a top-level name. These are corrections, named in their slices, not silent drift.

## 3. Multi-document from birth, stacked on PR #30335

**Decision.** The binder addresses a set of documents (N=1 common case), built on the `multifiile-psl` branch where `buildSymbolTable` already accepts `documents[]` + `PslSources`.

**Why.** Designing a single-document API would churn when multi-file support lands, and the multi-document groundwork already exists on the open PR.

**Assumes.** PR #30335 lands. The project stacks on it and has no independent landing path (spec Open Question 2).

## 4. The binder is a separate per-snapshot service; the symbol table stays pure data

**Decision.** Interface + factory (`createBinder`) per the repo's stateful-service pattern; created over `{documents, sources, symbolTable, typeConstructors}`; holds all memo tables; dropped whole on any change. The eager symbol table gains no lookup methods and no laziness.

**Why.** Caches are state, and the repo pattern puts stateful services behind an interface + factory. The split mirrors the surveyed systems: a cheap eager declaration pass (TypeScript's binder, Roslyn's declaration table) and a lazy, memoized resolution layer (TypeScript's checker, Roslyn's `SemanticModel`), where every cache may be discarded because resolution is a pure function of the snapshot. The existing `project-artifacts.ts` interpret slot already practices compute-on-demand, invalidate-by-dropping-the-holder.

**Rejected.** *Salsa-style dependency-tracked invalidation* — revision counters, dependency recording, and memo verification pay off for large multi-file inputs with macros; rust-analyzer's own architecture writing flags the complexity and constant-factor cost. PSL's inputs are small; snapshot discard is strictly simpler and has no protocol to get wrong.

## 5. Scalars become symbols in a config-derived contributed-type scope

> **Renamed (2026-09-22, operator decree):** originally "universe scope" after the compiler term (Go's universe block). The operator ruled the term confusing and the analogy imprecise — the scope holds whatever the configured target and its extensions contribute (composed scalars, type constructors, field presets, extension namespaces), not language built-ins. New vocabulary: `ContributedTypeScope` / `ContributedTypeSymbol` / resolution kind `contributedType`, matching the repo's established "contributed" idiom (ADR 236; `ContributedPslDiagnosticCode`). Historical mentions of "universe" in the review log and dispatch briefs are archive and stand unedited.

**Decision.** Scalars (and type constructors) are exposed as symbols in an outermost contributed-type scope, built once per configuration from the existing type-constructor registry, chained after top level. User declarations shadow contributed-type symbols. Document edits never invalidate this layer.

**Why.** Surveyed compilers treat builtins as ordinary symbols in an outer scope, which deletes the LSP's two duplicated hand-rolled classification cascades. Placement outside the eager table matters because scalar sets are target- and contract-space-specific and change on configuration change, not document edit — welding them into the document table would conflate two invalidation triggers and contaminate a family-neutral structure.

**Rejected.** *Restoring a scalar-name parameter to `buildSymbolTable`* — commit `72cd71550f` deliberately unified scalars into the type-constructor channel; a name list would partly undo that unification, and the eager table's family-blindness is preserved deliberately (`NamedTypeSymbol` classification is pronounced by interpreters).

## 6. The binder is the sole voice of resolution-failure diagnostics

**Decision.** Unresolved- and ambiguous-reference diagnostics are emitted only by the binder, via a lazily-forced, memoized full-resolution pass; consumers map them into their channels and never re-emit.

**Why.** The symbol table set the precedent with duplicate-declaration diagnostics ("downstream consumers should consume first-wins symbols rather than re-emitting"). Without single ownership, the four differing error surfaces would survive unification — same schema, different complaints per tool. Laziness holds: TypeScript's checker is lazy, and its diagnostics pass simply forces full resolution once.

## 7. Scope and sequencing decrees

**Decision.** Prisma-7 is excluded entirely. Conversion order: binder + attribute specs land first, then the SQL interpreter, then Mongo, then the LSP last.

**Why.** Operator decree. Landing all conversions with the binder would make one change carry four behavior shifts; interpreters-first was chosen over LSP-first. Sequencing detail belongs to the project plan; it is recorded here because it was an explicit operator decision, not a planner's inference.

## 8. Node-addressed core API

**Decision.** The binder exposes exactly `declaredSymbol(node)` (declaration node → the symbol it declares), `symbolForNode(node)` (reference node → the symbol it denotes), and `diagnostics()`. Symbol-addressed conveniences (e.g. `resolveTypeReference(fieldSymbol)`) are dropped until call sites demand them.

**Why.** These are the two questions every surveyed compiler distinguishes (Roslyn: `GetDeclaredSymbol` vs `GetSymbolInfo`); node → symbol binding is what the operator asked for, and earlier symbol-addressed sketches obscured that core. Diagnostics survive as a binder output because "no resolution errors" is a whole-document claim: interpreters touch every reference in their walk and can consume per-query failure results, but the language server must publish complete resolution errors for regions no feature queried, and deriving them from interpretation would reintroduce family-dependent short-circuiting. Boundary: name-resolution failures are the binder's voice; shape failures (arity, argument types) remain the spec combinators'.

**Amended same day (operator):** diagnostics are not a method — `createBinder` returns `{ binder, diagnostics }`, extending `buildSymbolTable`'s `{ symbolTable, diagnostics }` result pattern so every pipeline stage hands over its artifact and its complaints together. This hardens eagerness into the factory contract (a future lazy implementation must fill the diagnostics at creation or change the result shape) — accepted knowingly for pipeline symmetry; the query methods alone stay timing-neutral.

## 9. Eager per-snapshot binding replaces the lazy decree

**Decision.** The binder resolves everything at creation in a two-phase pass — phase 1: declarations and type references; phase 2: attribute references, which read phase-1 results (no cycle exists in the other direction). Queries are map reads; the diagnostics are the pass's byproduct, returned from the factory. Query timing is not part of the contract: `declaredSymbol` and `symbolForNode` observe only snapshot-scoped, stable answers. Normative pseudo-code lives in `spec.md` § "The eager pass".

**Why.** The original requirement asked for lazy binding, and the operator consciously revised it once the economics were laid out: every keystroke already pays a full reparse and full symbol-table rebuild (incremental reparse is a non-goal), the LSP forces full resolution for diagnostics moments after every edit, and interpreters resolve everything by nature — so laziness defers a minority slice of an already-paid cost, only to collect it immediately. Attribute references decide it: resolving `@relation(references: [id])` lazily from a bare node means re-deriving spec, combinator kind, enclosing field, and its type target by climbing the tree — context the eager walk holds in its hands. Laziness in the surveyed systems (TypeScript, Roslyn) exists for compilation units that are enormous and not reparsed wholesale per edit; we lack their economics until incremental reparse exists.

**Assumes.** Incremental reparse arrives eventually (operator-confirmed) but outside this project; the timing-neutral contract lets that project reintroduce laziness and cross-snapshot memo retention behind the same interface.

**Rejected.** *Lazy-first implementation* — a second resolution entry path from bare nodes, plus a full-walk `diagnostics()` forcing pass that duplicates the eager walk anyway. *Cross-space references as silent skips* — they become an explicit cross-space resolution kind with no diagnostic.

## 10. The binder is mandatory in attribute contexts (operator decree, post-D5)

**Decision.** `AttributeCtx.binder` is required, not optional; `resolveReferencedModel` is deleted from the context types along with its four consumer-supplied implementations; the reference combinators keep no binder-less path; every context construction site (SQL, Mongo, language server) threads a binder built over the same snapshot. Additionally, a `fieldRef`/`referencedFieldRef` argument whose binder resolution is not a field fails its parse — without emitting a second diagnostic, the binder's being the voice; cross-space parses successfully with resolution deferred.

**Why.** The optional-binder design left a dual path alive: an unconverted consumer's attribute parsing silently kept the old existence checks, and F5 documented how a mismatched or missing binder disables checking with no signal. Requiring the binder deletes the trap instead of documenting it, converts the attribute-argument question across all consumers at once (per-question wholeness), and makes the compiler enumerate every construction site — nothing can be missed silently. Fail-on-non-field closes the last soft spot: a parse that succeeds against an unresolved name hands interpreters a bogus value.

**Supersedes.** The D5 gating design ("legacy byte-for-byte when no binder") and the transitional constraint's per-consumer wording, both amended in the specs the same day.

**Execution note (D6, orchestrator ruling).** Fail-on-non-field is unrepresentable in the parse machinery as found: `list.ts`, `record.ts`, and `interpretArgs` decide failure by diagnostic count, so a diagnostic-less failure is silently converted back into success — empirically shown to yield a truncated `@@index` value with no complaint from either voice. The orchestrator authorized the minimal machinery change under the decree: failure is tracked separately from diagnostic count in those aggregation points. Provably inert for existing specs (no combinator returned an empty failure before this). `contract-prisma7` was verified clear of attribute-context construction before threading.

**Ratified placement refinements (D6, orchestrator).** (A) The required `binder` lives on `ModelAttributeCtx`, not base `AttributeCtx` — `block-reconstruction.ts` interprets block attributes from inside `buildSymbolTable`, before any binder can exist, and no block-attribute spec takes a reference argument (repo-verified), so every ctx that can reach a reference combinator carries a binder by construction. (B) `entityRef` keeps base-`AttributeCtx` typing with no binder read — retyping it would force genericizing `FuncCallSig` across every call site (Mongo nests `optional(entityRef())` in a `funcCall`); its former read was non-load-bearing (D5 review), and the binder still voices entity failures from phase 2. ~~`oneOf` never wraps a reference combinator in any production spec (repo-verified), so its no-match fall-through needed no failure-awareness.~~ **Corrected (review round): this claim was grep-verified and is false.** Mongo's `modelFieldElement` assembles an `arms` array containing `fieldRef()` and spreads it into `oneOf(...arms)` — invisible to a one-line grep, proven reachable by probe (neutering the failure-awareness fails `interpreter.single-voice.test.ts`). `oneOf` therefore participates in wordless-failure propagation; per operator direction its handling lives in the shared `Result` algebra (`and` for the conjoining aggregators, a pooling counterpart for `oneOf`), not in local helpers.

**Second execution ruling (operator, D6).** Threading alone produced a zero-voice interval: with the combinators' existence checks deleted and binder diagnostics still discarded by consumers, schema errors vanished (`@@id` on an unknown field emitted a contract without its primary key). The operator decreed the diagnostics be surfaced in D6 itself: every consumer pushes its binder's diagnostics into its collector; the registry view becomes owner-aware so context-dependent specs (SQL `@default`) stop producing false unknown-attribute flags; consumers' duplicate resolution-class emissions are removed; the sibling-namespace correction lands with diagnostics and named test updates. The conversion slices shrink accordingly — their sole-voice half moved here; their remaining work is deleting each consumer's hand-rolled type-reference/relation machinery. Two boundary findings from execution: the language server constructs no attribute contexts at all (its spec resolver serves completion/signature metadata, never `interpretAttribute`), so its binder-diagnostic adoption stays in the LSP conversion slice as planned; and the recognized-scalar route died on evidence (no canonical recognized-names list exists to widen Mongo's universe to — hard-coding was forbidden). The ratified mechanism instead: **binder diagnostics carry the class of reference that failed** (`reference: 'type' | 'field' | 'entity' | 'attribute'`), and each consumer adopts the binder's voice per class as it converts — Mongo surfaces `field`/`entity`/`attribute` and keeps `PSL_UNSUPPORTED_FIELD_TYPE` as its `type`-position voice; SQL, whose universe is complete, adopts all four. This generalizes to every conversion slice: voices are adopted question by question, which is the transitional constraint's per-question wholeness made mechanical.

**Explicit-unresolved hardening (operator decree, PR #30349 review round).** The binder records an explicit `unresolved` resolution entry for every reference it examines and fails to resolve, instead of leaving the side table silent. Consequence: for a reference-position node parsed under a required-binder context, an *absent* map entry no longer means "schema mistake" — it can only mean a binder built over a different snapshot (the F5 precondition violated), and the reference combinators throw an internal error on it rather than silently forgoing existence checks. `unresolved` still parses to a wordless failure; `crossSpace` and `field` behave as before. Fields with `malformedType` remain unexamined by design.

## 11. Open-question resolutions (2026-09-18)

The spec's four launch questions were answered by the operator: (1) all new LSP features, go-to-definition included, are follow-on work — the LSP slice converts existing surfaces only; (2) the stack on PR #30335 stands, no independent landing path; (3) resolution failures use a new parser-owned `PSL_UNRESOLVED_REFERENCE` code family, adopted by interpreters; (4) user declarations shadow contributed-type symbols silently, with no diagnostic.
