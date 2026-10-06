# lsp-find-references — find references for entities, fields and namespaces

## Purpose

Let a schema author see every place a model, type, block, field or namespace is used across the project, with the same name resolution the interpreter and go-to-definition use. A usage list that disagrees with resolution is worse than none, because the planned rename feature will edit exactly the positions this list returns.

## At a glance

Given this project of three files:

```prisma
// auth.prisma
namespace auth {
  model User {
    id    Int    @id
    posts Post[]
  }
}

// session.prisma
namespace auth {
  model Session {
    id     Int  @id
    userId Int
    user   User @relation(fields: [userId], references: [id])
  }
}

// post.prisma
model Post {
  id       Int       @id
  authorId Int
  author   auth.User @relation(fields: [authorId], references: [id])

  @@index([authorId])
}
```

`textDocument/references` answers the same for a cursor on the declaration name and for a cursor on any reference to it:

| Symbol | Usages returned | With `includeDeclaration` also |
|---|---|---|
| model `User` | `User` in `user User` (session.prisma), `User` in `auth.User` (post.prisma) | `User` in `model User` |
| field `id` of `User` | `id` in `references: [id]` in session.prisma and in post.prisma. Not `Session.id`, not `Post.id` | `id` in `id Int @id` of `User` |
| field `authorId` | `authorId` in `fields: [authorId]`, `authorId` in `@@index([authorId])` | `authorId` in `authorId Int` |
| model `Post` | `Post` in `posts Post[]` | `Post` in `model Post` |
| namespace `auth` | `auth` in `auth.User`, and the name of both `namespace auth` blocks | nothing more: every block name is already returned |

The server answers in four steps:

1. Resolve the symbol at the cursor with `resolvedNodeAt` (the lookup go-to-definition and hover use).
2. Search the text of every schema file of the project for the symbol's name.
3. For each match, take the token at that offset. Keep it only if it is an identifier token whose text equals the name exactly, then resolve it with `resolvedNodeAt`.
4. Keep the tokens whose resolution names the same symbol object as step 1. Return the range of the token, not of the resolved node: for `auth.User` the resolved node is the whole qualified name, and the usage of `User` is only the last segment.

Go-to-definition on a declaration's own name changes with this project. It returned `null`; it now returns the declaration's own location. VS Code runs find references when a definition result is the position the cursor is already on, so F12 on `model User` shows the usages of `User`.

## Non-goals

- **Rename.** A separate project, built on this one.
- **Enum member references** (`@default(ACTIVE)`). The binder records no resolution for them. Usages of the enum block itself are in scope.
- **Symbols with no declaration in the schema sources**: attributes, attribute and block parameters, functions, constants, contributed types and namespaces, cross-space references. A cursor on one of these returns an empty result.
- **Document highlight** (`textDocument/documentHighlight`).
- **Field references inside block specs.** A block spec cannot declare a `fieldRef` parameter (the type system rejects it, see ADR 249), so there is nothing to find. If that is ever allowed, the binder records the resolution and this feature needs no change.
- **A reverse index in the binder.** The binder keeps mapping nodes to resolutions only. Candidates are found by text search in the language server.
- **Changes to what the binder resolves**, other than the namespace block name described below.

## Place in the larger world

- **Binder** (`packages/1-framework/2-authoring/psl-parser/src/binder.ts`). `symbolForNode(node)` returns the resolution for references and, since #30569, for the name node of a model, composite type, named type, block and field declaration. It does not record one on the name of a `namespace` block today: the block node is in `declaredSymbol`, the name identifier has no resolution. This project adds a `namespace` resolution on each namespace block's name node. This is the only binder change, and it only binds.
- **Language server** (`packages/1-framework/3-tooling/language-server`).
  - `cursor-resolution.ts`: `resolvedNodeAt` is reused unchanged. The file also holds the two lookups hover, go-to-definition and find references share: `identTokenAt` (the identifier touching the cursor) and `pslSymbolOf` (the declared symbol a resolution names, if any).
  - `ProjectArtifacts` already parses and binds every schema input of the project to build the symbol table and the binder, and each `DocumentSnapshot` holds the file text. Find references reads both; no new file discovery or reading is added.
  - `definition.ts` stops returning `null` on a declaration's own name.
  - `server.ts` declares `referencesProvider` and handles `textDocument/references`; `Project` gains the request method next to `definition`, with the same membership checks.
- **Syntax tree** (`psl-parser/src/syntax/red.ts`). `tokenAtOffset` maps a text match to its token. Tree nodes are created on first access, which is why a text search followed by `tokenAtOffset` on the matches is preferred over visiting every token of every file.
- **Predecessor project**: go-to-definition (#30563, #30578), whose spec named find references as the follow-up that gives a declaration name position a use.
- **ADRs**: ADR 255 (block references resolve through the snapshot binder), ADR 249 (why `fieldRef` cannot be used in a block spec). No new ADR: this project introduces no architectural decision.

### Contract impact

None. No contract entity, kind, or emitted artifact changes.

### Adapter impact

None.

## Cross-cutting requirements

- **Same resolution as go-to-definition.** A token is a usage of a symbol exactly when go-to-definition from that token reaches that symbol's declaration. Both features go through `resolvedNodeAt`; find references has no name matching of its own beyond the text search that produces candidates.
- **Symbol identity decides, text only proposes.** A text match is a usage only if its resolution holds the same symbol object as the cursor's resolution. Two fields named `id` on different models are different symbols and never appear in each other's results.
- **Exact identifier tokens only.** A match inside a longer identifier (`UserProfile` for `User`), a comment or a string is discarded before any binder lookup.
- **Token ranges.** Every returned location is the range of one identifier token: the last segment of a qualified name for an entity, the qualifier for a namespace. Rename will replace exactly these ranges.
- **Whole project.** Results cover every schema input of the project, including files not open in the editor, each with its own URI.
- **Cursor position does not change the answer.** A cursor on the declaration name and a cursor on any reference to the same symbol return the same list.
- **`includeDeclaration` is honoured.** The declaration's name token is returned only when the client sets `context.includeDeclaration`.
- **Namespace blocks are both declaration and usage.** For a namespace, the name of every `namespace X` block is returned whether or not `includeDeclaration` is set.
- **Go-to-definition on a declaration name returns the declaration itself.** It never returns usages in a definition response; showing usages from there is the client's behaviour. For a namespace block name it returns every block of that namespace.
- **Nothing to answer with means an empty result.** When the project config failed to load with no earlier good state, or the file is not a schema input of the project, the request returns an empty result, through the same checks as the other handlers. A binder always exists for a loaded project.

## Transitional-shape constraints

N/A — single-slice project: one PR carries the binder change, the references handler and the go-to-definition change.

## Project Definition of Done

- [ ] Team-DoD floor items (inherited; see [`drive/calibration/dod.md`](../../drive/calibration/dod.md)).
- [ ] The binder records a `namespace` resolution on the name node of every `namespace` block, covered by a binder unit test with a namespace declared in two blocks.
- [ ] The language server declares `referencesProvider`. Tests cover every row of the table in [At a glance](#at-a-glance), with the files split as shown, once from the declaration name and once from a reference.
- [ ] Tests cover `includeDeclaration` on and off for an entity and a field, and show that a namespace's block names are returned in both cases.
- [ ] Tests cover the discarded candidates: a longer identifier containing the name, the name inside a comment and inside a string, and a same-named field on another model.
- [ ] Tests cover the remaining symbol kinds: a composite type, a named type, a generic block, an enum block, and an entity referenced from an `entityRef` argument in an attribute and in a block value.
- [ ] Tests cover an empty result on an attribute name, a contributed type, a cross-space reference and an unresolved name.
- [ ] Go-to-definition on a declaration's own name returns that declaration's location, and on a namespace block name returns every block. The existing tests asserting `null` there are changed accordingly.
- [ ] Manual check in VS Code: Find All References and Peek References on a model, a field, a namespace and a block, from a declaration and from a reference, with results in more than one file; F12 on a declaration name shows its usages.
- [ ] The language-server README lists find references.

## Open Questions

1. Does `apps/lsp-playground` need client changes to show references that are in another scratch file? Working position: update the playground README to list find references and check it by hand; change client code only if the check fails. Go-to-definition needed an open-editor hook there, so the same hook may already cover it.

## References

- Linear Project: none (skipped by operator).
- Predecessor project: go-to-definition (#30563, #30578).
- ADRs: ADR 249, ADR 255.
- Design discussion: this project's shaping conversation (2026-10-06). Decisions: candidates come from a text search and are confirmed by binder resolution and symbol identity; exact identifier token check; token ranges; no reverse index in the binder; enum member references out of scope; rename is a separate project; go-to-definition on a declaration name returns the declaration itself; every namespace block name is both declaration and usage. Rejected: visiting every token of every file (creates a tree node per element; the text search creates nodes only on the path to each match).
