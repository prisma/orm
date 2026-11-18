# Manual QA run — `lsp-whole-project` playground bench

**Date:** 2026-09-25
**Target:** `apps/lsp-playground`, merged tree (`multifile-psl-lsp` after the `origin/main` merge, `packages/1-framework/3-tooling/language-server` at commit `d6bb859240` + merge).
**Method:** headless Chromium (`puppeteer-core`, already a devDependency of `lsp-playground`) driving the real playground server (`pnpm --filter lsp-playground start`) on port 5295. The page's `window.WebSocket` is monkey-patched before navigation (`page.evaluateOnNewDocument`) to record every JSON-RPC frame sent and received over the `/psl` LSP WebSocket, correlating request/response pairs by `id`. Edits are driven through the real Monaco editor via keyboard input (select-all + retype), not by calling internal APIs directly, so the LSP traffic observed is exactly what a real editing session produces. The scratch project used is the existing seeded one at `apps/lsp-playground/.playground/scratch/` (`customer.prisma`, `order.prisma`, `draft.prisma` — unmodified from `default-config.ts`'s `SEED_FILES`). Only `customer.prisma` is ever opened (it opens automatically on startup, matching "first file opens on startup"); `order.prisma` and `draft.prisma` are never clicked. The server process is started detached and killed by process-group signal (`process.kill(-pid, 'SIGTERM')`) after each run.

## Check 1 — with only the first sidebar file ever opened, diagnostics appear for it and for never-opened members

**Verdict: PASS**

`customer.prisma` (opened) is served through **pull**: the client sends `textDocument/diagnostic` and the server responds `{"kind":"full","items":[]}` —

```json
{"dir":"out","method":"textDocument/diagnostic","id":1,"params":{"textDocument":{"uri":".../customer.prisma"}}}
{"dir":"in","method":"textDocument/diagnostic","id":1,"result":{"kind":"full","items":[]}}
```

`order.prisma` (never opened) is served through **push** — three `publishDiagnostics` notifications arrive for it over the session with no `didOpen` ever sent for its URI, confirming the closed-member push path (design decision 7) is live: `[[],[],[]]` (all empty, since the schema starts valid). This is the project's central demo: a file nobody ever clicked has live diagnostics.

## Check 2 — an edit introducing a cross-file breakage in the open file produces a diagnostic in a never-opened member; reverting clears it

**Verdict: PASS**

`customer.prisma`'s `model Customer` was renamed to `model CustomerRenamed` (via keyboard, select-all + retype) while only `customer.prisma` was ever open. Within ~1s, `order.prisma` — still never opened — received a new `publishDiagnostics` notification with four diagnostics attributing the break to its own `Order.customer` field:

```json
[
  {"code":"PSL_UNRESOLVED_REFERENCE","message":"Cannot find type \"Customer\"", "range": {"start":{"line":4,"character":13},"end":{"line":4,"character":21}}},
  {"code":"PSL_UNRESOLVED_REFERENCE","message":"Cannot find field \"id\" on the type of \"Order.customer\""},
  {"code":"PSL_UNSUPPORTED_FIELD_TYPE","message":"Field \"Order.customer\" type \"Customer\" is not supported in SQL PSL provider v1"},
  {"code":"PSL_INVALID_RELATION_TARGET","message":"Relation field \"Order.customer\" references unknown model \"Customer\""}
]
```

Reverting the edit (retyping the original `model Customer { ... }` content) produced a further `publishDiagnostics` notification for `order.prisma` with `items: []` — the diagnostic cleared, still without `order.prisma` ever being opened.

## Check 3 — the directive-less `draft.prisma` stays excluded (no diagnostics attributed to it)

**Verdict: PASS**

Across the whole session (initial load, the breaking edit, the revert, and the formatting check below), `draft.prisma`'s URI never appeared in a single `publishDiagnostics` notification — publish count: **0**. It matches the scratch glob but carries no `// use prisma-8` directive, so both the language server and (per the slice's parity fixture, see below) `contract emit` quietly exclude it — no diagnostic, no symbol-table entry, nothing published.

## Check 4 — folding, semantic tokens, and formatting now respond for opened files

**Verdict: PASS**

For the opened file (`customer.prisma`), the client automatically requested `textDocument/foldingRange` (1 request) and `textDocument/semanticTokens/full` + `.../range` (2 requests) as part of normal Monaco/`monaco-languageclient` document-open behavior — both previously silent under the pre-slice-3 literal-path bug (S2's "entirely inert" limitation).

Formatting was exercised explicitly: the editor content was replaced with a non-canonical `model User {\nid Int\n}\n`, and the **Format** button was clicked. The server returned a real edit:

```json
{"dir":"out","method":"textDocument/formatting","id":47,"params":{"textDocument":{"uri":".../customer.prisma"},"options":{"tabSize":2,"insertSpaces":true}}}
{"dir":"in","method":"textDocument/formatting","id":47,"result":[{"range":{"start":{"line":0,"character":0},"end":{"line":4,"character":0}},"newText":"// use prisma-8\nmodel User {\n  id Int\n}\n"}]}
```

## Summary

| # | Check | Verdict |
|---|---|---|
| 1 | Diagnostics appear for the opened file (pull) and for never-opened members (push) | PASS |
| 2 | A cross-file breakage in the open file produces, then clears, a diagnostic in a never-opened member | PASS |
| 3 | The directive-less `draft.prisma` stays excluded from diagnostics throughout | PASS |
| 4 | Folding, semantic tokens, and formatting respond for the opened file | PASS |

The S2 "entirely inert" limitation is closed: with a single file ever opened, the playground now demonstrates glob membership, disk read-through, and push-to-closed-members exactly as the slice's design intended, with no playground-side changes required to make this visible.
