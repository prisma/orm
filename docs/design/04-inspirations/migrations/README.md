# Migration system inspirations

Research and takeaways from how established systems approach the migration problem. Each summary captures the system's mental model, vocabulary, and CLI surface, then surfaces what is genuinely novel about it. The synthesis at the top of the directory cross-cuts the per-system summaries to pull out conventions worth borrowing, points of genuine disagreement, and patterns that don't fit a graph-shaped migration model.

The Prisma 8 migration domain model in [`../../10-domains/migration/`](../../10-domains/migration/) builds on the verdicts in the synthesis: which conventions to adopt, which to diverge from with reasoning, and which to avoid by name.

## Contents

| Document | One-line summary | What we took |
|---|---|---|
| [`established-conventions.md`](./established-conventions.md) | Cross-system synthesis: ActiveRecord, Liquibase, Django, Sqitch, Atlas, Prisma 5/6. Verdict table at the end. | The shape of the adopt / diverge / avoid table that drove the domain model's vocabulary choices. |
| [`atlas.md`](./atlas.md) | Atlas: declarative + versioned workflows; URL-typed sources; integrity manifest (`atlas.sum`); explicit "desired state" / "current state" framing. | The "desired state" / "current state" prose anchor; the `check` verb naming for pre-migration integrity. (Atlas's shadow-DB-backed dev database was ultimately rejected wholesale: diffing is fully offline against on-disk snapshots, and no shadow database will ever exist.) |
| [`active-record.md`](./active-record.md) | Rails Active Record: timestamp-ordered file-backed Ruby classes; numeric-version identity; `schema_migrations` ledger; `change` body with auto-inverse. | The hazard model for unhashed file-based identity (motivates our `migrationHash`); the schema-dump-as-rebuild-source distinction (motivates our marker-vs-ledger split). |

## What's deliberately not here

- **Liquibase, Django, Sqitch, Prisma 5/6.** Their characteristics show up in the cross-system synthesis but each system did not get a dedicated per-system file. The synthesis is the primary artifact; the per-system files (Atlas, Active Record) are the two we leaned on most heavily for direct vocabulary borrowing.
- **Vendor-neutral schema-migration literature.** This directory is concrete-system research, not a literature review.
