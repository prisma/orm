# @internal/language-server

> **Internal package.** This package is an implementation detail of Prisma Next and is published only to support its runtime. Its API is unstable and may change without notice. Do not depend on this package directly; install `@prisma/cli` and a database facade (e.g. `@prisma/orm-postgres`) instead.

The Prisma Next language server speaks the Language Server Protocol over stdio for PSL schema inputs declared in a project's `prisma.config.ts`. It is launched by the `prisma lsp` subcommand, so editor features come from the project's own Prisma Next version and stay version-matched by construction.

The server only handles documents whose first non-whitespace content is a `// use prisma-next` line comment; all other documents belong to the legacy (Prisma ≤7) language server and are ignored per request from current document content. The check must stay byte-for-byte in sync with the legacy server's copy in `prisma/language-tools`.

## Responsibilities

- Serve diagnostics, whole-document formatting, folding ranges, semantic tokens, and completion for open configured PSL inputs carrying the directive.
