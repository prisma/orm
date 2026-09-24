# multifile-psl — Plan

**Spec:** `projects/multifile-psl/spec.md`
**Linear Project:** _pending — see Dependencies_

## At a glance

Three slices in one stack: emission learns to read many files, the language server learns to see files it hasn't opened, the playground demonstrates both. Each slice ships user-visible behavior on its own; the stack order follows the hand-offs, not caution.

## Composition

### Stack (deliver in order)

1. **Slice `multi-file-emit`** — Linear: _pending_
   - **Outcome:** A config whose contract source `inputs` is an array of globs emits one contract from all matching `.prisma` files that carry the `// use prisma-8` directive. Expansion is sorted and re-runs per load; emitted output is independent of file-discovery order. `orm format` formats every member file. Default output path derives from the glob's static prefix; single-path behavior is unchanged. `PslInterpretInput` carries `documents: readonly DocumentAst[]`; the two composition-context diagnostics become `InternalError` assertions.
   - **Builds on:** None.
   - **Hands to:** A shared membership-and-expansion helper (glob expansion + directive check) that the language server imports in slice 2, so the predicate is defined once; the plural interpreter input shape; multi-file emit fixtures reusable by the parity suite.
   - **Focus:** Config (`@internal/config`, `config-loader`), `psl-parser` interpreter input, both `contract-psl` providers (SQL + Mongo), extension `define-config` wrappers, CLI `format`, `tinyglobby` into the catalog. The language server is touched only enough to keep compiling against the changed interpreter input (pass `documents: [document]` in the existing per-document loop); its real migration is slice 2.

2. **Slice `playground-scratchpad`** — Linear: _pending_
   - **Outcome:** The playground drops arbitrary schema-path arguments and always opens a fixed gitignored scratch directory seeded with multiple `.prisma` files. The client renders a tab strip; a tab's document opens in Monaco only on first click. The generated config uses a glob. Known and accepted until slice 3 lands: a never-clicked tab's file is absent from the symbol table (the server still reads only open documents), so cross-file references resolve only after each tab is opened once — the playground deliberately displays the gap slice 3 closes.
   - **Builds on:** Slice 1's glob config surface (the generated config) and interpreter input shape (compile-level).
   - **Hands to:** The manual test bench for slice 3 — the LSP work is exercised in the playground as it develops, and the project-DoD demo condition (a diagnostic caused by a never-opened tab's file) becomes verifiable there the moment slice 3's server behavior lands, with no further playground changes.
   - **Focus:** `apps/lsp-playground` only (`cli.ts`, `default-config.ts`, `client/main.ts`, `index.html`, README). No write-back of browser edits to disk; no file-management UI.

3. **Slice `lsp-whole-project`** — Linear: _pending_
   - **Outcome:** The language server builds the project symbol table from every member file whether open or not. `DocumentStore` becomes the single content store (one map, entries tagged overlay or disk; synchronous disk reads; stat revalidation when the client cannot watch). The server registers `workspace/didChangeWatchedFiles` on the glob, interprets once per project, distributes diagnostics by `sourceId`, pushes them to all member files including closed ones with published-URI tracking, advertises `interFileDependencies: true`, and keeps projects alive after the last document closes.
   - **Builds on:** Slice 1's shared membership helper, interpreter input shape, and emit fixtures; slice 2's playground as the manual verification surface.
   - **Hands to:** Project close-out — the multi-file `lsp-emit-parity` fixture proving emit and LSP agree (including a directive-less file excluded by both), and the playground demo evidence for the project DoD.
   - **Focus:** `language-server` package and the `lsp-emit-parity` integration suite. No playground changes; no `workspace/diagnostic` pull machinery; no server-side watcher.

## Dependencies (external)

- [ ] Linear Project + per-slice issues — not yet created; this session has no Linear access. Create via the `save_project` MCP tool per `drive/project/README.md`, then fill the `Linear:` fields above.
- [ ] Working branch — current branch `multifiile-psl` does not follow the `<tml-id>-<slug>` convention (and misspells the slug); rename once the Linear Project ID exists.

## Sequencing rationale

Slice 1 leads because both others import its glob config surface and interpreter input shape. The playground precedes the LSP slice by operator request: the LSP work is the riskiest part of the project, and the operator wants a live test bench for it while it develops. The cost of that order is a known intermediate state — until slice 3, unclicked playground tabs are missing from the symbol table — accepted deliberately because it displays the exact gap slice 3 closes. Combining slices 2 and 3 was rejected: a content-store redesign plus protocol work plus a parity suite plus UI work is not one coherent review.
