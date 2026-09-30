# Slice: sql-conversion

Parent project `projects/symbol-table-resolve/`. Outcome: the SQL interpreter stops resolving names for itself — every remaining hand-rolled resolution structure is replaced by reads of the binder's results.

## At a glance

binder-core landed the binder, the required attribute contexts, and the surfaced diagnostics. What remains in `packages/2-sql/2-authoring/contract-psl` is the interpreter's private resolution machinery: namespace-blind flattened name sets, a bare-name `modelMappings` fallback that stamps FKs against the wrong namespace when names collide (verified real in review), NUL-separator coordinate keys, and CST re-walk helpers. This slice deletes them in favor of binder reads and pins the corrections.

## Chosen design

- **Relation targets come from the binder.** A field's relation target is the binder's recorded resolution for its type reference (`symbolForNode` on `typeReferenceNode(field)`-shaped nodes, or resolutions already carried through attribute parsing) — namespace-correct by construction. The `input.modelMappings.get(fieldTypeName)` bare-name fallback (`interpreter.ts:1439`) dies; mapping lookups key on the resolved symbol (or its namespace-qualified identity derived from the resolution), never on a bare name.
- **The coordinate-key machinery dies with it.** `modelCoordinateKey`/`MODEL_COORDINATE_SEPARATOR` exist to disambiguate what the binder's resolutions disambiguate natively.
- **The flattened name sets die.** `modelNames`/`compositeTypeNames` sets and the `modelNamespaceIds` map answer "is this a relation/what namespace" — questions the binder's resolution kind and recorded namespace answer per reference.
- **The CST re-walk helpers die.** `findModelAttributeNode`/`findFieldAttributeNode` re-walk syntax to find attribute nodes whose parsed forms the symbols already carry and whose resolutions the binder already recorded.
- **The carried review finding is pinned:** a regression test where `public.User` and `auth.User` coexist and a relation in each namespace resolves to its own — the last-wins bug's exact shape.

## Coherence rationale

One package, one subject: the deletion of SQL's private resolution layer. Reviewable as a single PR because every change is the same move — replace a private lookup structure with a binder read — plus the pins proving equivalence and the one named correction.

## Scope

**In:** `packages/2-sql/2-authoring/contract-psl` only, plus `projects/symbol-table-resolve/`.

**Out:** interpreter-internal indexes that are not name resolution (FK pairing, STI/MTI maps stay); Mongo (its own slice); the language server; `contract-prisma7` (untouched, project DoD).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Duplicate model name across namespaces | Each relation resolves within its own namespace; regression-pinned | The review-verified last-wins bug (`interpreter.ts:1439` fallback) |
| Cross-space relation targets | Binder records `crossSpace`; interpreter's existing cross-space handling keeps its semantics | Resolution deferred where the space is known, unchanged |
| List-of-model / composite-typed fields | Binder resolutions cover them (coverage widened in binder-core review); interpreter reads must not reintroduce name-set membership checks | Learnings ledger: the widened coverage is unpinned — pin what this slice relies on |

## Slice-specific done conditions

- [x] Grep-verifiable: the flattened `modelNames`/`compositeTypeNames` sets, `modelNamespaceIds`, and `findModelAttributeNode`/`findFieldAttributeNode` no longer exist in the package. (`modelCoordinateKey`/`MODEL_COORDINATE_SEPARATOR` were struck from this list in D1: the Out-kept interpreter-internal indexes — MTI/STI variant keys, table-name maps, domain patches — lawfully use them; no name-RESOLUTION path may.)
- [x] Back-relation pairing is symbol-keyed: the D1-discovered defect (two namespaces' same-named models yield false `PSL_AMBIGUOUS_BACKRELATION` on a legal schema) is fixed and pinned red-first with D1's repro.
- [x] The duplicate-name-across-namespaces regression test exists and passes (red against the old fallback — verify by reverting the fix locally once).
- [x] No new diagnostics vocabulary: corrections surface through existing binder codes.

## Open Questions

None — the conversion pattern is settled by the parent decrees; discoveries route through the loop's halt discipline.

## References

- Parent project: `projects/symbol-table-resolve/spec.md`; decisions 1–13 in `design-decisions.md`.
- Carried finding: plan.md § sql-conversion (CodeRabbit, verified: `interpreter.ts:1430-1439`).
- Linear: omitted at operator request.

## Dispatch plan

### Dispatch 1: relation-targets-through-binder

- **Outcome:** relation lowering reads the binder's resolutions: the `modelMappings.get(fieldTypeName)` bare-name fallback and every bare-name mapping lookup are replaced with symbol-keyed (or resolution-derived namespace-qualified) lookups; `modelCoordinateKey` machinery deleted; the duplicate-name regression test written FIRST and red against the fallback; SQL suite green.
- **Builds on:** binder-core as merged (`62ceaab854`).
- **Hands to:** namespace-correct relation lowering — the structures dispatch 2 deletes no longer have callers in the relation path.
- **Focus:** `interpreter.ts` relation/polymorphism mapping lookups, `psl-relation-resolution.ts`, the new test. Not the name sets yet.

### Dispatch 2: delete-the-private-resolution-layer

- **Outcome:** flattened name sets and the CST re-walk helpers are deleted with their remaining callers converted to binder reads (`modelNamespaceIds` already fell in D1 under fix-the-class); back-relation candidate pairing converts from bare `typeName` keying to the binder's resolved symbols, fixing the false-ambiguity defect (D1's repro as the red-first pin); **the qualified-type voice suppression is narrowed** (ratified option (a) of D1 R2's finding): `voicedAsUncomposedNamespace` drops a binder `type`-class diagnostic only where SQL emits its `PSL_EXTENSION_NAMESPACE_NOT_COMPOSED` replacement for the same reference — attribute names and type-constructor calls, never a bare `ns.Type` — restoring the binder's voice for unresolved qualified type references (decision 10's "adopts all four classes" made true again), whereupon D1 R2's unqualified-only narrowing of the relation-loop split deletes itself and the split becomes unconditional (pinned: `wrong.User` refusal names `wrong.User`; wording per `namespace-diagnostic-wording.mdc`); the grep done-conditions pass; full gates green (package + fixtures + workspace typecheck + ratchets + lints).
- **Builds on:** dispatch 1's conversion of the relation path.
- **Hands to:** slice DoD; PR opens.
- **Focus:** the deletions and their call sites; nothing outside the package.

### Dispatch 3: retire-the-cst-rewalk-helpers (added after D2's evidence)

- **Outcome:** `ResolvedAttribute` becomes generic over its node (`ResolvedAttribute<TNode extends FieldAttributeAst | ModelAttributeAst = …>`, node recorded at the single construction site; `FieldSymbol.attributes` narrowed to the field form, entity attributes to the model form); `findModelAttributeNode`/`findFieldAttributeNode` and their 18 call sites die in favor of reading `symbol.attributes[…].node`; the grep condition passes. HALT if `contract-prisma7` (which imports `readResolvedAttribute(s)`) fails to compile untouched under the defaulted generic — its diff must stay empty.
- **Builds on:** D2's deletions.

### Dispatch 4: complete-the-type-class-adoption

- **Outcome:** SQL retires its `PSL_UNSUPPORTED_FIELD_TYPE` voice for names the binder reported unresolved (the D2-4A wart: unresolved fields now fall through to the field-type cascade and double-voice) while KEEPING its richer field-position voices (`PSL_EXTENSION_NAMESPACE_NOT_COMPOSED`, `PSL_UNKNOWN_FIELD_PRESET`) — the ~16 affected pins rewritten as exact sets with the change named; decision 10's full `type`-class adoption made true in field position.
- **Builds on:** D2's filter narrowing (the `constructorCall` tag).

### Dispatch 5: back-relation pairing (generic-key shape OPERATOR-RATIFIED 2026-09-25)

- **Outcome:** the D2-reverted symbol-keyed pairing relands, probing shapes in this order: **first, generic-with-default** — `ModelBackrelationCandidate<K = string>` / `FkRelationMetadata<K = string>` and the pairing functions generic over the key; SQL instantiates with binder-resolved `ModelSymbol`s, `contract-prisma7` rides the string default and must compile UNTOUCHED (the technique D3 demonstrated on `ResolvedAttribute<TNode>` against this same consumer — diff empty, checked twice). The false `PSL_AMBIGUOUS_BACKRELATION` defect fixed with the four-model repro red-first. **Fallback only if the compiler forces prisma7 edits:** option (a)'s unified string identity keys (~20 mechanical prisma7 lines), which re-opens the operator's DoD ruling — HALT there, do not proceed on the fallback without it.

Sizes: D1 M, D2 L (as landed: fronts 1+2+4A; 3 reverted on the DoD collision, 4B split to D3). Sequential.

**Open items from D2:** the extension-block model-ref resolver (`interpreter.ts:2393/:2418`) resolves written names namespace-only, diverging from the decreed declaring-namespace→top-level chain (no collision bug; a scoping divergence) — route with the block-reference future decision 13 reserved.
