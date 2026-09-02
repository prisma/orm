---
name: prisma-orm-core-concepts
description: >-
  Use whenever working with Prisma 8 (Prisma Next) — writing queries, editing
  the schema / data contract, running prisma CLI commands, wiring the runtime,
  debugging errors, or otherwise developing against the database. Does not
  apply to Prisma ORM 7 or earlier (schema.prisma + @prisma/client projects).
metadata:
  library: '@prisma/orm-postgres'
  library_version: '8.0.0-rc.8'
---

# Prisma Next (Prisma 8)

> **Edit your data contract. Prisma handles the rest.**

Prisma 8 moves fast, and your training data about it is very likely outdated. This skill ships inside the installed Prisma packages, so it describes the exact version this project has — treat it and its reference files as the source of truth, over anything you remember about Prisma. If `metadata.library_version` in this file's frontmatter does not match the project's installed Prisma packages, run `prisma skills sync` and re-read. Additional documentation for the wider Prisma platform lives at <https://www.prisma.io/docs>.

This skill routes every Prisma Next task to the right reference file — open the reference before writing code; do not answer from this file alone. The references teach concepts, structures, and workflows, not the full CLI surface: for flag-level detail on any individual command, run it with `--help`.

## The canonical model (one paragraph)

You author a **data contract** (a `contract.prisma` file, or a TypeScript builder). The framework emits machine-readable artifacts (`contract.json`, `contract.d.ts`) and gives you two runtime surfaces on SQL targets: a typed SQL query builder (`db.sql.<ns>.<table>`) and a typed ORM client (`db.orm.<ns>.<Model>`). On MongoDB targets only the ORM lane exists, and its keys are collection storage names (`db.orm.users`) rather than PSL model names — [`references/queries.md`](references/queries.md) § *MongoDB ORM addressing* covers the rule. Every query compiles to a **plan** before execution, and the database carries a **marker** naming the contract hash it satisfies. Migrations are planned from the contract diff; the `prisma-orm-migrations` skill owns that flow.

Three steps the user does:

1. **Edit your data contract.** ([`references/contract.md`](references/contract.md))
2. **The system plans the migrations for you.** (`prisma-orm-migrations` skill)
3. **If you need data migrations, you edit `migration.ts` and execute it.** (`prisma-orm-migrations` skill)

Everything else — queries, runtime wiring, build integration, upgrades, debugging, feedback — sits on top of those three.

## Routing table

Open the reference whose triggers match the task. If more than one matches, open each — they are written to compose.

| Task | Reference | Triggers |
| --- | --- | --- |
| Understand the system | [`references/concepts.md`](references/concepts.md) | "what is Prisma Next / Prisma 8", "how does it work", comparisons to Drizzle / Kysely / TypeORM / classic Prisma, contract vs schema, emit / artifacts, hashes, marker / database signature, plans, query lanes, façade / family / target / adapter / driver layering, capabilities, codecs, extensions, middleware, migration-graph analogy, which commands are offline vs touch the database |
| Diagnose a failure | [`references/failure-modes.md`](references/failure-modes.md) | any structured error envelope (code, domain, severity, why, fix, meta), emit failed, query won't typecheck, query crashed, migration won't apply, `BUDGET.ROWS_EXCEEDED`, `BUDGET.TIME_EXCEEDED`, `RUNTIME.ABORTED`, `PLAN.HASH_MISMATCH`, `CONTRACT.MARKER_MISSING`, PN-RUN-* / PN-MIG-* / PN-CLI-* / PN-SCHEMA-* codes, drift, capability missing, planner conflict, EXPLAIN, query log, script won't exit / close connection |
| Adopt / set up / first steps | [`references/quickstart.md`](references/quickstart.md) | new project, existing database, "what can I do with Prisma Next", "where do I start", "just ran createprisma", `npx create-prisma`, first steps, first query, `prisma orm init` greenfield setup, `contract infer` + `db sign` brownfield adoption, connect-write-read first arc, day-to-day commands (`contract emit`, `db init`, `db update`, `migration plan`, `db migrate`, `db schema`, `db verify`), flags `--target` / `--authoring` / `--schema-path` / `--probe-db` / `--output` |
| Edit the data contract | [`references/contract.md`](references/contract.md) | schema, models, fields, attributes, relations, indexes, enums, value objects (composite types), type aliases, namespaces (Postgres schemas), cross-contract foreign keys (cross-space FK), polymorphic types (`@@discriminator` / `@@base`), extension namespaces (`pgvector.Vector(...)`, `cipherstash.EncryptedString(...)`), `prisma.config.ts` / `defineConfig`, `prisma contract emit`, PSL, `contract.prisma`, `contract.ts`, `contract.json`, `contract.d.ts`, `@prisma/orm-postgres/config`, `@prisma/orm-postgres/contract-builder`, `@prisma/orm-mongo/config`, `extensions:`, pgvector, cipherstash, postgis, paradedb, `@@control`, control policy (managed / tolerated / external / observed), soft delete, validations, callbacks |
| Write queries | [`references/queries.md`](references/queries.md) | query, where, select, project, orderBy, limit, offset, take, skip, include, lookup, first, all, count, aggregate, groupBy, create, update, delete, upsert, returning, transaction, `db.orm`, `db.sql`, `db.query.from(...)` (Mongo pipeline), namespace-aware accessors, `.all()` Thenable, single-use iterators (`RUNTIME.ITERATOR_CONSUMED`), target-declared aggregate types (`count`, integer `sum`, and integer `avg` are `number`; `count` and integer `sum` throw outside ±(2^53 − 1) rather than round, while `avg` is a fraction already and carries no guard; `countBigInt` / `sumBigInt` / `avgDecimal` are the lossless forms, `avgDecimal` on PostgreSQL only), drizzle-style, kysely-style. Postgres/SQLite specifics: [`references/queries-postgres.md`](references/queries-postgres.md); Mongo specifics: [`references/queries-mongo.md`](references/queries-mongo.md) |
| Wire the runtime | [`references/runtime.md`](references/runtime.md) | `db.ts`, `postgres<Contract>(...)` / `sqlite<Contract>(...)` / `mongo<Contract>(...)` façades, middleware composition (telemetry, lints, budgets), `DATABASE_URL`, `.env`, connection pool / `poolOptions`, dev vs prod config, transactions, read replicas, multi-database, script won't exit / hangs, `db.close` / `pool.end`, `await using` / `[Symbol.asyncDispose]` |
| Build-tool integration | [`references/build.md`](references/build.md) | Vite plugin (`@prisma/orm-postgres/vite-plugin-contract-emit`, Vite 7/8), `vite.config.ts`, contract emit on save, HMR / dev server, Next.js / Webpack / esbuild / Rollup / Turbopack (named gaps, not fabricated) |
| Supabase | [`references/supabase.md`](references/supabase.md) | `@prisma/orm-extension-supabase`, RLS, row level security, policies (`policy_select` / `policy_update` / `@@rls`, `auth.uid()`), role binding (`asUser(jwt)` / `asAnon()` / `asServiceRole()`), `auth.users`, cross-space FKs to `supabase:auth.AuthUser`, JWT / JWKS (`SUPABASE_JWKS_URL`, `SUPABASE_JWT_SECRET`), `SUPABASE.JWT_INVALID`, `SUPABASE.CONFIG_INVALID`, `RoleBoundDb`, session pooler |
| Upgrade Prisma in an app | [`references/upgrade-app.md`](references/upgrade-app.md) | "upgrade Prisma", "upgrade Prisma Next", "bump Prisma Next", "move to Prisma Next X.Y", `@prisma/orm-*` version bump in an application, per-transition upgrade instructions in [`upgrading/app/upgrades/`](upgrading/app/upgrades/), extension-pin pre-flight, `PN-UPGRADE-*` |
| Upgrade Prisma in an extension | [`references/upgrade-extension.md`](references/upgrade-extension.md) | the same request in a package that *is* a Prisma extension (framework SPI dependency, `^@.*/extension-` name), `prisma-8-check-pins`, exact-pin rule, per-transition instructions in [`upgrading/extension/upgrades/`](upgrading/extension/upgrades/) |
| File feedback / ask the team | [`references/feedback.md`](references/feedback.md) | bug report, file an issue, feature request, missing feature, capability gap, "this is broken", surprising behaviour, Q&A / design discussion, ask the Prisma team, Prisma Discord (pris.ly/discord), extension-author questions |

## Routing rules

If the task clearly matches a row, open that reference directly without asking.

For a vague prompt, ask **one** disambiguating question. Pick from:

- *"Are you new to Prisma Next and asking what you can do with it, or where to start?"* → [`references/quickstart.md`](references/quickstart.md) (first-touch orientation path).
- *"Do you want to set up a new Prisma Next project, or wire it into an existing database?"* → [`references/quickstart.md`](references/quickstart.md).
- *"Do you want to edit your data contract (add a model / field / relation), or work with the database (migrations, queries)?"* → [`references/contract.md`](references/contract.md) vs the others.
- *"Is this about wiring Prisma Next into your build tool (Vite / Next.js / …), or about wiring `db.ts` and middleware at runtime?"* → [`references/build.md`](references/build.md) vs [`references/runtime.md`](references/runtime.md).
- *"What error or symptom are you seeing?"* → [`references/failure-modes.md`](references/failure-modes.md).
- *"Do you want to report this as a bug to the Prisma Next team, or is this a feature request?"* → [`references/feedback.md`](references/feedback.md).
- *"Is the project you want to upgrade an application, or a Prisma extension package?"* → [`references/upgrade-app.md`](references/upgrade-app.md) vs [`references/upgrade-extension.md`](references/upgrade-extension.md).

If you still can't tell which reference applies, ask the user what they want to do. Do not guess.

## Related skills

Planning, authoring, reviewing, or applying migrations — `db update`, `migration plan`, `db migrate`, refs, deploy review, `MIGRATION.*` codes — is owned by the sibling `prisma-orm-migrations` skill; the two install together.

## Checklist

- [ ] If the task matches a routing-table row, open that reference before writing code.
- [ ] If the prompt is vague, ask one disambiguating question.
- [ ] Do not attempt to answer from this file alone — the references carry the verified tool surface.
- [ ] If the user describes a missing feature or a misbehaviour they want fixed, open [`references/feedback.md`](references/feedback.md).
- [ ] If the task is migration planning / applying / review, route to `prisma-orm-migrations`.
