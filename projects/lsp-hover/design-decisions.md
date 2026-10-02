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

## 3. A `oneOf` of fixed identifiers prefers the exact match (2026-10-02, orchestrator decision during hover-arguments D1)

**Trigger:** the implementer found a problem with fixed identifiers in a `oneOf`. In the binder, a fixed `identifier(...)` rule always counts as matched, even when its text differs: a mismatched identifier works as a no-op fallback, and `block-binder.test.ts` relies on that. So in `oneOf(identifier('NoAction'), identifier('Restrict'), identifier('Cascade'), …)` (SQL `referentialActionArgument`), the first alternative always wins, and `Cascade` would never get a `constant` resolution. That is the project spec's headline example.

**Decision:** before the existing first-match scan, `oneOf` returns the trial of an alternative that is a fixed identifier whose name equals the written identifier, if there is one. Every other case keeps today's behaviour, including mismatched identifiers as no-op fallbacks. In the old order that alternative's trial would have been a reference-free, diagnostic-free no-op, so choosing it changes nothing except adding the `constant` record.

**Rejected:**
- Accepting the limitation. `Cascade`, `SetNull` and every non-first referential action would show no hover.
- Making mismatched fixed identifiers fail to match. That changes the no-op fallback that block value specs rely on.

**Affected artefacts:** `slices/hover-arguments/spec.md` § Recording rules.

## 4. A fixed identifier that does not match fails; this supersedes § 3 (2026-10-02, operator decision)

**Trigger:** the operator rejected § 3's exact-match shortcut as confusing. The reviewer found F7: the shortcut can skip an earlier reference alternative that matches the same text.

**Decision:**
- In the binder, an `identifier(name)` rule with a fixed `name` matches only when the written identifier equals `name`, and then records a `constant`. Otherwise it fails to match, and the binder reports no diagnostic of its own.
- Unrestricted `identifier()` still matches any identifier.
- `oneOf` uses its normal first-match loop; the exact-match shortcut is removed.
- `bool()`, `num()` and `str()` stay no-ops in the binder.
- Value errors keep coming from the interpreter's `parse` (`Expected one of …`), so a mistake still gets one diagnostic.

**Consequence:** in `block-binder.test.ts`, the cases using `identifier('Other')` alongside a missing reference now expect the binder's `Cannot find entity "Missing"`. No production `oneOf` changes behaviour: the only one mixing a reference and an identifier, postgres `authoring.ts`, uses unrestricted `identifier()`.

**Rejected:**
- The binder also reporting a diagnostic. It would duplicate the interpreter's error, would need its own `oneOf` aggregation, and raises the question of checking scalar values in the binder. It is deferred to its own change, together with removing the interpreter's check.
