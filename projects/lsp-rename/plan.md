# lsp-rename — Plan

**Spec:** `projects/lsp-rename/spec.md`
**Linear Project:** none (as for lsp-find-references)

## At a glance

The project is two slices, each one PR. Slice 2 was added on 2026-10-07 after QA found that a `native_enum` rename misses its `pg.enum(...)` usages. Slice 1 adds `textDocument/prepareRename` and `textDocument/rename` to the language server, built on the find-references provider, and makes rename work in `apps/lsp-playground`.

## Composition

### Stack (deliver in order)

1. **Slice `rename`**. Linear: none. Folder: `projects/lsp-rename/slices/rename/`
   - **Outcome:**
     - The language server declares `renameProvider` and answers `textDocument/rename` with one `WorkspaceEdit` for models, composite types, named types, blocks (including enum blocks), fields and namespaces, from a declaration name or from a reference, across every schema file of the project.
     - `textDocument/prepareRename` returns the identifier's range on those symbols and `null` everywhere else.
     - A new name that is not a PSL identifier is refused with an error response.
     - Rename in `apps/lsp-playground` changes every scratch file that uses the symbol, including files never selected in the sidebar.
   - **Builds on:** PR #30621 (branch `find-usage`): `provideReferences`, `ProjectArtifacts.documents()` and the `namespace` resolution on namespace block names.
   - **Hands to:** Project close-out.
   - **Focus:**
     - a new `rename.ts` provider that maps the find-references result to text edits, with the new-name check;
     - `Project.prepareRename` and `Project.rename`, with the membership checks `Project.references` has;
     - the `renameProvider` capability, `prepareSupport` detection and the two handlers in `server.ts`, including how the refused-name error reaches the client;
     - tests for every item in the spec's Definition of Done;
     - the playground: a hand check of a multi-file rename, and a client change if the editor does not apply the edit to every scratch file;
     - one statement in the language-server README and one in the playground README that rename is supported;
     - the manual QA script and run, with the VS Code and playground checks as operator steps.

2. **Slice `type-constructor-refs`**. Linear: none. Folder: `projects/lsp-rename/slices/type-constructor-refs/` (spec not written yet)
   - **Outcome:**
     - The binder records a resolution for an entity name inside a type-constructor argument (`OrderStatus` in `pg.enum(OrderStatus)`).
     - Go-to-definition, hover, find references and rename work on such a name with no change of their own.
     - Renaming a `native_enum` block used in `pg.enum(...)` leaves a schema with no diagnostics.
   - **Builds on:** Slice 1 merged (PR #30633).
   - **Hands to:** Project close-out.
   - **Focus:**
     - how type-constructor arguments are described to the binder, so it binds them the way it binds `entityRef` attribute arguments;
     - whether the SQL interpreter then reads the binder's resolution instead of looking the name up (`psl-column-resolution.ts`, `PSL_UNKNOWN_ENTITY_REF`);
     - a design discussion with the operator before the spec: the binder rules are the operator's.

## Dependencies (external)

- **PR #30621 (find references)** is open. The slice branch is based on `find-usage` and its PR targets that branch. After #30621 squash-merges, the slice branch is rebased onto `origin/main` and the PR is retargeted to `main`.
- No package release is named: the language server reaches users with the next regular release of the CLI package, as find references does.

## Sequencing rationale

- **Why slice 2 is separate.** The gap is in the binder, predates this project, and affects go-to-definition and find references as much as rename. The rename PR is correct for every usage the binder resolves, and the binder change needs its own design.
- **Why slice 1 is one PR.** The provider is a mapping from the find-references result to edits and has no use without the handlers and the capability. The playground change, if one is needed, is small and is what lets the feature be tried by hand; a separate PR for it would leave the first PR merged with rename not working in the playground.
- **Why stacked on #30621 instead of waiting.** Find references is complete and under review; rename does not change any file that PR touches except `project.ts` and `server.ts`, where it adds next to the references code.
