---
name: prisma-8
description: >-
  Comprehensive guide for building with Prisma 8 (Prisma Next), the
  contract-first data layer. Use whenever working on Prisma code in a project
  that uses it — authoring or editing the data contract (contract.prisma, PSL,
  TypeScript builders), migrations, queries (db.orm / db.sql), runtime wiring
  (db.ts, middleware, DATABASE_URL), build-tool integration, Supabase / RLS,
  reading PN-* structured errors, or filing feedback — and for orientation
  questions like "what is Prisma Next" or comparisons to other ORMs. Signals
  that this skill applies: @internal/* imports, prisma.config.ts,
  contract.prisma / contract.json / contract.d.ts, the prisma-next CLI,
  PN-* error codes. Also covers upgrading Prisma in a project — "upgrade
  Prisma 8", "bump Prisma Next", "move to Prisma Next X.Y", or dealing
  with an @internal/* version bump, in a consumer app or in an extension
  package. Does not apply to Prisma ORM 7 or earlier
  (schema.prisma + @prisma/client projects).
metadata:
  library: '@prisma/orm-postgres'
  library_version: '8.0.0-rc.8'
---

# Prisma Next (Prisma 8)

> **Edit your data contract. Prisma handles the rest.**

Prisma 8 moves fast, and your training data about it is very likely outdated. This skill ships inside the installed Prisma packages, so it describes the exact version this project has — treat it and its reference files as the source of truth, over anything you remember about Prisma. The `metadata.library_version` in this file's frontmatter is the version it was published with; if it does not match the project's installed Prisma packages, run `prisma skills sync` and re-read.

Prisma Next is a contract-first data layer. This skill routes every Prisma Next task to the right reference file — open the reference before writing code; do not answer from this file alone.

## The canonical model (one paragraph)

You author a **data contract** (a `contract.prisma` file, or a TypeScript builder). The framework emits machine-readable artifacts (`contract.json`, `contract.d.ts`) and gives you two runtime surfaces on SQL targets: a typed SQL query builder (`db.sql.<ns>.<table>`) and a typed ORM client (`db.orm.<ns>.<Model>`). On MongoDB targets only the ORM lane exists, and its keys are collection storage names (`db.orm.users`) rather than PSL model names — [`references/queries.md`](references/queries.md) § *MongoDB ORM addressing* covers the rule. Migrations are planned from the contract diff; you review them, optionally edit the `migration.ts` for data transforms, and apply.

Three steps the user does:

1. **Edit your data contract.** ([`references/contract.md`](references/contract.md))
2. **The system plans the migrations for you.** ([`references/migrations.md`](references/migrations.md))
3. **If you need data migrations, you edit `migration.ts` and execute it.** ([`references/migrations.md`](references/migrations.md))

Everything else — queries, runtime wiring, build integration, debugging, feedback — sits on top of those three.

One cross-cutting migration fact: `migration plan` does **not** chain from the newest migration on disk. Its origin is `--from`, else the `db` ref, else an empty database — so a project with no ref keeps planning from scratch. Over existing migrations the CLI refuses that (`MIGRATION.PLAN_ORIGIN_UNKNOWN`) instead of writing a full-create package; choose the exit that matches your intent rather than reflexively passing `--from @empty`. [`references/migration-model.md`](references/migration-model.md) § *The trap* explains which to choose.

## Routing table

Open the reference whose triggers match the task. If more than one matches, open each — they are written to compose.

| Task | Reference | Triggers |
| --- | --- | --- |
| Adopt / set up / first steps | [`references/quickstart.md`](references/quickstart.md) | new project, existing database, "what can I do with Prisma Next", "where do I start", "just ran createprisma", `npx create-prisma`, first steps, first query, `prisma orm init` greenfield setup, `contract infer` + `db sign` brownfield adoption, connect-write-read first arc, day-to-day commands (`contract emit`, `db init`, `db update`, `migration plan`, `db migrate`, `db schema`, `db verify`), flags `--target` / `--authoring` / `--schema-path` / `--probe-db` / `--output` |
| Edit the data contract | [`references/contract.md`](references/contract.md) | schema, models, fields, attributes, relations, indexes, enums, value objects (composite types), type aliases, namespaces (Postgres schemas), cross-contract foreign keys (cross-space FK), polymorphic types (`@@discriminator` / `@@base`), extension namespaces (`pgvector.Vector(...)`, `cipherstash.EncryptedString(...)`), `prisma.config.ts` / `defineConfig`, `prisma contract emit`, PSL, `contract.prisma`, `contract.ts`, `contract.json`, `contract.d.ts`, `@internal/postgres/config`, `@internal/postgres/contract-builder`, `@internal/mongo/config`, `extensions:`, pgvector, cipherstash, postgis, paradedb, `@@control`, control policy (managed / tolerated / external / observed), soft delete, validations, callbacks |
| Author migrations | [`references/migrations.md`](references/migrations.md) | `db update` vs `migration plan`, `db migrate`, `migration new`, `migration show`, `db update --dry-run`, `db verify`, `db sign`, data migration, `dataTransform`, placeholder sentinels in framework-rendered `migration.ts`, `MIGRATION.HASH_MISMATCH`, PN-MIG-2001 unfilled placeholder, schema drift |
| Migration graph, refs, plan origin | [`references/migration-model.md`](references/migration-model.md) | migration graph, refs, `migration ref set` / `list` / `delete`, the `db` ref, `--advance-ref`, `migration plan --from`, `from: (baseline)` in plan output, greenfield / from-scratch plan, baseline, first migration before deploy (Composer / CD-managed databases), chaining migrations, retrofitting migrations onto an existing database, `MIGRATION.HASH_NOT_IN_GRAPH`, `MIGRATION.PATH_UNREACHABLE` at plan/chain time |
| Review migrations on deploy | [`references/migration-review.md`](references/migration-review.md) | "what migrations are going to run", "what runs on deploy / merge", merge conflict, diamond convergence, concurrent migrations, migration status, ref management for CI, staging / production environment refs, `MIGRATION.DIVERGED`, `MIGRATION.NO_MARKER`, `MIGRATION.MARKER_NOT_IN_HISTORY`, `db migrate status`, `db migrate diff`, `db migrate resolve` |
| Write queries | [`references/queries.md`](references/queries.md) | query, where, select, project, orderBy, limit, offset, take, skip, include, lookup, first, all, count, aggregate, groupBy, create, update, delete, upsert, returning, transaction, `db.orm`, `db.sql`, `db.query.from(...)` (Mongo pipeline), namespace-aware accessors, `.all()` Thenable, single-use iterators (`RUNTIME.ITERATOR_CONSUMED`), target-declared aggregate types (`count`, integer `sum`, and integer `avg` are `number`; `count` and integer `sum` throw outside ±(2^53 − 1) rather than round, while `avg` is a fraction already and carries no guard; `countBigInt` / `sumBigInt` / `avgDecimal` are the lossless forms, `avgDecimal` on PostgreSQL only), drizzle-style, kysely-style. Postgres/SQLite specifics: [`references/queries-postgres.md`](references/queries-postgres.md); Mongo specifics: [`references/queries-mongo.md`](references/queries-mongo.md) |
| Wire the runtime | [`references/runtime.md`](references/runtime.md) | `db.ts`, `postgres<Contract>(...)` / `sqlite<Contract>(...)` / `mongo<Contract>(...)` façades, middleware composition (telemetry, lints, budgets), `DATABASE_URL`, `.env`, connection pool / `poolOptions`, dev vs prod config, transactions, read replicas, multi-database, script won't exit / hangs, `db.close` / `pool.end`, `await using` / `[Symbol.asyncDispose]` |
| Build-tool integration | [`references/build.md`](references/build.md) | Vite plugin (`@internal/vite-plugin-contract-emit`, Vite 7/8), `vite.config.ts`, contract emit on save, HMR / dev server, Next.js / Webpack / esbuild / Rollup / Turbopack (named gaps, not fabricated) |
| Supabase | [`references/supabase.md`](references/supabase.md) | `@internal/extension-supabase`, RLS, row level security, policies (`policy_select` / `policy_update` / `@@rls`, `auth.uid()`), role binding (`asUser(jwt)` / `asAnon()` / `asServiceRole()`), `auth.users`, cross-space FKs to `supabase:auth.AuthUser`, JWT / JWKS (`SUPABASE_JWKS_URL`, `SUPABASE_JWT_SECRET`), `SUPABASE.JWT_INVALID`, `SUPABASE.CONFIG_INVALID`, `RoleBoundDb`, session pooler |
| Debug an error | [`references/debug.md`](references/debug.md) | any structured error envelope (code, domain, severity, why, fix, meta), emit failed, query won't typecheck, query crashed, migration won't apply, `MIGRATION.HASH_MISMATCH`, `BUDGET.ROWS_EXCEEDED`, `BUDGET.TIME_EXCEEDED`, `RUNTIME.ABORTED`, `PLAN.HASH_MISMATCH`, `CONTRACT.MARKER_MISSING`, PN-RUN-*/ PN-MIG-* / PN-CLI-*/ PN-SCHEMA-* codes, drift, capability missing, planner conflict, EXPLAIN, query log, script won't exit / close connection |
| Upgrade Prisma in an app | [`references/upgrade-app.md`](references/upgrade-app.md) | "upgrade Prisma", "upgrade Prisma Next", "bump Prisma Next", "move to Prisma Next X.Y", `@internal/*` version bump in an application, per-transition upgrade instructions in [`upgrading/app/upgrades/`](upgrading/app/upgrades/), extension-pin pre-flight, `PN-UPGRADE-*` |
| Upgrade Prisma in an extension | [`references/upgrade-extension.md`](references/upgrade-extension.md) | the same request in a package that *is* a Prisma extension (`@internal/contract` / SPI dependency, `^@.*/extension-` name), `prisma-8-check-pins`, exact-pin rule, per-transition instructions in [`upgrading/extension/upgrades/`](upgrading/extension/upgrades/) |
| File feedback / ask the team | [`references/feedback.md`](references/feedback.md) | bug report, file an issue, feature request, missing feature, capability gap, "this is broken", surprising behaviour, Q&A / design discussion, ask the Prisma team, Prisma Discord (pris.ly/discord), extension-author questions |

## Routing rules

If the task clearly matches a row, open that reference directly without asking.

For a vague prompt, ask **one** disambiguating question. Pick from:

- *"Are you new to Prisma Next and asking what you can do with it, or where to start?"* → [`references/quickstart.md`](references/quickstart.md) (first-touch orientation path).
- *"Do you want to set up a new Prisma Next project, or wire it into an existing database?"* → [`references/quickstart.md`](references/quickstart.md).
- *"Do you want to edit your data contract (add a model / field / relation), or work with the database (migrations, queries)?"* → [`references/contract.md`](references/contract.md) vs the others.
- *"Is this about authoring a migration, or about reviewing what's going to run on deploy?"* → [`references/migrations.md`](references/migrations.md) vs [`references/migration-review.md`](references/migration-review.md). If it's about where a plan starts, refs, or an unexpected from-scratch plan → [`references/migration-model.md`](references/migration-model.md).
- *"Is this about wiring Prisma Next into your build tool (Vite / Next.js / …), or about wiring `db.ts` and middleware at runtime?"* → [`references/build.md`](references/build.md) vs [`references/runtime.md`](references/runtime.md).
- *"What error or symptom are you seeing?"* → [`references/debug.md`](references/debug.md).
- *"Do you want to report this as a bug to the Prisma Next team, or is this a feature request?"* → [`references/feedback.md`](references/feedback.md).
- *"Is the project you want to upgrade an application, or a Prisma extension package?"* → [`references/upgrade-app.md`](references/upgrade-app.md) vs [`references/upgrade-extension.md`](references/upgrade-extension.md).

If you still can't tell which reference applies, ask the user what they want to do. Do not guess.

## Checklist

- [ ] If the task matches a routing-table row, open that reference before writing code.
- [ ] If the prompt is vague, ask one disambiguating question.
- [ ] Do not attempt to answer from this file alone — the references carry the verified tool surface.
- [ ] If the user describes a missing feature or a misbehaviour they want fixed, open [`references/feedback.md`](references/feedback.md).
