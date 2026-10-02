# lsp-hover — design decisions log

## 1. `///` reader moves onto the AST (2026-10-02, operator correction)

**Trigger:** the operator reviewed slice `hover` (PR #30569). The project spec's "only the language server reads `///`" meant that the language server is the only *caller* for now. It did not mean the reader should live in the language server.

**Decision:**
- `docComment()` goes on the strongly typed AST classes that can carry a doc comment: `ModelDeclarationAst`, `CompositeTypeDeclarationAst`, `FieldDeclarationAst`, `NamedTypeDeclarationAst` and `GenericBlockDeclarationAst`.
- A `HasDocComment` interface declares the method.
- The comment is read lazily: computed when called, with nothing extracted at parse time.
- The language server's `doc-comment.ts` is removed, and hover calls `node.docComment()`.

**Affected artefacts:** `spec.md` § At a glance and decision 5, `plan.md` slice 1, `slices/hover/spec.md` § Chosen design and § Scope.
