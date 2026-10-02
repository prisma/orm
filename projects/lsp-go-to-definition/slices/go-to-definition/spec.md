# Slice: go-to-definition

Parent project: [`projects/lsp-go-to-definition/`](../../spec.md). Builds on #30563 (the binder is built by the caller; `ProjectArtifacts.binder()` serves the current snapshot).

## At a glance

The language server answers `textDocument/definition` for references to entities and fields, using the binder: the server walks up from the token under the cursor to the nearest node `binder.symbolForNode` resolves, then maps the resolved symbol to its declaration node(s). The binder additionally records a `namespace` resolution on the qualifier identifier of a qualified type reference, so the cursor on `auth` in `auth.User` reaches every `namespace auth { … }` block.

## Chosen design

### Binder: qualifier resolution (binding only)

For a qualified type reference `ns.Name`, the binder keeps the resolution it records on the whole `QualifiedName` node and additionally records `{ kind: 'namespace', symbol }` on the qualifier `IdentifierAst` node when `ns` resolves to a user namespace (`contributedNamespace` for a contributed one). No new diagnostics. The README's "Qualified references resolve at whole-`QualifiedName` granularity" paragraph is updated to say the qualifier segment carries its own resolution.

### Language server: `textDocument/definition`

- `definitionProvider: true` in the server capabilities.
- Find the token at the cursor offset (`tokenAtOffset`), walk up its ancestors to the first node with `binder.symbolForNode(node) !== undefined`.
- Map the resolution to targets:

| Resolution | Targets |
|---|---|
| `model`, `compositeType`, `namedType`, `block`, `field` | the symbol's declaration node |
| `namespace` | one per entry in `NamespaceSymbol.declarations` |
| `contributedType`, `contributedNamespace`, `crossSpace`, `attribute`, `unresolved` | none → `null` |

- A cursor on a declaration's own name (`binder.declaredSymbol`) returns `null`.
- Response: `LocationLink[]` when the client declares `textDocument.definition.linkSupport` (`originSelectionRange` = the reference node, `targetRange` = whole declaration, `targetSelectionRange` = declaration name); otherwise `Location[]` with the name range. The capability is read in `resolveClientCapabilities` like the others.
- Targets in another file of the project use that file's URI (`sources.sourceFileFor(node)`).
- No binder (project without a PSL interpretation and without a control stack) → `null`.

## Coverage (tests)

Every row of the project spec's table, with this schema shape (namespace split across two files):

```prisma
namespace auth { model User { id Int @id  posts Post[] } }
namespace auth { model Session { id Int @id } }
model Post {
  id Int @id
  authorId Int
  author auth.User @relation(fields: [authorId], references: [id])
  @@index([authorId])
}
```

- type position (`Post`, `auth.User` on `User`), qualifier (`auth` → both blocks, across two files), `fields:` / `references:` / `@@index` field refs, an `entityRef` argument in an attribute and in a block value, a named type, an enum block;
- `null` for a declaration name, a contributed type, a cross-space reference, an attribute name, an unresolved name;
- `LocationLink[]` vs `Location[]` by client capability.

## Out of scope

Find references, hover, rename; cross-space targets; enum member references (`@default(ACTIVE)`); `fieldRef` inside block values.

## Done when

- The coverage tests pass; the language-server README lists go-to-definition.
- Manual check in VS Code: definition and peek on a type reference, a qualifier, an `@relation` `fields`/`references` entry, and an `@@index` entry.
