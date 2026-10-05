# lsp-hover — design decisions log

## 1. `///` reader moves onto the AST (2026-10-02, operator correction)

**Trigger:** the operator reviewed slice `hover` (PR #30569). The project spec's "only the language server reads `///`" meant that the language server is the only *caller* for now. It did not mean the reader should live in the language server.

**Decision:**
- `docComment()` goes on the strongly typed AST classes that can carry a doc comment: `ModelDeclarationAst`, `CompositeTypeDeclarationAst`, `FieldDeclarationAst`, `NamedTypeDeclarationAst` and `GenericBlockDeclarationAst`.
- A `HasDocComment` interface declares the method.
- The comment is read lazily: computed when called, with nothing extracted at parse time.
- The language server's `doc-comment.ts` is removed, and hover calls `node.docComment()`.

**Affected artefacts:** `spec.md` § At a glance and decision 5, `plan.md` slice 1, `slices/hover/spec.md` § Chosen design and § Scope.

## 2. The binder records declarations on their name nodes (2026-10-02, operator decision)

**Trigger:** the operator asked why hover special-cases declaration names (`declarationNamedBy`). The binder stored a declared symbol only on the whole declaration node, so a declaration's name had no resolution of its own.

**Decision:**
- The binder also records each declaration's symbol on its name's identifier node, in the map `symbolForNode` reads. This applies to models, composite types, fields, named types and blocks. Namespaces are excluded, because they can have several declarations.
- Hover drops `declarationNamedBy` and uses one lookup.
- `declaredSymbol` stays keyed on the declaration node for attribute-spec resolution and completion.
- Go-to-definition on a declaration's name returns the declaration itself instead of `null`.

**Affected artefacts:**
- `spec.md` decision 10;
- `slices/hover/spec.md` § At a glance, § Chosen design and § Scope;
- `plan.md` slice 1;
- `projects/lsp-go-to-definition/spec.md` § At a glance. Its slice 2 is in flight on branch `go-to-definition-provider` and implements `null` today; that slice adapts to this.
