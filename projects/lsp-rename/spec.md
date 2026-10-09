# lsp-rename — rename symbol for entities, fields and namespaces

## Purpose

Let a schema author rename a model, type, block, field or namespace once and have the declaration and every reference across the project change with it. The set of edited positions is exactly the list find references returns, so a rename never touches a token that go-to-definition would not take to the renamed declaration. A rename that would change a database name also adds `@map` / `@@map` with the old name to the declaration, so the database keeps its names.

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

Three of these renames would change a database name, so the edit also adds a map attribute with the old name to the declaration:

```prisma
// model User → Account                 // field authorId → writerId
namespace auth {                        model Post {
  model Account {                         id       Int       @id
    id    Int    @id                      writerId Int       @map("authorId")
    posts Post[]                          author   auth.User @relation(fields: [writerId], references: [id])

    @@map("User")                         @@index([writerId])
  }                                     }
}
```

| Rename | Map attribute added |
|---|---|
| model `User` → `Account` | `@@map("User")` in `model Account` |
| field `id` of `User` → `uid` | `@map("id")` on the field |
| field `authorId` → `writerId` | `@map("authorId")` on the field |
| field `posts` of `User` → `articles` | none: a relation field has no database name |
| namespace `auth` → `identity` | none: a namespace has no map attribute |

A declaration that already has a map attribute gets none.

`textDocument/prepareRename` answers whether the position can be renamed: the range of the identifier token under the cursor for the symbols above, `null` anywhere else.

The server computes the edit; the client applies it. The server writes no file.

## Non-goals

- **Database names that no map attribute can keep.** A namespace (the schema name on Postgres), a member of a composite type (the stored key) and a block that does not set `nameIsStorageName` (Postgres `role` and `policy_*`) are renamed without a map attribute. The database name changes with the rename and the next migration plan reflects that.
- **A map attribute other than `@map` / `@@map`.** The attribute name is fixed. A block cannot name a different attribute for this purpose.
- **A family-contributed rule for models and fields.** The rule for when a model or field gets a map attribute is written in the language server. Decided by the operator on 2026-10-07, over a function contributed by each family.
- **Collision checks.** Renaming to a name that is already declared, or to one that changes how another reference resolves, is not rejected. The result is reported by the existing diagnostics (`Duplicate declaration of "…"`), and the user undoes the edit. Decided by the operator on 2026-10-07; TypeScript and Prisma 7 do the same (see References).
- **Enum members.** The binder records no resolution for them, so find references does not list them and rename cannot edit them.
- **Symbols with no declaration in the schema sources**: attributes, parameters, functions, constants, contributed types and namespaces, cross-space references. `prepareRename` returns `null` on them.
- **Anything outside the project's schema files**: application code that names a model or field, the emitted contract, migrations.
- **File renames** (`workspace/willRenameFiles`) and **linked editing**.
- **Changes to the binder or to what find references returns**, in slice 1. Slice 2 is a binder change.

## Place in the larger world

- **Find references** (`packages/1-framework/3-tooling/language-server/src/references.ts`, PR #30621). `provideReferences` with `includeDeclaration: true` returns one `Location` per identifier token of the symbol at the cursor, over every schema input of the project. For a namespace it returns every block name. Rename replaces the text of exactly these ranges. This project's branch is based on that PR's branch until it merges.
- **Language server wiring.** `Project.references` and `referencesForDocument` in `server.ts` are the pattern the two new requests follow: same membership checks, same `ProjectArtifacts.documents()` snapshot, same binder.
- **Attribute specs.** The language server already resolves the attribute specs the active family and target contribute (`attribute-spec-resolution.ts`). Both the SQL and the Mongo family define `map` for models and for fields. Rename adds a map attribute only where the resolver finds one at that level.
- **Family interpreters** (SQL and Mongo `contract-psl`). They decide what a map attribute means; three of their rules are restated in the language server (see Cross-cutting requirements):
  - a model with `@@base` and no `@@map` is stored with its base, and adding `@@map` would give it its own table in SQL and is an error in Mongo;
  - a relation field has no database name;
  - a composite type member does not take `@map`.
- **Block descriptors** (`AuthoringPslBlockDescriptor` in `packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts`). The descriptor gains an optional `nameIsStorageName` flag, set by whoever contributes the block: a target or an extension pack. Postgres sets it on `native_enum`, whose block name is the database type name unless `@@map` replaces it.
- **Tokenizer** (`psl-parser/src/tokenizer.ts`). `isPslIdentifier`, exported from `@internal/psl-parser`, decides whether a new name is accepted.
- **Symbol table** (`psl-parser/src/symbol-table.ts`). It already reports duplicate declarations; rename relies on that instead of its own check.
- **Playground** (`apps/lsp-playground`). Its editor sends rename to the language server and applies the returned edit. Scratch files are opened in the editor lazily, on first selection, so an edit can target a file the editor has not opened yet. Rename has to work there too; the playground client is changed if it does not.
- **ADRs**: none new. This project introduces no architectural decision.

### Contract impact

No contract entity, kind, or emitted artifact changes. `AuthoringPslBlockDescriptor` gains the optional `nameIsStorageName` flag; existing descriptors are valid without it. A rename the user applies changes their contract the same way a manual edit of the same text would.

### Adapter impact

The Postgres target sets `nameIsStorageName` on its `native_enum` block descriptor. No other target or adapter changes.

### Failure states

The server edits nothing itself, so a failed request leaves every file as it was.

- A new name that is not a PSL identifier is rejected with an error response before any edit is computed. No edit is returned.
- A position with no renameable symbol, a file that is not a schema input of the project, or a project whose config failed to load with no earlier good state returns `null`. No edit is returned.
- The response is one `WorkspaceEdit` covering all files, or none. The server never returns an edit for part of the usages.
- Applying the edit is the client's operation. If the client fails part-way, the state of the files is the client's failure handling; the server has no part in it.
- An edit computed from a snapshot the user has since changed is the client's to reject or apply. Edits for files that are not open are computed from the text on disk, read the way the symbol table reads it.

## Cross-cutting requirements

- **Name edits equal references.** For any position, the ranges whose text is replaced are the ranges find references returns from that position with `includeDeclaration` set. Rename has no symbol lookup, text search or filtering of its own for them.
- **One token per name edit.** Each of these `TextEdit`s replaces one identifier token with the new name: the last segment of a qualified name for an entity, the qualifier for a namespace.
- **At most one insertion.** Besides the name edits, the edit holds at most one insertion: a map attribute on the renamed declaration, in the declaration's file, whatever position the rename was started from.
- **When a map attribute is added.** The attribute is `@map("<old name>")` on a field and `@@map("<old name>")` on a model or block. It is added when the declaration has no `map` attribute and is one of:
  - a model without `@@base`, when the attribute specs define `map` for models;
  - a field of a model whose type resolves neither to a model nor to a type of another contract space (both are relation fields), when the attribute specs define `map` for fields;
  - a block whose descriptor sets `nameIsStorageName`.
- **A rename to the current name adds nothing.** No database name changes, so no map attribute is added.
- **Nothing else gets one.** A composite type, a composite type member, a named type, an enum block, a namespace, a model with `@@base`, a relation field and a block that does not set `nameIsStorageName` are renamed by name only.
- **Where the attribute goes.** On a field it follows the field's last attribute, or its type when it has none, after one space, before any trailing comment. In a model or block the same text is always inserted before the closing brace: a line break, the indent, `@@map("<old name>")`, a line break. There is no case analysis of what precedes the brace; anything else about the layout (column alignment of field attributes, blank lines) is left to the formatter.
- **Indent and line breaks come from the project's formatter options** (`formatter` in the config: `indent`, `newline`), with the formatter's defaults when unset. They are not read from the file's text.
- **Whole project.** The edit covers every schema input of the project, including files not open in the editor, each under its own URI.
- **Cursor position does not change the answer.** A cursor on the declaration name and a cursor on any reference to the same symbol produce the same edit.
- **`prepareRename` and `rename` agree.** `prepareRename` returns a range exactly when `rename` from the same position would return a non-empty edit for a valid name.
- **Only identifiers are accepted.** A new name for which `isPslIdentifier` is false is an error response with a message naming the rejected text.
- **Nothing to answer with means `null`.** Through the same checks as the other handlers.

## Transitional-shape constraints

Four slices (see `plan.md`). Between them, one gap is known and accepted (found by the QA run of 2026-10-07, decided by the operator the same day):

- An entity name inside a type-constructor argument, such as `OrderStatus` in `status pg.enum(OrderStatus)`, has no binder resolution: the SQL interpreter looks the name up itself. Go-to-definition, find references and rename do not see it. After slice 1, renaming a `native_enum` block edits the block name and adds `@@map`, and leaves `pg.enum(...)` usages unchanged; the schema then reports `PSL_UNKNOWN_ENTITY_REF` until the usages are edited by hand.
- Slice 2 makes the binder record that resolution. Rename needs no change for it: its name edits are the find-references result.

Also observed, not addressed by either slice: with the usage corrected, a renamed `native_enum` with `@@map` keeps its database type name, but the contract's value-set entry is keyed by the block name, so the storage hash changes.

## Project Definition of Done

- [ ] Slice 3: a `pg.enum` column that names a `native_enum` of another namespace emits a contract whose column type and value-set reference point at the enum's namespace, and the Postgres migration plan for it creates the column with the schema-qualified type.
- [ ] Slice 4: a field typed by a named type declared as `pg.enum(X)` emits the same column as `pg.enum(X)` written on the field, apart from the `typeRef`.
- [ ] Slice 2: go-to-definition, find references and rename work from and to an entity name inside a type-constructor argument; renaming a `native_enum` block used in `pg.enum(...)` leaves a schema with no diagnostics.
- [ ] Team-DoD floor items (inherited; see [`drive/calibration/dod.md`](../../drive/calibration/dod.md)).
- [ ] The language server declares `renameProvider`, with `prepareProvider` when the client declares `prepareSupport`.
- [ ] Tests cover every row of the table in [At a glance](#at-a-glance), with the files split as shown, once from the declaration name and once from a reference.
- [ ] Tests cover the remaining symbol kinds: a composite type, a named type, a generic block and an enum block.
- [ ] Tests cover the map attribute, each from the declaration name and from a reference in another file:
  - added for a model, a scalar field, a list of scalars, a field typed by an enum, a field typed by a composite type, and a block that sets `nameIsStorageName`;
  - not added for a model, field or block that already has one, a model with `@@base`, a relation field in both directions, a composite type member, a composite type, an enum block, a named type, a namespace, a block that does not set `nameIsStorageName`, and a model or field when the attribute specs define no `map`.
- [ ] Tests cover the position of the inserted text: a field with no attribute, with attributes, and with a trailing comment; a model whose last member is a field, a model inside a namespace, and a project whose formatter options set a tab indent and CRLF. For a model whose last member is a field, formatting the edited file leaves the `@@map` line and the lines around it unchanged.
- [ ] After a rename with a map attribute is applied, the contract the SQL interpreter emits has the same storage names as before the rename, covered by a test for a model and a field. The same for the Mongo interpreter.
- [ ] The Postgres `native_enum` descriptor sets `nameIsStorageName`, and renaming a `native_enum` block adds `@@map`.
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
- Map attribute on rename, decided by the operator on 2026-10-07, reversing the names-only decision of 2026-10-06: every rename that affects a database name gets `@map` / `@@map` with the old name unless the declaration has one; the rule for models and fields is written in the language server; blocks opt in with a flag; the attribute is always `map`.
- Prisma 7 rename, for comparison: `prisma/language-tools`, `packages/language-server/src/lib/code-actions/rename.ts`.
