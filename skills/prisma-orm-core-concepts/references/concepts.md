
# Prisma Next — Core Concepts

> **Edit your data contract. Prisma handles the rest.**

This reference carries the mental model behind Prisma 8 (Prisma Next): the structures, hierarchies, relationships, and workflows the CLI, the runtime, and the sibling skills all assume. It is not a CLI reference — commands appear only where a workflow needs them, and for flag-level detail on any individual command the authoritative source is the command itself, run with `--help`. Read the section the question is about; read the whole file when the user is orienting ("what is Prisma Next", "how does it compare to X").

## When to Use

- User asks *"what is Prisma Next / Prisma 8"*, *"how does it work"*, or compares it to another ORM (Drizzle, Kysely, TypeORM, classic Prisma).
- User asks what a contract, plan, marker, ref, capability, codec, extension, or middleware *is*.
- User asks why two files (`contract.json`, `contract.d.ts`) exist, or what emitting produces.
- User asks which CLI commands touch the database and which are offline.

## When Not to Use

- User wants to *do* something — edit the contract, write a query, wire `db.ts`, set up a project → the workflow references in this skill's routing table.
- User wants to plan, apply, or review a migration → the `prisma-orm-migrations` skill.
- User pasted an error envelope → [`failure-modes.md`](failure-modes.md).

## The contract and the schema

You author a **contract**: the description of the data your application needs — models, fields, relations, and their mapping onto tables or collections. It lives in `contract.prisma` (PSL, the canonical surface) or a TypeScript builder file. The **schema** is what the database actually has right now — the live tables and indexes. In Prisma 8, you author a contract, and the schema is what the database has:

- Queries are typed against the **contract**.
- Migrations move the **schema** toward the contract.
- Verification confirms the schema satisfies the contract.

The distinction is load-bearing: the contract can be ahead of the schema (you edited but haven't migrated), behind it (someone changed the database out-of-band), or in agreement. Every CLI diagnostic about "drift" is a statement about the two disagreeing.

## Emitting: from source to artifacts

**Emitting** is the build step: the CLI compiles the contract source into two plain files colocated with it:

- `contract.json` — the canonical, content-hashed Contract IR. Read by the migration planner, the runtime, and verification.
- `contract.d.ts` — the precise TypeScript types the runtime and query lanes propagate.

Every other part of the toolchain reads these artifacts, not your source file. Emission is deterministic — the same source produces the same artifacts — so both are committed to version control. The pair works like `package.json` and a lockfile: the source is what you asked for; the artifacts are the exact resolved result. Edit the source, never the artifacts.

## Hashes and the database marker

Every emitted contract has a content **hash** — a fingerprint that names that exact contract state. The database carries the complementary half: a **marker** (the docs also call it the database signature) — a small record stored in the database itself naming the contract hash the database currently satisfies. On Postgres it is a row in `prisma_contract.marker`; on Mongo, a document in `_prisma_migrations`. Signing writes the marker (after a schema verification passes); applying migrations or updates advances it.

The two sides verify each other: the runtime compares the contract hash against the marker before executing queries, and the migration runner checks the marker matches a migration's `from` hash before applying it. When contract and marker disagree, that state is **drift**, and verification is the diagnostic that reveals it.

## Queries compile to plans

A **plan** is the compiled form of a query: a plain data object holding the statement to run, its parameters, and metadata about what the query touches. Every query — whichever API authored it — becomes a plan before execution. The SQL builder shows this explicitly:

```typescript
const plan = db.sql.public.user
  .select('id', 'name')
  .where((f, fns) => fns.eq(f.active, true))
  .limit(10)
  .build();
const rows = await db.runtime().execute(plan);
```

Plans matter for two reasons: every query goes through the same execution pipeline, and a plan is *data* — it exists as an object before anything reaches the database, which is what lets middleware inspect, veto, or record it. Raw queries are still plans, so middleware and telemetry see them like any other query.

## The query APIs

All query surfaces are typed against the contract and all produce plans:

- **ORM client** (`db.orm`) — model-shaped queries and mutations; operations like `.include(...)` coordinate multiple queries. The default lane.
- **SQL builder** (`db.sql`, Postgres/SQLite) — composable joins, grouping, computed projections; raw SQL (`db.raw.sql`) as the escape hatch.
- **Pipeline builder** (`db.query.from(...)`, Mongo) — typed aggregation pipelines; raw commands as the escape hatch.

Raw results bypass codec decoding — values arrive as the driver returns them. Lane selection guidance lives in this skill's `references/queries.md`.

## The stack behind one package

A project installs **one façade package per target** — `@prisma/orm-postgres`, `@prisma/orm-sqlite`, or `@prisma/orm-mongo` — and user code imports only the façade subpaths (`@prisma/orm-postgres/config`, `@prisma/orm-postgres/runtime`, …). Behind the façade sit the layers: the database **family** (SQL or document), the **target** dialect (Postgres), the **adapter** (translates plans to the dialect), and the **driver** (holds the connection). The layering exists for extensibility — Prisma 8's core is small, and everything around it, Postgres support included, plugs in through the same public interfaces. Supporting a new database means new target, adapter, and driver implementations, not a fork of the core.

## Capabilities

A **capability** is a specific feature a database may or may not support — `RETURNING` clauses, lateral joins, vector indexes. The active adapter advertises its capabilities and they become part of the emitted contract; the typed query surface gates on them at authoring time, so a method that needs a missing capability (e.g. `.returning(...)` without the `returning` capability) does not typecheck. Extensions can add capabilities; they are enabled through `extensions: [...]` in `prisma.config.ts`, not by hand-editing a capability list.

## Codecs

A **codec** converts values between JavaScript and the database's wire format, in both directions. Every column type in the contract has one — a Postgres `timestamptz` column produces a JavaScript `Date` on read and encodes it back on write. Picking a column type in PSL is also picking the codec that handles every value the column carries. Extensions introduce codecs for new types; raw query results bypass codecs entirely.

## Extensions

An **extension** is an installable package that adds capability to the whole toolchain: new column types with their codecs, query operations, index kinds. Registered once in `prisma.config.ts`:

```typescript
import { definePrismaConfig } from '@prisma/cli-engine';
import pgvector from '@prisma/orm-extension-pgvector/control';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './src/prisma/contract.prisma',
    extensions: [pgvector],
    db: { connection: process.env.DATABASE_URL },
  }),
});
```

After registration the extension's types appear in the contract language (`pgvector.Vector(length: 1536)`), the emitted types, the query builders, and the planned migrations. Extension authoring and the available packs are covered in this skill's `references/contract.md`.

## Middleware

A **middleware** is a plain object with a name and one or more hooks that run around every query. Registered once in `db.ts`, it sees the structured plan object — so it can log, enforce limits, or reject before anything executes. Built-in middleware includes `lints` (blocks risky query shapes) and `budgets` (row/latency caps); a cache middleware ships as an extension package (`@prisma/orm-extension-middleware-cache`). Telemetry/logging is a small custom middleware you write yourself. Composition and custom middleware are covered in this skill's `references/runtime.md`.

## Migrations: a graph of contracts

A **migration** records how to move the schema between two contract states. Each is a package on disk: an editable `migration.ts`, compiled operations (`ops.json`), and a manifest recording the `from` and `to` contract hashes. Together they form a directed **graph** — contracts (by hash) are nodes, migrations are edges. A **ref** is a named pointer at a contract (`production`, `staging`), stored as a small committed file in the repository.

The git analogy holds up well:

| Git | Prisma 8 |
| --- | --- |
| Commit | Contract (by hash) |
| Patch | Migration |
| Branch / tag | Ref |
| HEAD | Database marker |
| `git checkout` | `db migrate --to` |

The full model — plan origins, refs, deploy review — is the `prisma-orm-migrations` skill.

## How CLI commands combine

One division governs the CLI: **`db ...` commands connect to a live database and can change it; `contract ...` and `migration ...` commands work on the files in your repository.** The one exception is `contract infer`, which reads a live database without modifying it.

The workflows compose from that division:

1. **Development** — `contract emit` → `migration plan --name <slug>` → `db migrate`.
2. **Prototyping** — `contract emit` → `db update --dry-run` → `db update` (no migration files; dev databases only).
3. **Adoption** — `contract infer` → review → `contract emit` → `db sign`.
4. **CI/CD** — `migration check` (offline artifact/graph integrity) → `migration status --to <ref> --db $URL` (read-only gate) → `db migrate --to <ref> --db $URL`.

The commands appear here only to show how they combine; each command's flags, modes, and exit codes are documented by the command itself — run it with `--help`.

## What Prisma Next doesn't do yet

Concept-level gaps a user orienting on the system tends to ask about — each with today's workaround, detailed in [`failure-modes.md`](failure-modes.md) § *What Prisma Next doesn't do yet*:

- **Studio / GUI database browser** — use the CLI's live-schema view or a third-party client.
- **`EXPLAIN` integration** — write the `EXPLAIN` as a raw query.
- **First-class query logger middleware** — write a small custom middleware.

To request any of these, route to this skill's `references/feedback.md`.

## Checklist

- [ ] Answered the orientation question from this file's model, then routed the *doing* to the matching workflow reference (or the `prisma-orm-migrations` skill).
- [ ] Kept the contract/schema distinction straight: contract = authored intent, schema = live database state.
- [ ] Did not present emitted artifacts (`contract.json`, `contract.d.ts`) as editable.
- [ ] Did not confabulate a capability toggle, Studio, or EXPLAIN API — named the gap and the workaround instead.
