# lsp-rename — rename symbol for entities, fields and namespaces

## Purpose

Let a schema author rename a model, type, block, field or namespace once and have the declaration and every reference across the project change with it. The set of edited positions is exactly the list find references returns, so a rename never touches a token that go-to-definition would not take to the renamed declaration.

## At a glance

Given the three-file project of the find-references spec:

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

`textDocument/rename` returns one `WorkspaceEdit`. The answer is the same for a cursor on the declaration name and for a cursor on any reference:

| Rename | Edits |
|---|---|
| model `User` → `Account` | `model User` (auth.prisma), `user User` (session.prisma), `auth.User` (post.prisma): the `User` token becomes `Account` in each |
| field `id` of `User` → `uid` | `id Int @id` in `User`, `references: [id]` in session.prisma and in post.prisma. `Session.id` and `Post.id` are untouched |
| field `authorId` → `writerId` | `authorId Int`, `fields: [authorId]`, `@@index([authorId])` |
| namespace `auth` → `identity` | the name of both `namespace auth` blocks, and `auth` in `auth.User` |

`textDocument/prepareRename` answers whether the position can be renamed: the range of the identifier token under the cursor for the symbols above, `null` anywhere else.

The server computes the edit; the client applies it. The server writes no file.

## Non-goals

- **Keeping the storage name.** Rename edits names only. It does not add `@map` / `@@map`, which Prisma 7's language server does. A model or field without an explicit mapping gets a different storage name after the rename, and the next migration plan reflects that. Decided by the operator on 2026-10-06; `@map` is a SQL-family attribute and the language server is framework-level.
- **Collision checks.** Renaming to a name that is already declared, or to one that changes how another reference resolves, is not rejected. The result is reported by the existing diagnostics (`Duplicate declaration of "…"`), and the user undoes the edit. Decided by the operator on 2026-10-07; TypeScript and Prisma 7 do the same (see References).
- **Enum members.** The binder records no resolution for them, so find references does not list them and rename cannot edit them.
- **Symbols with no declaration in the schema sources**: attributes, parameters, functions, constants, contributed types and namespaces, cross-space references. `prepareRename` returns `null` on them.
- **Anything outside the project's schema files**: application code that names a model or field, the emitted contract, migrations.
- **File renames** (`workspace/willRenameFiles`) and **linked editing**.
- **Changes to the binder or to what find references returns.**

## Place in the larger world

- **Find references** (`packages/1-framework/3-tooling/language-server/src/references.ts`, PR #30621). `provideReferences` with `includeDeclaration: true` returns one `Location` per identifier token of the symbol at the cursor, over every schema input of the project. For a namespace it returns every block name. Rename replaces the text of exactly these ranges. This project's branch is based on that PR's branch until it merges.
- **Language server wiring.** `Project.references` and `referencesForDocument` in `server.ts` are the pattern the two new requests follow: same membership checks, same `ProjectArtifacts.documents()` snapshot, same binder.
- **Tokenizer** (`psl-parser/src/tokenizer.ts`). `isPslIdentifier`, exported from `@internal/psl-parser`, decides whether a new name is accepted.
- **Symbol table** (`psl-parser/src/symbol-table.ts`). It already reports duplicate declarations; rename relies on that instead of its own check.
- **Playground** (`apps/lsp-playground`). Its editor sends rename to the language server and applies the returned edit. Scratch files are opened in the editor lazily, on first selection, so an edit can target a file the editor has not opened yet. Rename has to work there too; the playground client is changed if it does not.
- **ADRs**: none new. This project introduces no architectural decision.

### Contract impact

None. No contract entity, kind, or emitted artifact changes. A rename the user applies changes their contract the same way a manual edit of the same names would.

### Adapter impact

None.

### Failure states

The server edits nothing itself, so a failed request leaves every file as it was.

- A new name that is not a PSL identifier is rejected with an error response before any edit is computed. No edit is returned.
- A position with no renameable symbol, a file that is not a schema input of the project, or a project whose config failed to load with no earlier good state returns `null`. No edit is returned.
- The response is one `WorkspaceEdit` covering all files, or none. The server never returns an edit for part of the usages.
- Applying the edit is the client's operation. If the client fails part-way, the state of the files is the client's failure handling; the server has no part in it.
- An edit computed from a snapshot the user has since changed is the client's to reject or apply. Edits for files that are not open are computed from the text on disk, read the way the symbol table reads it.

## Cross-cutting requirements

- **Edits equal references.** For any position, the ranges in the rename edit are the ranges find references returns from that position with `includeDeclaration` set. Rename has no symbol lookup, text search or filtering of its own.
- **One token per edit.** Each `TextEdit` replaces one identifier token with the new name: the last segment of a qualified name for an entity, the qualifier for a namespace.
- **Whole project.** The edit covers every schema input of the project, including files not open in the editor, each under its own URI.
- **Cursor position does not change the answer.** A cursor on the declaration name and a cursor on any reference to the same symbol produce the same edit.
- **`prepareRename` and `rename` agree.** `prepareRename` returns a range exactly when `rename` from the same position would return a non-empty edit for a valid name.
- **Only identifiers are accepted.** A new name for which `isPslIdentifier` is false is an error response with a message naming the rejected text.
- **Nothing to answer with means `null`.** Through the same checks as the other handlers.

## Transitional-shape constraints

N/A — single-slice project.

## Project Definition of Done

- [ ] Team-DoD floor items (inherited; see [`drive/calibration/dod.md`](../../drive/calibration/dod.md)).
- [ ] The language server declares `renameProvider`, with `prepareProvider` when the client declares `prepareSupport`.
- [ ] Tests cover every row of the table in [At a glance](#at-a-glance), with the files split as shown, once from the declaration name and once from a reference.
- [ ] Tests cover the remaining symbol kinds: a composite type, a named type, a generic block and an enum block.
- [ ] Tests cover `prepareRename`: a range on each renameable kind, `null` on an attribute name, a contributed type, a cross-space reference, an unresolved name and a position with no identifier.
- [ ] Tests cover a rejected new name (not an identifier).
- [ ] Manual check in VS Code: F2 on a model, a field, a namespace and a block, from a declaration and from a reference, with edits in more than one file including one that is not open; F2 on an attribute name is refused.
- [ ] Rename works in `apps/lsp-playground`: renaming a symbol used in more than one scratch file changes every file, including one never selected in the sidebar.
- [ ] The language-server README and the playground README state that rename is supported, and nothing more.

## Open Questions

None.

## References

- Linear Project: none.
- Predecessor: find references, PR #30621 (`projects/lsp-find-references/`), whose spec names rename as the project built on it.
- Collision handling in other servers, read from source on 2026-10-06. No check: TypeScript v5.9.2 (`src/services/rename.ts`; `findRenameLocations` in `services.ts` never receives the new name), Prisma 7 (`handleRenameRequest` in `prisma/language-tools`), rust-analyzer (applies the rename; for local variables only, marks the edit as needing confirmation). Reject a conflict with a sibling declaration: gopls (`rename_check.go`), clangd (`Rename.cpp`, `checkName`).
- Prisma 7 rename, for comparison: `prisma/language-tools`, `packages/language-server/src/lib/code-actions/rename.ts`.
