# Brief: D2 — rename in the playground

## Task

Make rename work in `apps/lsp-playground` for a symbol used in several scratch files, including a scratch file never selected in the sidebar. First establish what the editor does today with the multi-file `WorkspaceEdit` the language server returns; change the client only if some file is left unchanged.

## Scope

**In:**

- `apps/lsp-playground/src/client/main.ts`, and other files under `apps/lsp-playground/src/client/` if the change needs them.
- `apps/lsp-playground/README.md`: add rename where the requests the editor sends are listed. One statement that rename is supported; if the client changed, the section that describes lazy opening is corrected where it would otherwise be false.
- Playground tests, if the client has any that the change affects.

**Out:**

- `packages/**`. If the playground cannot work without a language-server change, halt.
- `projects/**` (read-only for you).

## Completed when

- [ ] You have observed, in a running playground driven by a real or headless browser, a rename of a symbol used in at least two scratch files, one of them never selected in the sidebar, and every file holds the new name afterwards (in the editor's model and, where the playground writes scratch files back, on disk). Report exactly what you ran and what you saw.
- [ ] If no browser can be driven in this environment, say so plainly, report what you established by reading the client and the editor libraries instead, and mark this item as not verified.
- [ ] After the rename, the language server's diagnostics for the renamed project are clean: the server saw the changed text of every file.
- [ ] No code comments added. No bare `as` casts.
- [ ] Slice-end gate, run once: `pnpm --filter <language-server> test`, `pnpm typecheck`, `pnpm lint` for the language-server and playground packages, `pnpm lint:deps`, `pnpm test:packages`. Report each command and its result; for a failure, say whether it reaches code from this branch.
- [ ] Work is committed on `psl-rename` (new commits only; no amend, no rebase, no push).

## Standing instruction

Stay focused on the goal; control scope. Anything that pulls you off the goal halts and surfaces.

## References

- Slice spec: `projects/lsp-rename/slices/rename/spec.md` § Playground
- Closest prior work: the open-editor hook for cross-file go-to-definition (`viewsConfig.openEditorFunc` in `src/client/main.ts`) and the lazy-open bookkeeping next to it; the playground README sections "Go to definition" and "File picker and lazy opening".

## Operational metadata

- **Time-box:** 60 minutes.
- **Halt conditions:**
  - the playground needs a change outside `apps/lsp-playground`;
  - making it work needs a change to how scratch files are opened or synchronised that goes beyond applying an edit to a file not yet opened.
