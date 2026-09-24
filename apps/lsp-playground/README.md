# lsp-playground (private)

A throwaway dev playground that opens a multi-file PSL scratch project in a browser Monaco editor wired to the Prisma 8 language server (`prisma lsp --stdio`) for live diagnostics, folding ranges, whole-document formatting, and server-driven semantic tokens.

It is a private, unpublished `apps/` package — not part of the framework build graph and exempt from `lint:deps` layering.

## Usage

```bash
# 1. Build the playground dependency closure once so the bridge can spawn the built CLI and generated configs can import workspace packages:
pnpm --filter lsp-playground... run --if-present build

# 2. Open the scratch project (no arguments — a schema path is a hard error, see below):
psl-playground

# During repository development, the package script is equivalent:
pnpm --filter lsp-playground start
```

`psl-playground` takes **no arguments**. It always opens the gitignored scratch project under `.playground/scratch/`, seeding it on first creation with three `.prisma` files — two directive-carrying files (`customer.prisma`, `order.prisma`) forming a cross-file relation and a namespace reopened across both, plus one directive-less file (`draft.prisma`) that demonstrates membership exclusion. An **existing** scratch directory is never re-seeded or overwritten; edit the files under `.playground/scratch/` directly and your changes persist across restarts. Passing a schema path as a positional argument exits non-zero with a message pointing at this workflow instead.

Then open the printed `http://localhost:5295/` URL. A tab strip above the editor shows one tab per scratch-project file, labeled by filename; parse diagnostics update live as you edit, folding controls are available in the editor gutter, semantic highlighting is requested through the language client, and the header's **Format** button sends `textDocument/formatting` for the active document.

Everything (editor + LSP) is served on the single port `5295`.

### Tabs and lazy opening — the managed/unmanaged demo

The first tab opens on startup exactly as before. Every other tab stays **unopened** — no `textDocument/didOpen` is sent, and the language server has no knowledge of that file — until you click it for the first time; from then on, switching back to it only swaps the visible editor model (no re-open). This is a deliberate, minimal reproduction of the disk/overlay split the real language server implements (`design-decisions.md` entry 4): an opened document lives in the client's in-memory overlay, while everything else is only known by whatever the server reads from disk.

**Interim limitation, until the language-server slice lands:** a never-clicked tab's file is not yet part of the symbol table, so a cross-file reference into it does not resolve and its own declarations do not appear elsewhere. Click through both `customer.prisma` and `order.prisma` at least once each to see their cross-file relation and reopened `catalog` namespace resolve. `draft.prisma` carries no `// use prisma-8` directive, so it is excluded from the schema regardless of whether its tab is opened — clicking it demonstrates directive-based membership exclusion, not the lazy-open gap. This is the demonstration the slice stages, not a bug to fix here.

Browser edits stay in the in-memory overlay; nothing writes them back to the scratch files on disk.

## How it works

```text
Monaco editor + VS Code API shim  --LSP/WebSocket-->  ws bridge  --spawn+stdio-->  node cli.js lsp --stdio
(monaco-languageclient + vscode-languageclient)       (vscode-ws-jsonrpc/server)   (prisma lsp)
```

- `src/bridge.ts` — `ws` + `vscode-ws-jsonrpc/server` (`createServerProcess` + `forward`), adapted from the TypeFox example (MIT). Each browser WebSocket connection spawns `node <built-cli> lsp --stdio` and forwards JSON-RPC between the browser and the language server process. File-count-agnostic; unaffected by the scratch project being multi-file.
- `src/default-config.ts` — ensures the scratch project exists (seeding it once, on first creation only) and (re)generates its `prisma.config.ts`, whose `contract` is the glob `./scratch/**/*.prisma`.
- `src/cli.ts` — arg parsing (no schema path accepted), startup for the shared HTTP server that hosts Vite plus the LSP WebSocket bridge, and serving launch-time client config — the scratch project's root URI and every member's `{ uri, text }` — as same-origin JSON at `/__psl_playground_runtime.json` without rewriting tracked source files.
- `src/client/main.ts` — Monaco editor setup via `EditorApp`, the tab strip and lazy-open bookkeeping, VS Code API service overrides, runtime config fetch/validation, and `LanguageClientWrapper` startup for the `prisma` language id.

## Semantic tokens

The playground does not contain a PSL classifier. Semantic highlighting comes from the standard LSP path: the language server advertises `semanticTokensProvider`, `vscode-languageclient` registers Monaco/VS Code document and range semantic-token providers for the `prisma` document selector, and requests flow over the same WebSocket bridge as diagnostics, folding, and formatting.

The client loads Monaco's VS Code theme service with the bundled Default Dark+ theme. A tiny local system extension contributes `semanticTokenScopes` for the `prisma` language so the server's standard semantic token types resolve to the theme's existing TextMate colors; it does not classify PSL or define a custom PSL color palette.

Keep PSL meaning in the language server the `prisma lsp` command runs. If semantic-token traffic is present but colors are not visually distinct in Monaco, prefer the smallest Monaco-side setting or theme adjustment that enables standard semantic highlighting; do not add a playground-local tokenizer, custom token legend, CodeMirror adapter, or duplicate request loop.

## Manual QA

Use this path when changing the language server, playground wiring, or docs for editor features. The visual checks require a browser; a headless JSON-RPC smoke can prove the bridge returns token data, but it cannot prove Monaco theme rendering.

1. Build the dependency closure with `pnpm --filter lsp-playground... run --if-present build`.
2. Edit `.playground/scratch/customer.prisma` (or any scratch file) to a representative PSL document that includes a namespace, models, a composite type, a `types` block, attributes, strings, numbers, booleans, and a comment — for example, replace its content with:

```psl
// use prisma-8
// leading comment
namespace billing {
  model Invoice {
    id Int @id
    customer User? @relation(name: "invoice_user", fields: [id])
    amount Decimal @default(12.5)
    active Boolean @default(true)
    shipping Address
    @@map("invoices")
  }

  type Address {
    street String
  }
}

model User {
  id Int @id
}

types {
  Decimal = Float
  Identifier = String @map("id")
}
```

3. Start the playground with `pnpm --filter lsp-playground start` (or `psl-playground` when using the package binary), open the printed `http://localhost:5295/` URL, and click the edited file's tab.
4. Confirm the browser console logs `Connected to language server` and the Network tab shows the `/psl` WebSocket connected.
5. Confirm semantic highlighting is server-driven: declarations, field names, attributes, literals, comments, and type references receive semantic styling after the LSP connection initializes. In the Network/WebSocket frames or language-server logs, confirm `textDocument/semanticTokens/full` or `textDocument/semanticTokens/range` requests are sent; there should be no playground-local PSL tokenization code involved.
6. Edit the document by adding a field such as `enabled Boolean @default(false)` or renaming a model/type reference. Confirm semantic highlighting refreshes after the edit and diagnostics still update live.
7. Break the document temporarily, for example by deleting a closing `}`. Confirm diagnostics appear, folding remains available for still-valid blocks where possible, and semantic highlighting degrades gracefully rather than crashing the editor. Restore the brace and confirm diagnostics clear.
8. Make formatting intentionally non-canonical, for example `model User {\nid Int\n}`, click **Format**, and confirm the editor receives a whole-document formatting edit from the language server.
9. Stop the playground terminal or close/block the `/psl` WebSocket from browser devtools and confirm the editor remains usable with no local semantic-token fallback pretending to classify PSL. Restart the playground to continue testing.
