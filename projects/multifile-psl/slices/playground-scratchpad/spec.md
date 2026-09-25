# Slice: playground-scratchpad

Parent project: `projects/multifile-psl/`. Outcome contributed: the playground becomes the multi-file test bench — a fixed scratch directory of `.prisma` files, a tab per file, lazy opening — so the language-server slice can be exercised by hand as it develops.

## At a glance

`psl-playground` stops taking a schema path and always opens a gitignored scratch directory seeded with a multi-file schema behind a glob config. A file-picker sidebar lists the member files (operator amendment 2026-09-25: sidebar instead of the originally-specified tab strip); a file's document opens (and sends `didOpen`) only when first selected, so untouched files remain unmanaged — the staged gap slice 3 closes.

## Chosen design

Decided in project [`design-decisions.md`](../../design-decisions.md) entry 10; the plan's slice entry records the accepted intermediate state. Concretely:

- **CLI (`apps/lsp-playground/src/cli.ts`):** positional schema arguments are removed (usage becomes `psl-playground` with the existing flags). `stageSchema` becomes scratch-directory seeding: ensure `<pkg>/.playground/scratch/` exists; on first run seed it with three files — two directive-carrying files with a cross-file relation and a namespace reopened across both, plus one directive-less file that demonstrates membership exclusion. An existing scratch directory is left untouched (the user's edits persist across restarts). (S2-D1 amendment: the original wording kept "the discovered-config branch of `cli.ts` as is" — that branch only ever triggered from a positional schema argument and is unreachable once arguments are removed; the branch's call site is deleted and the now-orphaned `find-config.ts` is removed in dispatch 2. Dead code is removed, not kept.)
- **Config (`src/default-config.ts`):** the generated `prisma.config.ts` uses `contract: './scratch/**/*.prisma'`. The discovered-config branch of `cli.ts` stays as is for repos that carry their own config.
- **Runtime contract (`cli.ts` `RuntimeConfig` + the `/__psl_playground_runtime.json` endpoint + the validator mirror in `src/client/main.ts`):** the singular `documentUri`/`schemaPath`/`schemaText` fields become a list of `{ uri, text }` members plus the scratch-root URI. The bridge (`src/bridge.ts`) is file-count-agnostic and stays untouched.
- **Client (`src/client/main.ts` + `index.html`):** one `RegisteredMemoryFile` per member in the existing filesystem overlay; a file-picker sidebar (left of the editor) replaces the single `#schema-path` label, listing member basenames with an active highlight; the first file opens on startup, every other file calls `vscode.workspace.openTextDocument` + editor swap on first selection only (pinned model references preserved). The format button keeps acting on the active document.
- **README (`apps/lsp-playground/README.md`):** usage and architecture sections updated; the lazy-open/unmanaged demonstration and the interim single-slice limitation stated plainly.

## Coherence rationale

One outcome — "the playground opens a multi-file scratch project" — across one private app; server-side staging and client-side tabs are two halves of the same runtime contract change and are not independently shippable. Nothing outside `apps/lsp-playground` changes.

## Scope

**In:** `apps/lsp-playground/**` only (`cli.ts`, `default-config.ts`, `client/main.ts`, `index.html`, README, the package's gitignore entry for the scratch dir if not already covered).

**Out:** language-server behavior (slice 3); write-back of browser edits to the scratch files on disk; any file-management UI (create/delete/rename).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Scratch dir exists from a prior run | Never re-seed or overwrite; open as found | User edits survive restarts |
| LSP silent on glob configs until slice 3 (inputs treated as literal paths; membership gate fails for every member) | Accepted intermediate state, stated in README; discovered in S2-D2's wire-level probe | Larger than the originally assumed "unopened tabs missing from symbol table" — the whole bench is inert until slice 3, making the before/after demo starker |

## Slice-specific done conditions

- [ ] `psl-playground` with no arguments serves the scratch project; all member files appear in the sidebar. (Amended by operator ruling 2026-09-24, falsified assumption: the pre-slice-3 language server treats config `inputs` as literal paths, so a glob config makes it entirely silent — no diagnostics for any file, opened or not. Cross-file-resolution and membership-exclusion verification move wholly to slice 3; the README states the full silence as the staged gap.)
- [ ] A never-selected sidebar file has sent no `didOpen` (verifiable from the ws bridge's LSP traffic or server logs).
- [ ] Passing a positional schema path exits with a clear error pointing at the scratch directory workflow.

## Open Questions

None — decided in the project discussion; presentation details (tab styling) are the implementer's discretion.

## References

- Parent project: [`../../spec.md`](../../spec.md); decisions 2, 10.
- Playground architecture: `apps/lsp-playground/README.md`.
- Linear issue: waived by operator ("skip linear").
