# symbol-table-resolve — PSL binder

## Purpose

Give every PSL consumer one authoritative answer to "which declaration does this name denote," with one scoping rule and one diagnostic voice. Today four independent resolvers (SQL interpreter, Mongo interpreter, Prisma-7 interpreter, language server) re-implement name resolution and disagree on namespace scoping, so the same schema resolves differently depending on which tool asks. The parser gains a lazy, cached binder service; consumers stop hand-rolling resolution.

## At a glance

Today, resolving a field's type name is answered four different ways:

- SQL interpreter: top-level models first, then **all namespaces in arbitrary key order** (`psl-relation-resolution.ts:71-83`).
- Language server: declaring namespace first, then top level (`completion-symbols.ts:151-166`).
- Mongo interpreter: `allModels.find((m) => m.name === field.typeName)` — namespace-blind.
- Attribute specs: an uncached `resolveReferencedModel()` callback each consumer supplies with its own rule.

After this project, one service answers, lazily, with memoized results:

```ts
const { binder, diagnostics } = createBinder({ documents, sources, symbolTable, typeConstructors, attributeSpecs });

binder.declaredSymbol(modelDeclarationNode); // declaration node -> the symbol it declares
binder.symbolForNode(typeReferenceNode);     // reference node -> the symbol it denotes
diagnostics;                                 // every resolution failure; the binder's sole voice
```

The API is node-addressed and minimal — the two questions every surveyed compiler distinguishes (Roslyn: `GetDeclaredSymbol` vs `GetSymbolInfo`), with diagnostics returned beside the binder, extending the `buildSymbolTable` result pattern (`{ symbolTable, diagnostics }`). Symbol-addressed conveniences are added later only if call sites demand them.

Resolution follows a single decreed rule — declaring namespace → top level → universe scope (config-derived scalar/type-constructor symbols) — and sibling namespaces are never consulted. The binder resolves **eagerly at creation** in one two-phase pass; queries are map reads. Invalidation is by abandonment: an edit produces a new snapshot (documents + symbol table + binder), and the old one becomes garbage as a whole. There is no invalidation protocol to maintain or to get wrong.

### The eager pass (normative pseudo-code)

```ts
function createBinder({ documents, sources, symbolTable, typeConstructors, attributeSpecs }) {
  const universe = universeScope(typeConstructors);   // config scope: type names, shared across snapshots
  const specs = attributeSpecs;                       // config scope: attribute names (target-contributed, ADR 236)
  const declarations = new WeakMap<SyntaxNode, PslSymbol>();   // decl node -> its symbol
  const references = new WeakMap<SyntaxNode, Resolution>();    // ref node -> what it denotes
  const diagnostics: ParseDiagnostic[] = [];

  // PHASE 1: declarations + type references
  for (const scope of scopesOf(symbolTable))
    for (const owner of [...scope.models, ...scope.compositeTypes]) {
      declarations.set(owner.node.syntax, owner);
      for (const field of owner.fields) {
        declarations.set(field.node.syntax, field);
        references.set(typeNode(field).syntax,
          resolveTypeRef(field, chain(scope, symbolTable.topLevel, universe)));
      }
    }

  // PHASE 2: attribute references (reads phase-1 results; no cycle — type refs never need attribute refs)
  for (const [scope, owner] of ownersOf(symbolTable)) {
    for (const attr of owner.attributes) {            // ResolvedAttribute[] — args already parsed
      const spec = specs.model(attr.name);
      references.set(attrNameNode(attr).syntax,
        spec ? { kind: 'attributeSpec', spec } : unknownAttribute(attr, diagnostics));
      if (spec) bindArgs(attr, spec, { self: owner, scope });
    }
    for (const field of owner.fields)
      for (const attr of field.attributes) {
        const spec = specs.field(attr.name);
        const referencedModel = modelOf(references.get(typeNode(field).syntax)); // phase-1 map read
        if (spec) bindArgs(attr, spec, { self: owner, field, referencedModel, scope });
      }
  }

  function bindArgs(attr, spec, ctx) {
    // only the spec knows which arguments are references (combinator kinds, ADR 231/249)
    for (const { argNode, kind, name } of referenceArgs(attr, spec)) {
      switch (kind) {
        case 'fieldRef':            // @@index([a, b]), @relation(fields: [...])
          bind(argNode, ctx.self.fields[name], diagnostics); break;
        case 'referencedFieldRef':  // @relation(references: [...])
          if (ctx.field.typeContractSpaceId !== undefined)
            references.set(argNode.syntax, { kind: 'crossSpace' });  // explicit kind, no diagnostic:
            // resolvable only where that contract space is known (replaces today's silent skip)
          else bind(argNode, ctx.referencedModel?.fields[name], diagnostics); break;
        case 'entityRef':           // @@base(Foo), @@discriminator target
          bind(argNode, resolveName(name, chain(ctx.scope, symbolTable.topLevel)), diagnostics); break;
      }
    }
  }

  return { binder: { declaredSymbol, symbolForNode }, diagnostics };
}
```

Consumer wiring: the attribute-spec parse-time context keeps its ADR 249 shape, but `resolveReferencedModel` stops being a consumer-supplied callback with four implementations and becomes one map read:

```ts
const ctx: FieldAttributeCtx = {
  ...,
  resolveReferencedModel: () => modelOf(binder.symbolForNode(typeNode(field))),
};
```

Interpreters still run spec interpretation for argument **values**; the binder owns only name-reference resolution within attribute arguments. Query timing is not part of the binder's contract — `declaredSymbol` and `symbolForNode` reveal nothing about when resolution ran; the factory's eagerly-returned diagnostics are the contract's one timing commitment, owned and revisable by the future incremental-reparse project.

## Non-goals

- **Prisma-7 interpreter conversion.** `contract-prisma7` keeps its hand-rolled cross-file name map untouched, by operator decree.
- **Incremental reparse, green-node sharing, hash-consing.** Every edit still reparses the document in full; snapshot economics make this acceptable at PSL scale.
- **Dependency-tracked (Salsa-style) invalidation.** No revision counters, no memo verification, no dependency recording. Snapshot discard only.
- **Lazy binding and cross-snapshot memo retention.** The binder resolves eagerly per snapshot. On-demand resolution and early-cutoff memo reuse become worthwhile only alongside incremental reparse; that future project inherits an API already shaped for them.
- **Bug-for-bug parity for corrected consumers.** The SQL sibling-namespace scan and Mongo's namespace blindness are defects being corrected, not behavior being preserved; each correction is named in its slice.
- **Restoring scalar name lists into `buildSymbolTable`.** The eager symbol table stays family-blind; scalar knowledge enters only at binder creation, as symbols in the universe scope, sourced from the existing type-constructor registry (commit `72cd71550f`'s unification stands).
- **New LSP features.** The LSP slice only converts existing surfaces (completions, signature help, semantic tokens) onto the binder. Every new resolution-backed feature — go-to-definition, hover, references, rename — is follow-on work outside this project, by operator decree.

## Place in the larger world

- **Home:** `packages/1-framework/2-authoring/psl-parser`. The binder follows the repo's interface + factory pattern for stateful services; the symbol table remains pure data with no lookup methods.
- **Base branch:** stacks on PR #30335 (`multifiile-psl`), which already makes `buildSymbolTable` accept `documents: readonly DocumentAst[]` plus a `PslSources` registry (red-root → `SourceFile`, ADR 253). The binder is multi-document from birth; N=1 is the common case.
- **Consumers converted:** SQL `contract-psl` (`packages/2-sql/2-authoring/contract-psl`), Mongo `contract-psl` (`packages/2-mongo-family/2-authoring/contract-psl`), the attribute-spec combinators (`psl-parser/src/attribute-spec/`, ADR 249 contexts), and the language server (`packages/1-framework/3-tooling/language-server`).
- **Constraining ADRs:** ADR 249 (central attribute-spec registry — the `resolveReferencedModel` seat the binder fills), ADR 253 (red-root source ownership — the identity-keyed side-table precedent the binder extends), ADR 126 (block SPI — the injection precedent for target-contributed knowledge), ADR 104 (namespace qualification grammar the scoping rule interprets), ADR 163 (provider → parse → symbol table → interpret contract the binder slots into).
- **External practice grounding** (researched, not recalled): Roslyn's red-slot caching (`SyntaxNode.GetRed`, `Interlocked.CompareExchange`) and lazy `Binder`/`SemanticModel` layering; TypeScript's eager per-file bind with lazy memoized checking discarded per program; snapshot-discard invalidation over dependency tracking per rust-analyzer's own architecture assessment for small languages. Sources in References.

## Cross-cutting requirements

1. **One scoping rule everywhere.** Unqualified references resolve declaring namespace → top level → universe scope; sibling namespaces are never consulted. User declarations shadow universe-scope symbols silently — no shadowing diagnostic. Every converted consumer carries a test pinning this rule against a schema where a namespaced declaration shadows a top-level one.
2. **The binder is the sole voice of resolution failures.** It owns unresolved- and ambiguous-reference diagnostics (it holds `PslSources`, so filenames and ranges are at hand), returned beside the binder from `createBinder`. Failure diagnostics use a new parser-owned `PSL_UNRESOLVED_REFERENCE` code family; converted consumers adopt these codes, map them into their channels, and never re-emit their own — the symbol table's duplicate-declaration precedent, extended. Shape failures (arity, argument type, malformed literals) remain the spec combinators' voice; they are not resolution.
3. **Queries are timing-neutral; diagnostics are a creation-time guarantee.** `declaredSymbol` and `symbolForNode` return snapshot-scoped, stable answers and reveal nothing about when resolution ran. Complete diagnostics are returned by `createBinder` itself — the contract's one eager commitment, accepted knowingly for pipeline symmetry; a future lazy implementation must fill it at creation or change the factory's result shape. Resolution runs eagerly at creation: phase 1 type references, phase 2 attribute references (which read phase-1 results); the diagnostics are that pass's byproduct.
4. **Within-snapshot node identity.** The red layer caches child wrappers in parent slots (Roslyn's `GetRed` design): two traversals to the same position return the same object, making identity-keyed side tables (`WeakMap`) correct. Memos are keyed by object identity of symbols and red nodes — never by green nodes (position-free and shareable across snapshots) and never by spans as cross-snapshot keys.
5. **Invalidation by abandonment.** Document-derived state (red tree, symbol table, binder memos) is dropped whole on any document change, per the existing `project-artifacts.ts` drop-on-change discipline. The universe scope is config-derived, shared across snapshots, and invalidated only by configuration change — never by document edits.
6. **Family knowledge is injected, not imported.** The binder receives the type-constructor registry (scalars included) at its factory, as `pslBlockDescriptors` is injected today; `psl-parser` gains no dependency on target packages.
7. **Corrections are named, never smuggled.** Each consumer conversion states its behavior changes in its slice spec and PR description.

## Transitional-shape constraints

- Work stacks on the unmerged PR #30335 and lands after it; no cherry-picking its content into `main` independently.
- A consumer converts wholly within its slice: no consumer carries both a hand-rolled resolver and binder calls for the same question across slice boundaries.
- Unconverted consumers keep working unmodified at every intermediate state; the binder is additive until a conversion slice claims its consumer.

## Project Definition of Done

- [ ] Team-DoD floor (inherited; `drive/calibration/dod.md` is absent in this repo — the standing floor is green CI, tests written before implementation, and `pnpm lint:deps` clean).
- [ ] A binder service exists in `psl-parser` behind an interface + factory returning `{ binder, diagnostics }`, the binder exposing the node-addressed core (`declaredSymbol`, `symbolForNode`); tests pin that repeated queries return stable results and that the returned diagnostics carry every resolution failure without consumer-side enumeration.
- [ ] Cross-space references resolve to an explicit cross-space result kind with no binder diagnostic, replacing today's silent skip in `referencedFieldRef`.
- [ ] A red-layer test pins within-snapshot identity: traversing to the same child twice yields the same object.
- [ ] SQL and Mongo interpreters answer type-reference, relation-target, and entity-reference questions exclusively through the binder; their local resolvers (`resolveReferencedModel` in `psl-relation-resolution.ts`, Mongo's `allModels.find`) are deleted.
- [ ] The attribute-spec contexts' `resolveReferencedModel` is served by the binder; consumer-supplied resolution callbacks are gone.
- [ ] The language server's span-scan reverse binding (`modelSymbolForNode`) and both duplicated name-classification cascades (`completion-symbols.ts`, `semantic-tokens.ts`) are replaced by binder queries.
- [ ] The shadowing schema (same name declared in a namespace and at top level) resolves identically — namespace-local first — in parser tests, both interpreter test suites, and LSP tests.
- [ ] Unresolved-reference diagnostics are emitted only by the binder; converted consumers contain no unresolved-reference emission of their own.
- [ ] A test pins that a document edit does not rebuild the universe scope (object identity across snapshots) and that user declarations shadow universe symbols.
- [ ] `packages/2-sql/2-authoring/contract-prisma7` is untouched: its diff against the base branch is empty at project close.

## Open Questions

None. The four questions this spec first shipped with were resolved by the operator on 2026-09-18: all new LSP features (go-to-definition included) are follow-on work; the stack on PR #30335 stands with no independent landing path; the `PSL_UNRESOLVED_REFERENCE` code family is confirmed; silent shadowing of universe symbols is confirmed. The resolutions are folded into Non-goals and Cross-cutting requirements above.

## References

- Linear Project: omitted at operator request.
- Base PR: [prisma/orm#30335 — refactor(psl): track source provenance by syntax root](https://github.com/prisma/orm/pull/30335), branch `multifiile-psl`.
- ADRs: 249 (attribute-spec registry), 253 (red-root source ownership), 126 (block SPI), 104 (namespacing), 163 (provider interpretation).
- Design-discussion record: [`design-decisions.md`](./design-decisions.md) — the decrees with reasoning and rejected alternatives.
- External sources: [Roslyn `SyntaxNode.GetRed`](https://github.com/dotnet/roslyn/blob/main/src/Compilers/Core/Portable/Syntax/SyntaxNode.cs), [Lippert — red-green trees](https://ericlippert.com/2012/06/08/red-green-trees/), [Roslyn `BinderFactory`](https://github.com/dotnet/roslyn/blob/main/src/Compilers/CSharp/Portable/Binder/BinderFactory.cs), [TypeScript binder notes](https://github.com/microsoft/TypeScript-Compiler-Notes/blob/main/codebase/src/compiler/binder.md), [TypeScript checker notes](https://github.com/microsoft/TypeScript-Compiler-Notes/blob/main/codebase/src/compiler/checker.md), [Salsa book](https://salsa-rs.github.io/salsa/), [rust-analyzer architecture](https://rust-analyzer.github.io/book/contributing/architecture.html), [Three Architectures for Responsive IDE](https://rust-analyzer.github.io/blog/2020/07/20/three-architectures-for-responsive-ide.html), [clangd threading design](https://clangd.llvm.org/design/threads).
