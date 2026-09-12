# @prisma/orm-extension-pgvector

Embedding columns and vector similarity search for Prisma 8 on PostgreSQL, powered by [pgvector](https://github.com/pgvector/pgvector).

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

Variable or fixed-dimension vector storage and search: the `pg/vector@1` codec (`number[]` at runtime, `Vector<N>` in `contract.d.ts`), similarity operations such as `cosineDistance`, and a baseline migration that runs `CREATE EXTENSION IF NOT EXISTS vector` when the pack is composed into an application.
