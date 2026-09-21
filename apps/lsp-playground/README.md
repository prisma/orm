# lsp-playground (private)

A throwaway dev playground that opens a `.psl` file in a browser Monaco editor wired to the Prisma 8 language server (`prisma lsp --stdio`) for live PSL diagnostics, folding ranges, whole-document formatting, and server-driven semantic tokens.

It is a private, unpublished `apps/` package — not part of the framework build graph and exempt from `lint:deps` layering.

## Usage

```bash
# 1. Build the playground dependency closure once so the bridge can spawn the built CLI and generated configs can import workspace packages:
pnpm --filter lsp-playground... run --if-present build

# 2a. Open a scratch schema (no file needed):
psl-playground

# 2b. Or open an existing PSL file:
psl-playground path/to/schema.psl

# During repository development, the package script is equivalent:
pnpm --filter lsp-playground start path/to/schema.psl
```

The PSL file is **optional**. With no argument — or a path that does not yet exist — the playground opens a writable scratch schema under `.playground/` so you can start authoring immediately. New scratch schemas start with `// use prisma-8` to enable language-server features; existing files are preserved. Then open the printed `http://localhost:5295/` URL; parse diagnostics update live as you edit, folding controls are available in the editor gutter, semantic highlighting is requested through the language client, and the header's **Format** button sends `textDocument/formatting` to the language server.

Everything (editor + LSP) is served on the single port `5295`.

### Config resolution

The language server identifies schema documents from `prisma.config.ts` (`contract.source.inputs`), discovering a document's config by walking up from the document's own path. The playground resolves what the editor opens, and the config that sits above it, as follows:

1. An **existing** file already inside a project (a `prisma.config.ts` is found walking up from it): open it in place under that config.
2. Otherwise (no file, a non-existent path, or an existing file with no project config): **stage a copy** of the schema under `.playground/` and generate a **default-postgres** config beside it — the "without a config, assume default postgres" path. Staging is required because the server resolves the generated config's `@prisma/orm-postgres` import and discovers the config by walking up from the staged file.

There is no `--config` flag: the language server discovers config purely by walking up from each document, so it cannot be pointed at an arbitrary config path.

## How it works

```text
Monaco editor + VS Code API shim  --LSP/WebSocket-->  ws bridge  --spawn+stdio-->  node cli.js lsp --stdio
(monaco-languageclient + vscode-languageclient)       (vscode-ws-jsonrpc/server)   (prisma lsp)
```

- `src/bridge.ts` — `ws` + `vscode-ws-jsonrpc/server` (`createServerProcess` + `forward`), adapted from the TypeFox example (MIT). Each browser WebSocket connection spawns `node <built-cli> lsp --stdio` and forwards JSON-RPC between the browser and the language server process.
- `src/cli.ts` — arg parsing, config resolution, startup for the shared HTTP server that hosts Vite plus the LSP WebSocket bridge, and serving launch-time client config as same-origin JSON at `/__psl_playground_runtime.json` without rewriting tracked source files.
- `src/client/main.ts` — Monaco editor setup via `EditorApp`, VS Code API service overrides, runtime config fetch/validation, and `LanguageClientWrapper` startup for the `prisma` language id.

## Semantic tokens

The playground does not contain a PSL classifier. Semantic highlighting comes from the standard LSP path: the language server advertises `semanticTokensProvider`, `vscode-languageclient` registers Monaco/VS Code document and range semantic-token providers for the `prisma` document selector, and requests flow over the same WebSocket bridge as diagnostics, folding, and formatting.

The client loads Monaco's VS Code theme service with the bundled Default Dark+ theme. A tiny local system extension contributes `semanticTokenScopes` for the `prisma` language so the server's standard semantic token types resolve to the theme's existing TextMate colors; it does not classify PSL or define a custom PSL color palette.

Keep PSL meaning in the language server the `prisma lsp` command runs. If semantic-token traffic is present but colors are not visually distinct in Monaco, prefer the smallest Monaco-side setting or theme adjustment that enables standard semantic highlighting; do not add a playground-local tokenizer, custom token legend, CodeMirror adapter, or duplicate request loop.

## Manual QA

Use this path when changing the language server, playground wiring, or docs for editor features. The visual checks require a browser; a headless JSON-RPC smoke can prove the bridge returns token data, but it cannot prove Monaco theme rendering.

1. Build the dependency closure with `pnpm --filter lsp-playground... run --if-present build`.
2. Create or choose a representative PSL file that includes a namespace, models, a composite type, a `types` block, attributes, strings, numbers, booleans, and a comment. For example:

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

3. Start the playground with `pnpm --filter lsp-playground start path/to/schema.psl` (or `psl-playground path/to/schema.psl` when using the package binary) and open the printed `http://localhost:5295/` URL.
4. Confirm the browser console logs `Connected to language server` and the Network tab shows the `/psl` WebSocket connected.
5. Confirm semantic highlighting is server-driven: declarations, field names, attributes, literals, comments, and type references receive semantic styling after the LSP connection initializes. In the Network/WebSocket frames or language-server logs, confirm `textDocument/semanticTokens/full` or `textDocument/semanticTokens/range` requests are sent; there should be no playground-local PSL tokenization code involved.
6. Edit the document by adding a field such as `enabled Boolean @default(false)` or renaming a model/type reference. Confirm semantic highlighting refreshes after the edit and diagnostics still update live.
7. Break the document temporarily, for example by deleting a closing `}`. Confirm diagnostics appear, folding remains available for still-valid blocks where possible, and semantic highlighting degrades gracefully rather than crashing the editor. Restore the brace and confirm diagnostics clear.
8. Make formatting intentionally non-canonical, for example `model User {\nid Int\n}`, click **Format**, and confirm the editor receives a whole-document formatting edit from the language server.
9. Stop the playground terminal or close/block the `/psl` WebSocket from browser devtools and confirm the editor remains usable with no local semantic-token fallback pretending to classify PSL. Restart the playground to continue testing.
