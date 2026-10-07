# Slice: rename

Parent project: [`projects/lsp-rename/`](../../spec.md). The project is this one slice; the project spec holds the behaviour table, the non-goals, the failure states and the requirements. This file adds the design choices the project spec leaves to the slice.

## At a glance

One PR: the language server answers `textDocument/prepareRename` and `textDocument/rename` by turning the find-references result into text edits, and adds a map attribute with the old name where the rename would change a database name.

## Chosen design

### Rename provider (`language-server/src/rename.ts`)

Two pure functions next to `provideReferences`. Both take the input `provideReferences` takes, without `includeDeclaration`.

```ts
function providePrepareRename(input): { range: Range; placeholder: string } | null
function provideRename(input & { newName: string }): WorkspaceEdit | null
```

- **`provideRename`** calls `provideReferences` with `includeDeclaration: true`. An empty list returns `null`. Otherwise it returns `{ changes }`, where `changes[uri]` holds one `TextEdit { range, newText: newName }` per location of that URI. It does no lookup of its own.
- **`providePrepareRename`** returns `null` when `provideReferences` with `includeDeclaration: true` returns nothing. Otherwise it returns the range and text of the identifier token `identTokenAt` picks at the cursor. That range is always one of the returned locations, because the token under the cursor resolves to the symbol being renamed.
- **New name check.** `provideRename` rejects a `newName` for which `isPslIdentifier` is false before calling `provideReferences`. The rejection reaches the client as a `ResponseError` with code `RequestFailed` and a message that quotes the rejected text.

### Map attribute (`language-server/src/rename.ts`, amended 2026-10-07)

After the name edits, `provideRename` asks one function for the insertion, given the renamed symbol, the binder and the attribute-spec resolver for the declaration's source:

```ts
function mapAttributeEdit(symbol, ...): { uri: string; edit: TextEdit } | undefined
```

- **Model** (`symbol.kind === 'model'`): insert when the resolver has a model-level `map`, and the model has neither a `map` nor a `base` attribute.
- **Field** (`symbol.kind === 'field'`): insert when the owner is a model, the resolver has a field-level `map`, the field has no `map` attribute, and the binder's resolution of the field's type is not a model.
- **Block** (`symbol.kind === 'block'`): insert when the block's descriptor in `pslBlockDescriptors` has `mappable: true` and the block has no `map` attribute.
- **Anything else**: no insertion.

The attribute names `map` and `base` are written in this function. No keyword of a target block is.

Text and position:

- Field: ` @map("<old>")`, one space and the attribute, inserted at the end of the field node, which is after the last attribute (or the type) and before a trailing comment. No column alignment: the rename changes name widths, so alignment is the formatter's to redo.
- Model or block: a line `@@map("<old>")` at the indent of the block's members, inserted before the line of the closing brace. When the last member is a field, a blank line precedes it; when the block already has `@@` attributes, it follows them with no blank line. This is the layout the formatter produces, so formatting leaves these lines unchanged.
- The old name is an identifier, so it needs no escaping.
- The indent is taken from the block's existing members, not from formatter options.

The insertion is added to `changes` under the URI of the declaration's file, next to the name edits of that file. It does not overlap any of them: the name edit replaces the name token and the insertion is after the attributes or before the closing brace.

### Block descriptor flag

`AuthoringPslBlockDescriptor` gains `readonly mappable?: boolean`, documented as: the block's name is the name of the storage object it declares, and the block attribute `map` replaces that name. The Postgres target sets it on `native_enum`. `policy_*` and `role` do not set it.

`WorkspaceEdit.changes` is used, not `documentChanges`: the edit has no file operations and the server does not track versions for files that are not open.

### Wiring

- `Project.prepareRename(uri, position)` and `Project.rename(uri, position, newName)` follow `Project.references`: same member checks, same `documents()` list and binder, `null` when there is nothing to answer with. The invalid-name error is the one failure that is not turned into `null`.
- `server.ts`:
  - `ResolvedClientCapabilities` gains `renamePrepareSupport` from `textDocument.rename.prepareSupport`.
  - The server declares `renameProvider: { prepareProvider: true }` when the client has `prepareSupport`, and `renameProvider: true` otherwise.
  - `onPrepareRename` and `onRenameRequest` are registered next to `onReferences`, with the open-document check the other handlers have.
  - The invalid-name `ResponseError` must reach the client as an error response. The implementer checks how `guarded-connection.ts` treats a thrown `ResponseError` and keeps that behaviour for every other handler.

### Playground (`apps/lsp-playground`)

Rename has to work in the playground for a symbol used in several scratch files, including files never selected in the sidebar. The implementer first runs it by hand. If the editor does not apply the edit to every file, `src/client/main.ts` is changed so that it does, in the way the open-editor hook was added for cross-file go-to-definition.

### Documentation

The language-server README and `apps/lsp-playground/README.md` each state that rename is supported, where they list the other features. No description of how it works, what it checks or what it leaves out.

## Coherence rationale

The provider is a mapping from the find-references result to edits, and it has no use without the two handlers and the capability. A reviewer reads one new file of about the size of `references.ts`, two `Project` methods and the handler registration. A playground client change, if one is needed, is what makes the feature usable where it is tried out by hand.

## Scope

**In (amendment 2026-10-07):** the map-attribute function in `src/rename.ts` and its inputs through `Project.rename`; the `mappable` flag in `framework-components` and on the Postgres `native_enum` descriptor; tests in the language server, one interpreter test each in SQL and Mongo `contract-psl` for unchanged storage names, one in the Postgres target for the flag.

**In:** `src/rename.ts`, `Project.prepareRename` / `Project.rename`, the two handlers and the capability in `server.ts`, `test/rename.test.ts`, the capability and handler tests in `test/server.test.ts`, the two READMEs, `apps/lsp-playground/src/client/main.ts` if the playground does not apply the edit to every file, the manual-QA script and run.

**Out:** Everything in the project spec's non-goals. `references.ts`, `cursor-resolution.ts` and the binder are not changed.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| New name equals the current name | Returned as an ordinary edit | Every edit replaces a token with the same text; no special case |
| Rename started from a reference in another file | The map attribute is inserted in the declaration's file | One insertion, on the declaration |
| Model renamed a second time (`User` → `Account` → `Member`) | No second attribute; `@@map("User")` stays | "Unless it already has one" |
| Model renamed back to its old name | `@@map("User")` stays on `model User` | It is redundant and harmless; removing it is not rename's job |
| Model with `@@base` and no `@@map` | No attribute | It is stored with its base; `@@map` would move it to its own table in SQL and is an error in Mongo |
| Base model (named by another model's `@@base`) | Attribute added | Its name is the table name |
| Field whose type does not resolve | Attribute added | Only a type that resolves to a model marks a relation field |
| Field with attributes and a trailing `//` comment | Attribute goes before the comment | End of the field node |
| Collision (new name already declared) together with a map attribute | Both edits are returned as usual | No collision check |
| New name is already declared in the same scope | Applied | Non-goal: the symbol table's duplicate-declaration diagnostic reports it |
| Model and namespace with the same name (`auth.auth`) | Only the tokens of the symbol at the cursor are edited | Follows from find references |
| Namespace declared in two blocks in two files | Both block names are edited | Find references returns every block name for a namespace |
| A usage in a file that is not open | Edited, under the file's URI, from the text on disk | `ProjectArtifacts.documents()` |
| `-` in the new name (`user-profile`) | Accepted | `isPslIdentifier` allows it |
| `NaN`, `Infinity`, a name starting with a digit, an empty string, a name with a `.` | Rejected with the error response | `isPslIdentifier` is false for each |
| Client without `prepareSupport` | `renameProvider: true`; `rename` alone decides | LSP requires the options form only for clients that declare `prepareSupport` |

## Slice-specific done conditions

- [ ] Every test condition of the project spec's Definition of Done passes, plus a test per row of the edge-case table above.
- [ ] The find-references tests pass unchanged, and `git diff` against the base branch shows no change to `references.ts`, `cursor-resolution.ts` or `binder.ts`.
- [ ] The QA script and run cover the map attribute: applied edits for a model, a field and a `native_enum` block, with the contract emitted before and after compared for storage names.
- [ ] The PR description states the map behaviour and no longer says names only.
- [ ] A `drive-qa-plan` script and one `drive-qa-run` report exist, driving the language server over stdio as the find-references QA driver does. The VS Code check and the playground check from the project spec are listed in the script as steps for the operator.
- [ ] The PR targets `find-usage` while #30621 is open, and is rebased onto `main` after it merges.

## Open Questions

None.

## References

- Parent project: `projects/lsp-rename/spec.md`
- Linear issue: none
- Base: PR #30621, branch `find-usage`
