# Slice: hover

Parent project: `projects/lsp-hover/`. This slice is the user-visible part of hover: documentation and declaration lines for everything the binder already resolves.

## At a glance

The language server declares `hoverProvider` and answers `textDocument/hover` for:
- declared entities (models, composite types, fields, named types, blocks), whether hovered at a reference or at the declaration name, with `///` documentation when present;
- model and field attributes;
- contributed types;
- block keywords.

`binder.ts` does not change.

## Chosen design

**Flow.** It follows the pattern `signatureHelp` already uses:

```
server.ts  connection.onHover → project.hover(uri, position)
project.ts hover(): resolve member + document, call providePslHover({ document, sourceFile, position, binder, pslBlockDescriptors, … }), catch → null
hover.ts   providePslHover(input): Hover | null
```

**Finding what is under the cursor.**
1. Take `document.syntax.tokenAtOffset(offset)` and keep the `Ident` token. If no `Ident` token is there, return `null`.
2. Walk up from the token through its ancestors.
   - For each ancestor, take the first `binder.symbolForNode(ancestor)` that is defined. That gives a reference resolution.
   - If the token is the name of a declaration, use `binder.declaredSymbol(declarationNode)` instead.
   - If the token is the keyword of a generic block, the result is a block keyword.
3. If `lsp-go-to-definition` slice 2 has landed by then with a cursor-to-resolution helper, reuse it rather than writing a second one.

**What each resolution shows.** The content is a fenced `prisma` block, followed by the documentation when there is any.

| Resolution | Fenced line | Documentation |
|---|---|---|
| `model` / `compositeType` | `model User` / `type Address` (keyword + name) | `///` above the declaration |
| `field` | the field declaration's source text on one line, attributes included, runs of whitespace collapsed (`email String @unique`) | `///` above the field |
| `namedType` | the named-type declaration's source text on one line | `///` above it |
| `block` | keyword + name (`policy ReadOwn`) | `///` above the block |
| `attribute` | the attribute signature label from the `signature-help.ts` renderer (`@relation(…)` / `@@index(…)`) | `spec.documentation` |
| `contributedType` | `pg.Varchar(<arg labels>)` from descriptor `args`, or the bare path when there are no args | `descriptor.documentation` when set |
| block keyword | — (no fence) | `AuthoringPslBlockDescriptor.documentation`; `null` when unset |
| `namespace`, `contributedNamespace`, `crossSpace`, `unresolved`, no resolution | — | `null` |

The returned `range` is the hovered token's range.

**`///` reader** (`doc-comment.ts`):
1. Start from the declaration's syntax node and walk back through its preceding sibling tokens in the parent.
2. Collect `Comment` tokens whose text starts with `///`. Only whitespace and single newlines may sit between them.
3. Stop at a blank line (two newlines), at a `//` comment that is not `///`, or at any non-trivia element.
4. Strip the `///` prefix and one following space from each line, then join the lines with `\n`.

The result is used as Markdown as written.

## Coherence rationale

Everything here is the language server's hover path, from the request handler to the rendered Markdown, for resolutions that already exist. A reviewer reads one new provider, its two helpers (the `///` reader and the declaration-line renderer), and the server wiring.

## Scope

**In:**
- `hover.ts`, `doc-comment.ts` and a declaration-line renderer in `packages/1-framework/3-tooling/language-server/src/`;
- `project.ts` `hover()`;
- `server.ts` capability and handler;
- extracting the signature-label rendering in `signature-help.ts` so hover can reuse it, with no change to signature-help behaviour;
- tests;
- the hover section in the language-server README.

**Out:**
- any `binder.ts` change: no `parameter`, `function` or `constant` resolutions, and no block attributes (slice `hover-arguments`);
- hover on argument keys, function names and constants;
- the manual QA script and run (slice 2 runs it over the full spec table).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --- | --- | --- |
| A field and its attribute both carry resolutions on the ancestor chain. | The innermost node wins. | Hovering `@unique` shows the attribute, and hovering `email` shows the field. |
| The declaration is in another file of the same project. | Its `///` is read from the target node's own parent. | Symbols carry their node, so no extra file lookup is needed. |
| A `///` run is broken by a blank line or a `//` line. | Only the lines below the break count. | This matches the spec's decision 6. |

## Slice-specific done conditions

- [ ] `server.test.ts` asserts `hoverProvider: true`, and a hover test exists for each row of the resolution table above, including the cross-file reference.

## Open Questions

None. The project spec's two open questions are settled here: field and named-type lines are the declaration's source text on one line, and model, composite-type and block lines are the keyword and name.

## References

- Parent project: `projects/lsp-hover/spec.md`
- Linear issue: none (skipped by operator)
- Sibling: `lsp-go-to-definition` slice 2 (cursor-to-resolution lookup)
