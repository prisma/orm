## Dispatch plan

Slice spec: `projects/lsp-find-references/slices/find-references/spec.md`

Review: one reviewer round after Dispatch 1. Dispatch 2 produces QA artefacts only and is reviewed only if it changes code.

### Dispatch 1: references, binder namespace names, definition on declarations

- **Outcome:** the binder records a `namespace` resolution on every namespace block name; the language server declares `referencesProvider` and answers `textDocument/references` as the slice spec describes; go-to-definition on a declaration's own name returns the declaration. Tests cover the project spec's Definition of Done and the slice spec's edge-case table. The three READMEs are updated.
- **Builds on:** `main`.
- **Hands to:** a complete feature, ready for QA.
- **Focus:** `psl-parser/src/binder.ts` and its tests; `language-server/src/references.ts` (new), `definition.ts`, `project-artifacts.ts`, `project.ts`, `server.ts` and their tests; the language-server, psl-parser and playground READMEs.
- **Validation gate:**
  - during the dispatch: the changed test files, and `typecheck` and `lint` for the psl-parser and language-server packages;
  - once at the end: `pnpm --filter <psl-parser> test`, `pnpm --filter <language-server> test`, `pnpm typecheck`, `pnpm lint` for both packages, `pnpm lint:deps`, `pnpm test:packages`.

### Dispatch 2: manual QA

- **Outcome:** a `drive-qa-plan` script covers every row of the project spec's At-a-glance table and the go-to-definition change, and a `drive-qa-run` report records the results from driving the language server over stdio or through the server test harness. The VS Code steps are written for the operator to run.
- **Builds on:** Dispatch 1.
- **Hands to:** Slice DoD.
- **Focus:** QA artefacts under `projects/lsp-find-references/qa/`. Code changes only if QA finds a defect, routed back through review.
