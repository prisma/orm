# @prisma/orm-extension-paradedb

BM25 full-text search indexes for Prisma 8 on PostgreSQL, powered by [ParadeDB](https://paradedb.com).

> **From `8.0.0` this package has its own version number, starting at `0.1.0`.** A `0.x` version may change in any release. Until `8.0.0` every Prisma 8 package is published as a release candidate, `8.0.0-rc.N`. See [maturity levels](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#maturity-levels).

```bash
pnpm add @prisma/orm-extension-paradedb
```

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/pack` | the extension pack an application composes into `extensions: [...]` — pure, no runtime imports |
| `/index-types` | the `bm25` index type and its option shape |
| `/operation-types` | types emitted contracts reference |
| `/runtime` | the runtime extension |
| `/control` | the control descriptor |

## Responsibilities

Registers a `bm25` entry with the SQL family's index-type registry, so contracts author full-text indexes through the ordinary `constraints.index(...)` surface and the Postgres adapter emits `CREATE INDEX ... USING bm25 WITH (...)`. It also declares the `paradedb/bm25` capability for contract-level feature detection.

The current surface covers the `key_field` storage parameter. Per-field tokenizer configuration waits on expression-index support.
