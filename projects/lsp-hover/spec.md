# lsp-hover — hover documentation in the PSL language server

## Purpose

Let a schema author learn what a name in a `.prisma` file means without leaving the editor: what an attribute, argument, function or constant does, and what a declared model, field, type or block is. Hover reads the same binder resolution as diagnostics and go-to-definition, so the editor describes the symbol the interpreter would use.

## At a glance

```prisma
/// A person who can sign in.
model User {
  id    Int    @id @default(autoincrement())
  /// Primary contact address.
  email String @unique
  posts Post[]
}

model Post {
  id       Int  @id
  authorId Int
  author   User @relation(fields: [authorId], references: [id], onDelete: Cascade)
}

policy ReadOwn { … }
```

`textDocument/hover` answers:

| Cursor on | Resolution | Hover content |
|---|---|---|
| `User` in `author User`, or in `model User {` | `model` (reference or declaration) | ` ```prisma model User``` ` + "A person who can sign in." |
| `email` in `@@index([email])` | `field` | ` ```prisma email String @unique``` ` + "Primary contact address." |
| `posts` in `model User` | `field` with no `///` | ` ```prisma posts Post[]``` ` only |
| `@relation` | `attribute` (existing) | signature label + `AttributeSpec.documentation` |
| `references` in `references: [id]` | `parameter` (new) | `references: <type label>` + `Param.documentation` |
| `autoincrement` | `function` (new) | `autoincrement()` + `FuncCallSig.documentation` |
| `Cascade` | `constant` (new) | `Cascade` + `FixedIdentifierArgType.documentation` |
| `pg.Varchar` | `contributedType` | descriptor documentation, else `pg.Varchar(<arg labels>)` |
| `policy` keyword | not a symbol | `AuthoringPslBlockDescriptor.documentation` when set |
| `[authorId]` value in positional position, unresolved names, `crossSpace` | — | `null` |

The content has two parts:
1. A fenced `prisma` block with a short declaration line, which is always present for a hoverable symbol.
2. The documentation as Markdown, when there is any.

The hover range is the token under the cursor.

Two changes make this possible:

- **Binder.** It records new resolutions on nodes that have documentation but no symbol today:
  - Named-argument keys on attributes, on function calls and on struct-block entries resolve to `parameter`.
  - Function-call names resolve to `function`.
  - Fixed identifier values resolve to `constant`.
  - Block attributes resolve to `attribute`, the same way model and field attributes already do.
- **`///` doc comments.** The parser already keeps `///` lines as `Comment` trivia in the parent node, just before the declaration they precede. The strongly typed AST classes that can carry one gain a `docComment()` method, declared by a `HasDocComment` interface. It reads the trivia when called. Parsing, the symbol table and the contract are unchanged.

## Decisions

1. **Keys bound to `parameter`:** named attribute arguments, named function-call arguments, and struct-block entry keys. Map-block entry keys are not bound: their names are chosen by the user, and the only documentation available is the value spec's.
2. **Positional argument values get no parameter hover.** Hover shows the hovered thing itself, which matches tsserver, rust-analyzer, Pylance and gopls. Existing signature help (`signature-help.ts`) already shows which parameter a positional value fills. A positional value that resolves to a symbol (a model, a field, a constant) shows that symbol.
3. **New binder resolutions:**
   - `ParameterSymbol { name, param, owner }`, where `owner` is an attribute, a function or a block.
   - `FunctionSymbol { name, signature }`.
   - `ConstantSymbol { name, documentation }`.
   - `AttributeSymbol.level` gains `'block'`.

   Function and constant symbols are recorded inside `tryBindExpression`, so for a `oneOf` rule only the alternative that matches records them, the same way references are recorded today.
4. **Composite-type attributes are not bound.** Neither family has attribute specs for composite types (SQL rejects them in `interpreter.ts`), so there is no documentation to show.
5. **`///` documentation is read through `docComment()` on the AST, and only the language server calls it for now.** The method is computed on call: parsing does not extract or store anything. A `HasDocComment` interface names the AST classes that carry one. Symbols, the symbol table and the contract do not carry it. (Amended 2026-10-02 by the operator: the reader lives on the AST classes, not as a language-server helper.) Rejected for now:
   - Documentation on symbols (option b). It would serve no consumer other than hover yet.
   - Emitting it into `contract.json` / `contract.d.ts` (option c). That is a separate feature with fixture churn.
6. **Where `///` is read:** on models, composite types, fields, named types and blocks.
   - Namespaces are excluded. They can be declared more than once, which would need a merge rule.
   - Block entries are excluded. They have no symbol and nothing references them.

   A `///` in an unsupported position stays an ordinary comment. The documentation is the run of consecutive `///` lines directly above the declaration: no blank line in between, and no `//` line breaking the run.
7. **Every hoverable symbol shows a short declaration line, with documentation when there is any.** Symbols without documentation still get hover, which is what tsserver and rust-analyzer do.
   - Attribute and function lines reuse the signature rendering in `signature-help.ts`.
   - Parameter lines are `key?: <ArgType.label>`.
   - Declaration lines for models, fields, named types and blocks are rendered from the AST: the header only, without the body.
8. **Hover from a reference shows the declaration's `///` documentation, even when the declaration is in another file of the same project.** Symbols carry their declaration node.
9. **The block keyword is handled by the hover provider, not the binder.** It is a token, not a symbol. It shows `AuthoringPslBlockDescriptor.documentation`, and returns `null` when that is unset.

## Non-goals

- `///` documentation in `contract.json`, `contract.d.ts`, the symbol table or binder symbols.
- `///` on namespaces and block entries (enum members, policy keys).
- Hover on map-block entry keys.
- Parameter hover on positional argument values.
- Inlay parameter-name hints.
- Hover for attributes the active control stack does not define (unknown attributes): `null`.
- Go-to-definition for the new `parameter` / `function` / `constant` resolutions. They have no PSL declaration to jump to.
- Any change to completion, signature help or semantic-token behaviour.

## Place in the larger world

- **`lsp-go-to-definition` project** (worktree `go-to-definition`).
  - This project is stacked on that branch. Its slice 1 (#30563, open) rewrites how the binder is built (`createProjectBinder`) and edits `binder.ts`, which this project also edits. Stacking avoids a rebase across that rewrite. The language server already holds a binder on `main` (`ProjectArtifacts.binder()`), so hover does not depend on #30563 for anything else.
  - Its slice 2 adds a "walk up from the cursor token to the nearest node with a resolution" lookup for `textDocument/definition`. Hover needs the same lookup. Whichever lands first owns the helper, and the other reuses it.
  - Definition must return `null` for the new `parameter` / `function` / `constant` resolutions, as it already does for `attribute`.
- **psl-parser binder** (`packages/1-framework/2-authoring/psl-parser/src/binder.ts`): the new `Resolution` kinds and the binding changes in `bindAttributes`, `bindBlock` and `tryBindExpression`.
- **Documentation sources**, all existing:
  - `AttributeSpec.documentation`
  - `Param.documentation`
  - `FuncCallSig.documentation`
  - `FixedIdentifierArgType.documentation`
  - `AuthoringTypeConstructorDescriptor.documentation`, optional
  - `AuthoringPslBlockDescriptor.documentation`, optional
- **Language server** (`packages/1-framework/3-tooling/language-server`):
  - `server.ts` registers `hoverProvider`.
  - `signature-help.ts` / `attribute-argument-grammar.ts` supply the signature labels.
- **Formatter** (`psl-parser/src/format/emit.ts`): already keeps `///` as a leading comment. Unchanged.

## Cross-cutting requirements

- **Hover and diagnostics agree on resolution.** Hover reads `binder.symbolForNode` / `binder.declaredSymbol` and never resolves names on its own.
- **The new `Resolution` kinds leave every other binder consumer unchanged:** the SQL and Mongo interpreters, completion, semantic tokens, signature help and definition. Existing tests in those packages pass without edits to their expectations.
- **No dependency on a target or family.** Documentation comes only from contributed specs and descriptors. The language server does not branch on target.

## Transitional-shape constraints

- Each slice merges on its own with CI green. A binder slice that lands before hover leaves the new resolutions recorded but not consumed by any production code.
- The stack base is `go-to-definition`. If #30563 changes shape before merging, rebase onto it. Do not copy its binder construction.

## Project Definition of Done

Inherits [`drive/calibration/dod.md`](../../drive/calibration/dod.md).

- [ ] Hovering each row of the At-a-glance table in VS Code with the Prisma 8 extension produces the listed content, verified by a `drive-qa-run` report.
- [ ] Language-server tests cover hover for every resolution kind in the table, including a reference to a declaration in another file and a `///` run broken by a blank line.
- [ ] psl-parser binder tests cover the `parameter`, `function`, `constant` and block-`attribute` resolutions, including a `oneOf` value where only the matching alternative records symbols.
- [ ] `server.ts` advertises `hoverProvider: true`, and the server test asserts the capability.
- [ ] The language-server README lists hover among the supported features.

## Open Questions

1. **Declaration-line format for fields.** Should it show the field's attributes (`email String @unique`) or only name and type (`email String`)? Working position: name, type and attributes, as written, on one line.
2. **Fallback for blocks with many header tokens.** Working position: keyword and name only (`policy ReadOwn`).

## References

- Linear Project: none (skipped by operator)
- Sibling project: `lsp-go-to-definition` (PR #30563, slice 2 pending)
- Design discussion: drive-discussion session, 2026-10-01 (decisions captured above)
