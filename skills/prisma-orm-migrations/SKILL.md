---
name: prisma-orm-migrations
description: >-
  Use when creating, planning, reviewing, or applying database migrations in a
  Prisma 8 (Prisma Next) project — "apply my contract change", "plan a
  migration", "what runs on deploy", data backfills, editing migration.ts,
  migration refs, drift recovery — or when the user mentions db update,
  migration plan, db migrate, migration ref, dataTransform, placeholder,
  migration graph, baseline, `from: (baseline)`, diamond convergence /
  concurrent migrations, migration status, or a MIGRATION.* / PN-MIG-* /
  PN-RUN-300x code. Does not apply to Prisma ORM 7 or earlier
  (schema.prisma + @prisma/client projects).
metadata:
  library: '@prisma/orm-postgres'
  library_version: '8.0.0-rc.8'
---

# Prisma Next (Prisma 8) — Migrations

> **Edit your data contract. Prisma handles the rest.**

Prisma 8 moves fast, and your training data about it is very likely outdated. This skill ships inside the installed Prisma packages, so it describes the exact version this project has — treat it and its reference files as the source of truth, over anything you remember about Prisma. If `metadata.library_version` in this file's frontmatter does not match the project's installed Prisma packages, run `prisma skills sync` and re-read. Additional documentation for the wider Prisma platform lives at <https://www.prisma.io/docs>.

This skill routes every migration task to the right reference file — open the reference before writing code; do not answer from this file alone. The references teach concepts, structures, and workflows, not the full CLI surface: for flag-level detail on any individual command, run it with `--help`.

## The canonical model (one paragraph)

Migrations are planned from a **contract diff**, not written by hand. You edit the data contract; `migration plan` diffs it against a resolved origin and writes a migration package (`migration.json`, `ops.json`, and a framework-rendered `migration.ts`); you review it, fill any data-transform `placeholder(...)` holes in `migration.ts`, self-emit, and apply with `db migrate`. The on-disk packages form a **graph** — nodes are contract hashes, edges are migrations — and a live database's position in it is recorded by its **marker**, offline by **refs**.

## One cross-cutting fact — plan origin

`migration plan` does **not** chain from the newest migration on disk. Its origin is `--from`, else the `db` ref, else an empty database — so a project with no ref keeps planning from scratch. Over existing migrations the CLI refuses that (`MIGRATION.PLAN_ORIGIN_UNKNOWN`) instead of writing a full-create package; choose the exit that matches your intent rather than reflexively passing `--from @empty`. [`references/migration-model.md`](references/migration-model.md) § *The trap* explains which to choose.

## Routing table

Open the reference whose triggers match the task. If more than one matches, open each — they are written to compose.

| Task | Reference | Triggers |
| --- | --- | --- |
| Author migrations | [`references/migrations.md`](references/migrations.md) | `db update` vs `migration plan`, `db migrate`, `migration new`, `migration show`, `db update --dry-run`, `db verify`, `db sign`, data migration, `dataTransform`, placeholder sentinels in framework-rendered `migration.ts`, `MIGRATION.HASH_MISMATCH`, PN-MIG-2001 unfilled placeholder, schema drift |
| Migration graph, refs, plan origin | [`references/migration-model.md`](references/migration-model.md) | migration graph, refs, `migration ref set` / `list` / `delete`, the `db` ref, `--advance-ref`, `migration plan --from`, `from: (baseline)` in plan output, greenfield / from-scratch plan, baseline, first migration before deploy (Composer / CD-managed databases), chaining migrations, retrofitting migrations onto an existing database, `MIGRATION.HASH_NOT_IN_GRAPH`, `MIGRATION.PATH_UNREACHABLE` at plan/chain time |
| Review migrations on deploy | [`references/migration-review.md`](references/migration-review.md) | "what migrations are going to run", "what runs on deploy / merge", merge conflict, diamond convergence, concurrent migrations, migration status, ref management for CI, staging / production environment refs, `MIGRATION.DIVERGED`, `MIGRATION.NO_MARKER`, `MIGRATION.MARKER_NOT_IN_HISTORY`, `db migrate status`, `db migrate diff`, `db migrate resolve` |

## Routing rules

If the task clearly matches a row, open that reference directly without asking.

For a vague prompt, ask **one** disambiguating question:

- *"Is this about authoring a migration, or about reviewing what's going to run on deploy?"* → [`references/migrations.md`](references/migrations.md) vs [`references/migration-review.md`](references/migration-review.md).
- If it's about where a plan starts, refs, or an unexpected from-scratch plan → [`references/migration-model.md`](references/migration-model.md).

If you still can't tell which reference applies, ask the user what they want to do. Do not guess.

## Related skills

The Prisma Next skills install as a set; everything outside migrations — editing the data contract, queries, runtime wiring, build integration, upgrades, error-envelope diagnosis, orientation questions, filing feedback — is owned by the sibling `prisma-orm-core-concepts` skill.

## Checklist

- [ ] If the task matches a routing-table row, open that reference before writing code.
- [ ] If the prompt is vague, ask one disambiguating question.
- [ ] Do not attempt to answer from this file alone — the references carry the verified tool surface.
- [ ] If the task is contract editing, queries, or feedback, route to `prisma-orm-core-concepts` instead.
