# @prisma/orm-extension-paradedb

BM25 full-text search indexes for Prisma 8 on PostgreSQL, powered by [ParadeDB](https://paradedb.com).

> **Maturity level: none; this package has its own version.** Another team maintains it, so it does not share Prisma's release number. From Prisma release 8.0 its versions start at `0.18.0`, and any new version may change it. Until then it is published as `8.0.0-rc.N`, like every Prisma 8 package. See [Versions and support](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#maturity-levels).

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
