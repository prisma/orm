# lsp-playground (private)

A throwaway dev playground that opens a multi-file PSL scratch project in a browser Monaco editor wired to the Prisma 8 language server (`prisma lsp --stdio`) for live diagnostics, folding ranges, whole-document formatting, server-driven semantic tokens, and go-to-definition.

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

`psl-playground` takes **no arguments**. It always opens the gitignored scratch project under `.playground/scratch/`, seeding it on first creation with three `.prisma` files — two directive-carrying files (`customer.prisma`, `order.prisma`) forming a cross-file relation, a namespace (`catalog`) reopened across both, and a qualified cross-file reference (`Order.product` of type `catalog.Product`), plus one directive-less file (`draft.prisma`) that demonstrates membership exclusion. An **existing** scratch directory is never re-seeded or overwritten; edit the files under `.playground/scratch/` directly and your changes persist across restarts. A scratch directory created before the seed gained the `catalog.Product` reference does not have it; delete `.playground/scratch/` (or run `pnpm --filter lsp-playground clean`) to re-seed. Passing a schema path as a positional argument exits non-zero with a message pointing at this workflow instead.

Then open the printed `http://localhost:5295/` URL. A file-picker sidebar beside the editor lists one entry per scratch-project file, labeled by filename. The editor is wired to request live diagnostics, folding ranges, semantic tokens, go-to-definition, and whole-document formatting (via the header's **Format** button) from the language server — see "File picker and lazy opening" below for what to expect from each, including files you never click.

Everything (editor + LSP) is served on the single port `5295`.

### File picker and lazy opening — the managed/unmanaged demo

The first file opens on startup exactly as before. Every other file stays **unopened** — no `textDocument/didOpen` is sent, so the language server has no open overlay for that file — until you select it in the sidebar for the first time; from then on, switching back to it only swaps the visible editor model (no re-open). This is a deliberate, minimal reproduction of the disk/overlay split the real language server implements: an opened document lives in the client's in-memory overlay, while unopened members are read from disk.

The language server treats `prisma.config.ts`'s `contract` glob as a standing membership rule: every scratch file matching `./scratch/**/*.prisma` and carrying `// use prisma-8` is a project member whether or not it has ever been opened. This is the demo the file-picker and lazy-open bookkeeping above exist for — with only `customer.prisma` ever clicked, `order.prisma` (its cross-file relation and reopened namespace partner) already receives pushed diagnostics based on its disk contents; an edit to the open file that breaks something in the unopened one updates those diagnostics without ever opening it. Inspect the language-server logs or WebSocket frames to see these notifications; an unopened editor does not render folding or highlighting. `draft.prisma` carries no directive, so both surfaces (this server and `contract emit`) quietly exclude it — no diagnostics, no symbol-table entry, nothing to format. Folding ranges, semantic tokens, and whole-document formatting (the **Format** button) are returned in response to requests for the opened editor document, not pushed for unopened files.

Browser edits stay in the in-memory overlay; nothing writes them back to the scratch files on disk.

### Go to definition

Go to Definition (F12 or Ctrl/Cmd-click) and Peek Definition (Alt+F12) send `textDocument/definition` to the language server; the playground does not resolve PSL names itself. A target in the file already shown is revealed in place. A target in another scratch file goes through the editor service's open-editor hook (`viewsConfig.openEditorFunc` in `src/client/main.ts`): the playground selects that file the same way a sidebar click does, including the first-selection `didOpen`, and the editor then reveals and selects the target range. Peek shows targets in an embedded editor and does not switch files. A namespace qualifier such as `catalog` in `catalog.Product` resolves to every `namespace catalog` block, so the editor lists them instead of jumping.

## How it works

```text
Monaco editor + VS Code API shim  --LSP/WebSocket-->  ws bridge  --spawn+stdio-->  node cli.js lsp --stdio
(monaco-languageclient + vscode-languageclient)       (vscode-ws-jsonrpc/server)   (prisma lsp)
```

- `src/bridge.ts` — `ws` + `vscode-ws-jsonrpc/server` (`createServerProcess` + `forward`), adapted from the TypeFox example (MIT). Each browser WebSocket connection spawns `node <built-cli> lsp --stdio` and forwards JSON-RPC between the browser and the language server process. File-count-agnostic; unaffected by the scratch project being multi-file.
- `src/default-config.ts` — ensures the scratch project exists (seeding it once, on first creation only) and (re)generates its `prisma.config.ts`, whose `contract` is the glob `./scratch/**/*.prisma`.
- `src/cli.ts` — arg parsing (no schema path accepted), startup for the shared HTTP server that hosts Vite plus the LSP WebSocket bridge, and serving launch-time client config — the scratch project's root URI and every member's `{ uri, text }` — as same-origin JSON at `/__psl_playground_runtime.json` without rewriting tracked source files.
- `src/client/main.ts` — Monaco editor setup via `EditorApp`, the file-picker sidebar and lazy-open bookkeeping, the open-editor hook that switches files for cross-file definitions, VS Code API service overrides, runtime config fetch/validation, and `LanguageClientWrapper` startup for the `prisma` language id.

## Semantic tokens

The playground does not contain a PSL classifier. Semantic highlighting comes from the standard LSP path: the language server advertises `semanticTokensProvider`, `vscode-languageclient` registers Monaco/VS Code document and range semantic-token providers for the `prisma` document selector, and requests flow over the same WebSocket bridge as diagnostics, folding, and formatting.

The client loads Monaco's VS Code theme service with the bundled Default Dark+ theme. A tiny local system extension contributes `semanticTokenScopes` for the `prisma` language so the server's standard semantic token types resolve to the theme's existing TextMate colors; it does not classify PSL or define a custom PSL color palette.

Keep PSL meaning in the language server the `prisma lsp` command runs. If semantic-token traffic is present but colors are not visually distinct in Monaco, prefer the smallest Monaco-side setting or theme adjustment that enables standard semantic highlighting; do not add a playground-local tokenizer, custom token legend, CodeMirror adapter, or duplicate request loop.

## Manual QA

Use this path when changing the language server, playground wiring, or docs for editor features. The visual checks require a browser; a headless JSON-RPC smoke can prove the bridge returns token data, but it cannot prove Monaco theme rendering.

Steps 5–8 exercise the file you edit and opened; step 2a below exercises a sibling file you never open, which is the project's central demo (see "File picker and lazy opening" above).

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

3. Start the playground with `pnpm --filter lsp-playground start` (or `psl-playground` when using the package binary), open the printed `http://localhost:5295/` URL, and select the edited file in the sidebar. Do not click any other sidebar entry yet.
   1. (never-opened member) In the language-server logs or the WebSocket frames, confirm `textDocument/publishDiagnostics` notifications arrive for `order.prisma` (or whichever sibling file you never clicked) even though no `textDocument/didOpen` was ever sent for it. Introduce a break that spans both files (for example, a duplicate top-level declaration shared with the edited file) and confirm the never-opened file's diagnostics update; confirm `draft.prisma` never receives a diagnostics publish at all.
4. Confirm the browser console logs `Connected to language server` and the Network tab shows the `/psl` WebSocket connected.
5. Confirm semantic highlighting is server-driven: declarations, field names, attributes, literals, comments, and type references receive semantic styling after the LSP connection initializes. In the Network/WebSocket frames or language-server logs, confirm `textDocument/semanticTokens/full` or `textDocument/semanticTokens/range` requests are sent; there should be no playground-local PSL tokenization code involved.
6. Edit the document by adding a field such as `enabled Boolean @default(false)` or renaming a model/type reference. Confirm semantic highlighting refreshes after the edit and diagnostics still update live.
7. Break the document temporarily, for example by deleting a closing `}`. Confirm diagnostics appear, folding remains available for still-valid blocks where possible, and semantic highlighting degrades gracefully rather than crashing the editor. Restore the brace and confirm diagnostics clear.
8. Make formatting intentionally non-canonical, for example `model User {\nid Int\n}`, click **Format**, and confirm the editor receives a whole-document formatting edit from the language server.
9. Go to definition, starting from a freshly seeded scratch project (delete `.playground/scratch/` first if it predates the `catalog.Product` reference) with `order.prisma` selected:
   1. (in-file) Put the cursor on `customerId` in `@relation(fields: [customerId], ...)` and press F12. Confirm the cursor moves to the `customerId` field declaration in the same file and the sidebar selection does not change.
   2. (peek) On `Customer` in `Order.customer`, press Alt+F12. Confirm a peek widget opens inline showing the `Customer` model from `customer.prisma`, the sidebar still shows `order.prisma` as active, and Escape closes the widget.
   3. (cross-file) On `Customer` in `Order.customer`, press F12 (or Ctrl/Cmd-click it). Confirm the editor switches to `customer.prisma`, the sidebar marks `customer.prisma` active, and the `Customer` model name is selected. If `customer.prisma` had never been selected, confirm a `textDocument/didOpen` for it appears in the WebSocket frames; switching back through the sidebar must not send another one. Repeat on `Product` in `catalog.Product` and confirm it lands on the `Product` model name inside `namespace catalog` in `customer.prisma`.
   4. (namespace qualifier) Back in `order.prisma`, press F12 on `catalog` in `catalog.Product`. Confirm the editor lists both `namespace catalog` blocks (one in `customer.prisma`, one in `order.prisma`) in a peek list rather than jumping, and that opening the `customer.prisma` entry from that list switches the sidebar selection.
10. Stop the playground terminal or close/block the `/psl` WebSocket from browser devtools and confirm the editor remains usable with no local semantic-token fallback pretending to classify PSL. Restart the playground to continue testing.
