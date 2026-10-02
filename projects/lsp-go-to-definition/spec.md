# lsp-go-to-definition — go-to-definition for entities and fields

## Purpose

Let a schema author jump from any reference to an entity or a field to the place it is declared, using the same name resolution the interpreter uses. Navigation and diagnostics must give the same answer for the same reference, so the editor never jumps to a declaration that a diagnostic says the reference does not name.

## At a glance

Given this project (the two `namespace auth` blocks may be in the same file or in different files):

```prisma
namespace auth {
  model User {
    id    Int    @id
    posts Post[]
  }
}

namespace auth {
  model Session { id Int @id }
}

model Post {
  id       Int       @id
  authorId Int
  author   auth.User @relation(fields: [authorId], references: [id])

  @@index([authorId])
}
```

`textDocument/definition` answers:

| Cursor on | Binder resolution | Target |
|---|---|---|
| `User` in `auth.User` | `model` | `model User` |
| `auth` in `auth.User` | `namespace` (new, recorded on the qualifier node) | both `namespace auth { … }` blocks |
| `Post` in `Post[]` | `model` | `model Post` |
| `authorId` in `fields: [authorId]` | `field` (`fieldRef`) | `authorId Int` |
| `id` in `references: [id]` | `field` (`referencedFieldRef`) | `id Int @id` in `User` |
| `authorId` in `@@index([authorId])` | `field` (`fieldRef`) | `authorId Int` |
| an `entityRef` argument in an attribute or a block value | `model` / `compositeType` / `block` / … | that declaration |
| `User` in `model User {` | declaration, not a reference | `null` |
| `pgvector.Vector`, `supabase:auth.User`, `@relation`, unresolved names | `contributed*` / `crossSpace` / `attribute` / `unresolved` | `null` |

The server finds the target in two steps. It walks up from the token under the cursor to the nearest node that has a resolution in `binder.symbolForNode`, then maps the resolved symbol to its declaration nodes. It returns `LocationLink[]`: `originSelectionRange` is the reference node, `targetRange` is the whole declaration, and `targetSelectionRange` is the declaration's name. Clients that do not declare `textDocument.definition.linkSupport` get `Location[]` with the name range.

This requires the language server to hold a binder. Today each family interpreter builds its own binder inside `interpret()` (`createSqlBinder`, `createMongoBinder`) and discards it. After this project:

```
before:  provider.load()      -> buildSymbolTable -> interpret({ documents, sources, symbolTable })
                                                      └─ createSqlBinder(...)  (family wrapper)
         ProjectArtifacts     -> buildSymbolTable -> interpret({ documents, sources, symbolTable })
                                                      └─ createSqlBinder(...)

after:   provider.load()      -> buildSymbolTable -> <framework binder factory>(symbolTable, sources, context)
                                                  -> interpret({ documents, sources, symbolTable, binder })
         ProjectArtifacts     -> buildSymbolTable -> <framework binder factory>(symbolTable, sources, context)
                                                  -> interpret({ …, binder })  and  textDocument/definition
```

The binder is built by the caller, next to the symbol table, following the pattern `PslInterpretInput.symbolTable` already uses. The language server builds one binder per project snapshot and uses it for both interpretation and navigation.

## Non-goals

- **Find references, hover, rename, document highlight.** Find references is the planned follow-up. It is also where a cursor on a declaration's own name will start returning something.
- **Targets outside the schema sources.** Contributed types and namespaces (extension packs, scalars), cross-contract-space references, and attribute names have no PSL declaration. They return `null`.
- **Enum member references** (e.g. `@default(ACTIVE)`) and any other reference the binder does not record today. This project adds only the qualifier resolution to the binder.
- **`fieldRef` inside block values.** A block value has no owning model, so the binder records nothing there and navigation returns `null`. That matches current binder behaviour.
- **The Prisma 7 interpreter** (`contract-prisma7`). It has no binder. It instantiates the type constructors its native-type table maps to directly, without the PSL field-type path.
- **Changes to what the binder resolves** beyond the qualifier. Scoping rules stay as defined by the symbol-table-resolve project.

## Place in the larger world

- **Binder** (`packages/1-framework/2-authoring/psl-parser/src/binder.ts`, `scope.ts`). It provides `declaredSymbol(node)` and `symbolForNode(node)`. Type references are recorded on the `QualifiedName` node, and `entityRef` / `fieldRef` / `referencedFieldRef` are recorded on the argument's identifier node, in attributes and in block values. `NamespaceSymbol.declarations[]` lists every block that contributes to a namespace.
- **`PslInterpretInput` / `PslInterpretCapable`** (`psl-parser/src/interpret.ts`). `PslInterpretInput` gains `binder`. `PslInterpretCapable` itself does not change.
- **Family providers and interpreters**: `packages/2-sql/2-authoring/contract-psl` and `packages/2-mongo-family/2-authoring/contract-psl`. `provider.load()` builds the binder, and the interpreters receive it instead of building it. `createSqlBinder` and `createMongoBinder` are removed.
- **Family descriptor and `ContractSourceContext`** (`framework-components` `control-descriptors.ts`, `@internal/config` `contract-source-types.ts`). Both gain `pslDiagnostics` (`describeUnsupportedAttribute`, `describeUnresolvedType`), type-erased. The SQL and Mongo family descriptors set it; the CLI and language server copy it from `stack.family` into the context.
- **Language server**: `packages/1-framework/3-tooling/language-server`. `ProjectArtifacts` caches the binder next to `#symbolTableResult` and invalidates it at the same points. The binder's inputs come from `ProjectInterpretation.context` (`ContractSourceContext`: `authoringContributions`, `codecLookup`, `dataTypeLookup`, `controlMutationDefaults`) plus the symbol table and sources. Without a `ProjectInterpretation` there is no binder, and go-to-definition returns `null`.
- **ADRs**: ADR 255 (block specs bind top-level block values; block references resolve through the snapshot binder), ADR 231 (declarative attribute specifications), ADR 249 (central attribute-spec registry).
- **Sibling project**: `projects/symbol-table-resolve` (introduced the binder).

### Contract impact

None. No contract entity, kind, or emitted artifact changes.

### Adapter impact

None.

## Cross-cutting requirements

- **One way to build a binder.** The CLI path (`provider.load()`) and the language server call the same framework function with the same kinds of inputs. No family-specific binder construction remains.
- **Interpretation output does not change, except for the removed guess.** For every schema, the emitted contract and the diagnostics (codes, messages, ranges) are identical before and after the binder moves out of `interpret`. The only diagnostics that change are the ones listed under "No guessing about extension packs", "Unknown type names get one diagnostic, from the binder", and "Interpreters never look up names" below.
- **Interpreters never look up names.** The binder only binds identifiers to symbols; the SQL and Mongo interpreters take field types, enum members and the discriminator's type from binder resolutions, never by looking up a name written in the schema. Validation stays in the interpreters: a field preset written without a call reports `PSL_PRESET_NOT_CALLED`; a type constructor that needs arguments, written bare, reports `PSL_TYPE_CONSTRUCTOR_NOT_CALLED`; a resolved name SQL cannot store gets a specific `PSL_UNSUPPORTED_FIELD_TYPE` message. The discriminator check accepts a named type based on `String`. A named type's base resolves in a scope without the named types. Cross-space references are out of scope.
- **No guessing about extension packs.** `checkUncomposedNamespace` and `PSL_EXTENSION_NAMESPACE_NOT_COMPOSED` are removed from every call site (SQL type constructors, named types, relations, field and model attributes, Mongo field presets). The check treated any unrecognised prefix before `.` as an extension pack missing from `prisma.config.ts`, without knowing whether such a pack exists or whether the prefix is a namespace declared in the schema. A name that doesn't resolve gets the diagnostic for what it is: `Cannot find type "X.Y"` from the binder for type references, `PSL_UNSUPPORTED_MODEL_ATTRIBUTE` / `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` for attributes, and the existing unknown-name diagnostic of each other call site.
- **No filtering of binder diagnostics.** Every diagnostic the binder produces is reported. Both filters from #30349 are deleted: SQL's `voicedAsUncomposedNamespace` and Mongo's `binderDiagnostics.filter((d) => d.data?.['reference'] !== 'type')`.
- **Unknown type names get one diagnostic, from the binder.** An interpreter's own unsupported-type diagnostic (Mongo's `PSL_UNSUPPORTED_FIELD_TYPE` in `resolveNonRelationField`, and SQL's equivalents for field types and type constructors) is reported only when `binder.symbolForNode(typeNode)` resolved. When the reference is `unresolved`, the binder's `Cannot find type` is the only diagnostic. References that resolve but that the family cannot store (e.g. a `types {}` binding in Mongo) keep the family's unsupported-type diagnostic.
- **Diagnostic wording comes from the family descriptor.** `describeUnsupportedAttribute` and `describeUnresolvedType` live on the family descriptor's `pslDiagnostics` and reach the binder through `ContractSourceContext.pslDiagnostics`. A stack has exactly one family, so no single-contributor check is needed, and the CLI and the language server produce the same diagnostics without either knowing the family.
- **Binder diagnostics are reported by the caller.** Like symbol-table diagnostics, the caller that builds the binder adds the binder's diagnostics through `withSeedDiagnostics` (CLI) or the language server's diagnostic list. Interpreters do not report them.
- **One binder per language-server snapshot.** Interpretation and navigation in the language server read the same binder instance, so a reference resolves the same way in both.
- **The binder gets the same type constructors as today.** The framework function derives the scalar column descriptors and field presets that `createSqlBinder` adds to `typeConstructors` from `ContractSourceContext`.
- **Tests that call `interpret` directly use one helper per family.** About 77 files call `interpret(...)` or `interpretPslDocumentTo{Sql,Mongo}Contract(...)` directly. Each family package's test utilities gain one helper that builds the symbol table and binder from source text, and those tests switch to it.
- **Qualifier resolution lives in the binder.** The language server does not inspect `QualifiedName` segments itself. It only walks up from the cursor and reads `symbolForNode`.
- **Definitions in other files.** A target in a different schema file of the same project returns that file's URI, taken from `sources.sourceFileFor(node)`.

## Transitional-shape constraints

- Delivered as two PRs. PR 1 moves binder construction out of `interpret` and removes the extension-pack guess; its only user-visible change is the diagnostics listed under "No guessing about extension packs" and "Unknown type names get one diagnostic, from the binder". PR 2 adds the qualifier resolution and `textDocument/definition`, and builds on PR 1.
- PR 1 merges independently: `fixtures:check` and every existing interpreter and diagnostics test pass. The only edited test expectations are those asserting `PSL_EXTENSION_NAMESPACE_NOT_COMPOSED`, depending on either filter, or asserting an unsupported-type diagnostic for an unknown name. Each edit replaces the old diagnostic with the one the requirements above name.

## Project Definition of Done

- [ ] Team-DoD floor items (inherited; see [`drive/calibration/dod.md`](../../drive/calibration/dod.md)).
- [ ] `PslInterpretInput` carries `binder`. Neither family interpreter constructs a binder, and `createSqlBinder` / `createMongoBinder` no longer exist.
- [ ] Both family providers and `ProjectArtifacts` build the binder through the same framework function.
- [ ] `checkUncomposedNamespace`, `uncomposedNamespaceDiagnostic`, `reportUncomposedNamespace`, `PSL_EXTENSION_NAMESPACE_NOT_COMPOSED` and `voicedAsUncomposedNamespace` no longer exist.
- [ ] `describeUnsupportedAttribute` is contributed by the SQL and Mongo family descriptors, and the language server shows the same unsupported-attribute diagnostics as the CLI for the same schema.
- [ ] The binder records a `namespace` resolution on the qualifier identifier of a qualified type reference, covered by a binder unit test that includes a namespace declared in two blocks.
- [ ] The language server declares `definitionProvider`. Tests cover every row of the table in [At a glance](#at-a-glance), including a merged namespace across two files returning one link per block and a target in another file.
- [ ] Tests cover both response shapes: `LocationLink[]` when the client declares `linkSupport`, and `Location[]` otherwise.
- [ ] Manual check in VS Code: go-to-definition and peek definition work on a type reference, a qualifier, an `@relation` `fields` / `references` entry, and an `@@index` entry.
- [ ] Language-server README lists go-to-definition among supported features.
- [ ] ADR recording that the binder is built by the caller and passed to `interpret` (new ADR or an amendment to ADR 255, decided at close-out).

## Open Questions

None.

## References

- Linear Project: none (skipped by operator).
- Sibling projects: [`projects/symbol-table-resolve`](../symbol-table-resolve/spec.md).
- ADRs: ADR 231, ADR 249, ADR 255.
- Design discussion: this project's shaping conversation (2026-09-30). Decisions: binder built by the caller and passed to `interpret`; qualifier resolved in the binder; `LocationLink` with `Location` fallback; `null` on a declaration's own name; two PRs; `describeUnsupportedAttribute` moves to the family control stack; the extension-pack guess and the SQL binder-diagnostic filter are removed (the filter came from #30349 and was not recorded in its design decisions).
