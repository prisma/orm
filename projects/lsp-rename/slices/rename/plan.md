## Dispatch plan

Slice spec: `projects/lsp-rename/slices/rename/spec.md`

Review: one reviewer round after Dispatch 2, covering both code dispatches. Dispatch 3 produces QA artefacts only and is reviewed only if it changes code.

### Dispatch 1: rename provider, handlers and capability

- **Outcome:** the language server declares `renameProvider` and answers `textDocument/prepareRename` and `textDocument/rename` as the slice spec describes; a new name that is not a PSL identifier gets an error response. Tests cover the project spec's Definition of Done and the slice spec's edge-case table. The language-server README states that rename is supported.
- **Builds on:** branch `find-usage` (PR #30621).
- **Hands to:** a server that answers rename, for the playground to use.
- **Focus:** `language-server/src/rename.ts` (new), `project.ts`, `server.ts`, `guarded-connection.ts` only if the error response needs it; `test/rename.test.ts` (new), `test/server.test.ts`; the language-server README.
- **Validation gate:** the changed test files, and `typecheck` and `lint` for the language-server package.

### Dispatch 2: rename in the playground

- **Outcome:** rename in `apps/lsp-playground` changes every scratch file that uses the symbol, including a file never selected in the sidebar. The playground README states that rename is supported.
- **Builds on:** Dispatch 1.
- **Hands to:** a complete feature, ready for review and QA.
- **Focus:** a check of what the editor does with a multi-file `WorkspaceEdit` today; `apps/lsp-playground/src/client/main.ts` if a file is left unchanged; `apps/lsp-playground/README.md`.
- **Validation gate:**
  - during the dispatch: `typecheck` and `lint` for the playground, and its tests if it has any for the client;
  - once at the end, for the slice: `pnpm --filter <language-server> test`, `pnpm typecheck`, `pnpm lint` for both packages, `pnpm lint:deps`, `pnpm test:packages`.

### Dispatch 3: manual QA

- **Outcome:** a `drive-qa-plan` script covers every row of the project spec's At-a-glance table, `prepareRename` and the refused name, and a `drive-qa-run` report records the results from driving the language server over stdio. The VS Code and playground steps are written for the operator to run.
- **Builds on:** Dispatch 2.
- **Hands to:** Slice DoD.
- **Focus:** QA artefacts under `projects/lsp-rename/qa/`, reusing the find-references driver (`projects/lsp-find-references/qa/driver/`). Code changes only if QA finds a defect, routed back through review.
