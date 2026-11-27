# @prisma/orm-extension-pgvector

Embedding columns and vector similarity search for Prisma 8 on PostgreSQL, powered by [pgvector](https://github.com/pgvector/pgvector).

> **Maturity level: Generally Available.** From release 8.0, no later 8.x release breaks code that uses this package. Until release 8.0 it is published as `8.0.0-rc.N`, like every Prisma 8 package, and any of those versions may contain breaking changes. See [Versions and support](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#maturity-levels).

```bash
pnpm add @prisma/orm-extension-pgvector
```

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/pack` | the extension pack an application composes into `extensions: [...]` — pure, no runtime imports |
| `/column-types` | the `vector()` or `vector(n)` column author |
| `/codec-types`, `/operation-types` | types emitted contracts reference |
| `/runtime` | the runtime extension that registers the codec and operations |
| `/control` | the control descriptor and baseline migration that install the server extension |

## Responsibilities

Variable or fixed-dimension vector storage and search: the `pg/vector@1` codec (`number[]` at runtime; in `contract.d.ts`, `Vector<N>` for `vector(n)` and `number[]` for `vector()`), similarity operations such as `cosineDistance`, and a baseline migration that runs `CREATE EXTENSION IF NOT EXISTS vector` when the pack is composed into an application.
