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

Then open the printed `http://localhost:5295/` URL. A file-picker sidebar beside the editor lists one entry per scratch-project file, labeled by filename. The editor is wired to request live diagnostics, folding ranges, semantic tokens, and whole-document formatting (via the header's **Format** button) from the language server — see the interim limitation below: none of these currently produce visible output against this scratch project until the glob-aware language-server slice lands.

Everything (editor + LSP) is served on the single port `5295`.

### File picker and lazy opening — the managed/unmanaged demo

The first file opens on startup exactly as before. Every other file stays **unopened** — no `textDocument/didOpen` is sent, and the language server has no knowledge of that file — until you select it in the sidebar for the first time; from then on, switching back to it only swaps the visible editor model (no re-open). This is a deliberate, minimal reproduction of the disk/overlay split the real language server implements (`design-decisions.md` entry 4): an opened document lives in the client's in-memory overlay, while everything else is only known by whatever the server reads from disk.

**Interim limitation, until the language-server slice lands:** the language server currently treats `prisma.config.ts`'s `contract` as a literal path, not a glob, so against this scratch project's `./scratch/**/*.prisma` config no scratch file passes its membership check. Diagnostics, folding ranges, semantic tokens, and whole-document formatting are all gated on that same membership check, so the language server is entirely inert against this scratch project — no diagnostics, no folding ranges, no semantic tokens, no formatting, for any file, opened or unopened. The file-picker sidebar and lazy-open bookkeeping above are already in place for when the glob-aware slice lands: every feature comes to life then, with no further playground changes needed.

Browser edits stay in the in-memory overlay; nothing writes them back to the scratch files on disk.

## How it works

```text
Monaco editor + VS Code API shim  --LSP/WebSocket-->  ws bridge  --spawn+stdio-->  node cli.js lsp --stdio
(monaco-languageclient + vscode-languageclient)       (vscode-ws-jsonrpc/server)   (prisma lsp)
```

- `src/bridge.ts` — `ws` + `vscode-ws-jsonrpc/server` (`createServerProcess` + `forward`), adapted from the TypeFox example (MIT). Each browser WebSocket connection spawns `node <built-cli> lsp --stdio` and forwards JSON-RPC between the browser and the language server process. File-count-agnostic; unaffected by the scratch project being multi-file.
- `src/default-config.ts` — ensures the scratch project exists (seeding it once, on first creation only) and (re)generates its `prisma.config.ts`, whose `contract` is the glob `./scratch/**/*.prisma`.
- `src/cli.ts` — arg parsing (no schema path accepted), startup for the shared HTTP server that hosts Vite plus the LSP WebSocket bridge, and serving launch-time client config — the scratch project's root URI and every member's `{ uri, text }` — as same-origin JSON at `/__psl_playground_runtime.json` without rewriting tracked source files.
- `src/client/main.ts` — Monaco editor setup via `EditorApp`, the file-picker sidebar and lazy-open bookkeeping, VS Code API service overrides, runtime config fetch/validation, and `LanguageClientWrapper` startup for the `prisma` language id.

## Semantic tokens

The playground does not contain a PSL classifier. Semantic highlighting comes from the standard LSP path: the language server advertises `semanticTokensProvider`, `vscode-languageclient` registers Monaco/VS Code document and range semantic-token providers for the `prisma` document selector, and requests flow over the same WebSocket bridge as diagnostics, folding, and formatting.

The client loads Monaco's VS Code theme service with the bundled Default Dark+ theme. A tiny local system extension contributes `semanticTokenScopes` for the `prisma` language so the server's standard semantic token types resolve to the theme's existing TextMate colors; it does not classify PSL or define a custom PSL color palette.

Keep PSL meaning in the language server the `prisma lsp` command runs. If semantic-token traffic is present but colors are not visually distinct in Monaco, prefer the smallest Monaco-side setting or theme adjustment that enables standard semantic highlighting; do not add a playground-local tokenizer, custom token legend, CodeMirror adapter, or duplicate request loop.

## Manual QA

Use this path when changing the language server, playground wiring, or docs for editor features. The visual checks require a browser; a headless JSON-RPC smoke can prove the bridge returns token data, but it cannot prove Monaco theme rendering.

**Steps 5–8 currently produce no visible output.** As noted in "File picker and lazy opening" above, the language server treats `prisma.config.ts`'s `contract` as a literal path rather than a glob, so it is entirely inert against this scratch project until the glob-aware language-server slice lands — no diagnostics, no folding ranges, no semantic tokens, no formatting. Walk through the steps anyway to confirm the plumbing (requests are sent, no crashes); the silence is expected and is not a setup failure.

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

3. Start the playground with `pnpm --filter lsp-playground start` (or `psl-playground` when using the package binary), open the printed `http://localhost:5295/` URL, and select the edited file in the sidebar.
4. Confirm the browser console logs `Connected to language server` and the Network tab shows the `/psl` WebSocket connected.
5. Confirm semantic highlighting is server-driven: declarations, field names, attributes, literals, comments, and type references receive semantic styling after the LSP connection initializes. In the Network/WebSocket frames or language-server logs, confirm `textDocument/semanticTokens/full` or `textDocument/semanticTokens/range` requests are sent; there should be no playground-local PSL tokenization code involved.
6. Edit the document by adding a field such as `enabled Boolean @default(false)` or renaming a model/type reference. Confirm semantic highlighting refreshes after the edit and diagnostics still update live.
7. Break the document temporarily, for example by deleting a closing `}`. Confirm diagnostics appear, folding remains available for still-valid blocks where possible, and semantic highlighting degrades gracefully rather than crashing the editor. Restore the brace and confirm diagnostics clear.
8. Make formatting intentionally non-canonical, for example `model User {\nid Int\n}`, click **Format**, and confirm the editor receives a whole-document formatting edit from the language server.
9. Stop the playground terminal or close/block the `/psl` WebSocket from browser devtools and confirm the editor remains usable with no local semantic-token fallback pretending to classify PSL. Restart the playground to continue testing.
