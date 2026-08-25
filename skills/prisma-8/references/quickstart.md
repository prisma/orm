
# Prisma Next — Quickstart (Adoption)

> **Edit your data contract. Prisma handles the rest.**

This skill takes the user from zero (or near-zero) to a first working query against Prisma Next. Three paths — and they all converge on the same first arc: **connect → write → read**. Schema editing comes *after* the first arc, not before.

- **First-touch orientation** — the user has arrived at a Prisma Next project for the first time (a scaffold tool like `npx createprisma` dropped them in, they cloned a teammate's repo, or they ran `prisma orm init` themselves and now want to make their first move) and they're asking *"what can I do with Prisma Next?"*, *"where do I start?"*, or *"what's next?"*. The goal is to anchor them on the contract, get them connected to a database, round-trip one row, and let further commands surface organically.
- **Greenfield** — new project, fresh database. User runs `prisma orm init` themselves. `init` seeds a starter contract with a sample model, so the path joins the first-touch orientation arc as soon as the database is initialised.
- **Brownfield-DB** — existing database, no contract yet. Infer the contract from the database with `contract infer`, sign the marker with `db sign`, then write queries against one of the existing tables.

This skill does **not** cover migrating from another ORM (Drizzle, Prisma 6/7, Sequelize, TypeORM, Kysely, Knex, raw drivers). Those are separately-installable skills.

## When to Use

- User asks *"what can I do with Prisma Next?"*, *"what can I do next with Prisma?"*, *"where do I start?"*, *"what should I do first?"* — and a PN project already exists on disk. **First-touch orientation** path below.
- User just ran `createprisma` (or equivalent scaffold tool) and is asking what to do next. **First-touch orientation** path.
- User is starting a new project and wants to use Prisma Next. **Greenfield** path.
- User has an existing database (no PN contract) and wants to introduce PN. **Brownfield-DB** path.
- User typed *"prisma orm init"*, *"get started with PN"*, *"set up PN"*, *"how do I scaffold a project"*. **Greenfield** path.
- User says *"I have an existing Postgres/Mongo, how do I start using PN?"*. **Brownfield-DB** path.

## When Not to Use

- User already has a PN project and wants to add a model → `references/contract.md`.
- User wants to migrate FROM a specific ORM → install `@internal/migrate-from-<orm>-skill` (separate).
- User wants to wire `db.ts` in a project that already has a contract → `references/runtime.md`.
- User wants to integrate Prisma Next with a build tool (Vite plugin, Next.js, …) → `references/build.md`.

## Key Concepts

- **Contract**: the data model. Authored as `contract.prisma` (PSL, the canonical surface) or `contract.ts` (TypeScript builder). The framework reads it and emits two artefacts: `contract.json` (runtime IR) and `contract.d.ts` (types).
- **Target**: the backing store. Today: `postgres` or `mongodb`. Picked at `init` time; baked into the `@internal/<target>` façade the scaffold imports from.
- **Authoring mode**: how you write the contract. `psl` (Prisma Schema Language, default) or `typescript` (programmatic builder, optionally paired with the Vite plugin for auto-emit during `vite dev` — see `references/build.md`).
- **Façade packages.** The scaffold installs exactly one façade per target — `@internal/postgres` (or `@internal/mongo`). User code imports from façade subpaths (`@internal/postgres/config`, `@internal/postgres/runtime`, `@internal/postgres/contract-builder`). The façade bakes in the family / target / adapter / driver wiring; never reach past it. See `references/contract.md` for the full list.
- **`db.ts`**: the runtime entry point. Lives next to the contract source at `src/prisma/db.ts`. Imports the contract artefacts and exports a `db` value the rest of the app uses.
- **Marker**: a `pn_meta_marker` row in your database that records the contract hash. Lets PN detect drift between contract and live DB. Created by `db init` (greenfield / first-touch orientation) or `db sign` (brownfield).

### Canonical on-disk layout

Every application that consumes Prisma Next uses the same shape:

```text
<app-root>/
├── prisma.config.ts             ← project config at repo root
├── src/
│   └── prisma/
│       ├── contract.prisma           ← (or contract.ts) — schema source you author
│       ├── contract.json             ← emitted by `contract emit` — do not edit
│       ├── contract.d.ts             ← emitted by `contract emit` — do not edit
│       └── db.ts                     ← runtime entry; the rest of `src/` imports from here
└── migrations/
    ├── snapshots/                    ← content-addressed contract store, shared across spaces
    │   └── <hex>/
    │       ├── contract.json
    │       └── contract.d.ts
    └── app/                          ← created on first `migration plan` / `db init`
        ├── refs/db.json
        └── <timestamp>_<slug>/
            ├── migration.json
            ├── ops.json
            └── migration.ts
```

Three things to internalise:

- **`src/prisma/` is the home for the contract** — source + emitted artefacts + `db.ts` all colocated. The rest of `src/` imports from `./prisma/db` (or `../prisma/db`, depending on file depth).
- **`migrations/app/`** — the `app/` segment is the consuming application's space-id. Extensions you depend on get sibling directories under `migrations/` (one per extension contract-space), but you don't write into those — only the `app/` subtree is your migrations.
- **`prisma.config.ts` lives at the repo root**, not under `src/`. Every command resolves paths relative to the config's directory.

**Contributors building extension packages or aggregate-root monorepo packages use a different layout** — `src/contract.{prisma,ts}` (no `prisma/` subdir) + `migrations/<timestamp>_<slug>/` (no `app/` segment). That distinction is intentional; see `references/contract.md` for which path applies to you.

> **Heads up — `prisma orm init` currently scaffolds the wrong layout.** It writes `prisma/contract.{prisma,ts}` and `prisma/db.ts` at the repo root instead of under `src/prisma/`. Tracked as [TML-2532](https://linear.app/prisma-company/issue/TML-2532). Until the fix lands, either pass `--schema-path src/prisma/contract.prisma` to `init`, or move the scaffolded `prisma/` directory into `src/prisma/` after `init` and update the `contract` path in `prisma.config.ts` to match. The canonical layout above is what the demo example uses and what the rest of the framework expects.

## Your first arc — connect, write, read

All three paths in this skill converge here. Once the project is scaffolded and the database is reachable, the first move is **always** the same: connect, write a row, read it back, against whatever model the contract already declares. Don't touch the contract source on this first move — extend it later, after the round-trip works.

Write the snippet in a fresh file directly under `src/` (e.g. `src/first-arc.ts`) so the relative import resolves to one level deep:

```typescript
// src/first-arc.ts
import 'dotenv/config';
import { db } from './prisma/db';

// Write a row against the starter model. Adapt the field names to whatever
// model your contract source actually declares — read it first.
await db.orm.User.create({ email: 'alice@example.com' });

// Read it back.
const users = await db.orm.User.select('id', 'email').all();
console.log(users);
```

If that prints `[{ id: 1, email: 'alice@example.com' }]`, the project is wired end-to-end and the user has crossed from *"I have a project"* to *"I'm building."*

`db.orm.<Model>` is the default ORM lane — model-shaped, fully typed against the contract, lazily connects to the database on first use (it picks up `DATABASE_URL` from `.env` via the runtime's `dotenv/config`-loaded environment). The deeper `references/queries.md` reference covers the rest of the supported surface (filters, joins, transactions, the SQL builder) when the user is ready — and names the gaps (raw SQL and TypedSQL are not currently available).

> **Mongo target:** the snippet above is SQL-target shape. On `@internal/mongo`, `db.orm` is keyed by the collection's storage name (`@@map(...)`, or the lowercased model name if no `@@map`), so the same arc reads `await db.orm.users.create(...)` / `await db.orm.users.select('id', 'email').all()` — not `db.orm.User`. Full rule and rewrite recipe in `references/queries.md` § *MongoDB ORM addressing*.

**Prerequisites for the arc to work.** All three paths leave these in place by the time you reach the arc:

- `prisma.config.ts` exists at the repo root and declares the target + contract source (typically `src/prisma/contract.prisma` or `src/prisma/contract.ts`).
- The contract source exists at `src/prisma/contract.{prisma,ts}` (a starter model from `init`, or the inferred contract from `contract infer`, or whatever the bootstrap tool generated).
- `src/prisma/db.ts` exists and instantiates the runtime with the emitted contract.
- `DATABASE_URL` is set in `.env` (or wherever the runtime's config tells it to look).
- The database has been initialised (`db init`) or marker-signed (`db sign`), so the marker row exists and the schema matches the contract.

The three workflows below each describe how their path gets the user to that state. After that, the arc above is the same.

## Workflow — First-touch orientation

Triggers: *"what can I do with Prisma Next?"*, *"what can I do next with Prisma?"*, *"where do I start?"*, *"I just ran createprisma"*, *"what's next?"*, or any close variant — paired with a PN project already on disk (scaffolded by `createprisma`, by `prisma orm init`, by a teammate, however).

The user's high-level intent is *"I want to be running an application against my database, against this thing called Prisma Next."* The job of this workflow is to anchor them on the contract, get one round-trip working, and let further commands surface organically as their next move requires them. **It is orientation, not a tour, not a feature inventory, not a syllabus.**

### Concept — what to communicate first

Prisma Next is contract-first. Everything the framework does — query types, migrations, runtime types, drift detection — flows from a single source of truth: the **contract**. The contract describes the user's application's data model. The framework reads it; the framework derives the rest. Lead with this.

The first response to *"what can I do with Prisma Next?"* names the contract path, frames its role in one sentence, and then steers toward getting the user's application running. Don't open with a feature inventory. Don't open with a list of commands. Open with: *"Your contract is at `<path>`. It describes your application — your query types, migrations, and runtime types all flow from it. Let's get you connected to a database so your app can actually run against it."*

The first **arc** — once oriented — is **connect → write → read**. Not edit-the-contract-first, not plan-a-migration-first. The user's win is *I have application code running against my database*.

### Step 1 — Read the project, name the contract

Before saying anything specific to the user, read:

- `prisma.config.ts` at the repo root — what target (`postgres` / `mongodb`) is wired, what `contract:` path it declares, what extensions are installed.
- The contract source the config declares (canonically `src/prisma/contract.prisma` or `src/prisma/contract.ts`; a project that pre-dates [TML-2532](https://linear.app/prisma-company/issue/TML-2532) may have it at `prisma/contract.{prisma,ts}` instead — check the `contract` field of the config) — what starter models, if any, exist.
- `src/prisma/db.ts` (next to the contract) — the runtime entry point.
- `.env` / `.env.example` — is `DATABASE_URL` set, or only the example?
- Optionally `pnpm prisma-cli db verify` — does the live DB match the contract?

Then **say the contract path back to the user, with its role attached**. Something like: *"Your contract is at `src/prisma/contract.prisma`, and it currently declares a `User` model. The contract describes your app — every query type, migration, and runtime type the framework gives you flows from this file. Let's get your app connected to a database next."* The exact wording is up to the agent; what matters is that the user leaves the first response knowing *where the contract is* and *that it is the source of truth*.

### Step 2 — Get the user's app connected and round-tripping

The motivation is *"so your app can actually run against your database"*, not *"so the prerequisite checklist passes"*. The mechanics depend on what's already in place from Step 1:

- **Everything already wired.** Go straight to writing and reading a row (see *Your first arc — connect, write, read* above). Adapt the snippet to whatever model the contract declares.
- **`DATABASE_URL` not set.** Have the user set it in `.env` (not in `prisma.config.ts` — see Pitfall 5). Then `pnpm prisma-cli db init` to apply the current contract to that database and write the marker row. Now the app can connect.
- **Database is connectable but not yet aware of the contract** (marker row missing; `db verify` reports drift). Run `pnpm prisma-cli db init`. (`db update` is the alternative for quick dev cycles — it's looser, doesn't write a migration history, and is what users reach for when they want to iterate on the schema fast. Mention it if the user asks how to make schema changes flow to the DB; don't pre-explain it.)
- **Contract is empty** (bootstrap left the source blank). Add **one** model with **two** fields (e.g. `User { id, email }`), `pnpm prisma-cli contract emit`, then `pnpm prisma-cli db init`. Minimal — get the round-trip working, *then* extend.

The user encounters `db init` (and optionally `db update`, `contract emit`) here because they're the commands their current move *requires*. They learn what those commands are by using them.

### Step 3 — Round-trip a row

Run the snippet from *Your first arc — connect, write, read* above against whatever model the contract declares. When it prints the row back, the user has crossed from *"I have a project"* to *"my app runs against my database"*. That's the win.

### Step 4 — Hand off to the next move

Now ask the user what they want to build. Route to the skill that owns that move:

- More queries (filters, joins, transactions) → `references/queries.md`.
- Add a model, change a field, add a relation → `references/contract.md`. They'll touch `contract emit` and `db update` (or `migration plan` + `db migrate`) as part of that workflow.
- Middleware, environment config, multiple targets → `references/runtime.md`.
- Vite / Next.js / dev-server integration → `references/build.md`.
- They want a fuller toolbelt overview at this point — *Commands you'll use day-to-day* below is the one-glance summary.

### Anti-patterns on this path

- **Leading with a feature tour or capability inventory.** The user asked what they can *do*. Get them doing it.
- **Listing commands before any have been used.** Commands belong to specific moves; surface them when the move requires them.
- **Diving into migration concepts before one query has run.** Migrations exist; their value lands later.
- **Adding several models in one go.** Add one, get one query green, then iterate.
- **Walking the user through `prisma.config.ts` keys.** The scaffold's defaults are correct; revisit when the user needs to change something.
- **Skipping the contract framing.** Even one line — *"your contract is at `<path>`, it's the source of truth"* — anchors the user; without it, the rest of the workflow lands as disconnected ceremony.

## Workflow — Greenfield

The concept: `prisma orm init` is one CLI command that scaffolds config, schema, runtime, dependencies, and the contract emit step. It operates on the current working directory — there is no positional project-name argument. Make the directory, `cd` in, then run init.

```bash
mkdir my-app && cd my-app
pnpm init                                          # if no package.json yet
pnpm dlx @prisma/cli@next orm init                          # interactive
# or non-interactive (CI / agent runs):
pnpm dlx @prisma/cli@next orm init --yes --target postgres --authoring psl
```

> **Telemetry is opt-out.** The CLI collects anonymous usage data by default. Every command — including `init` — prints a one-time notice to **stderr** on first use, then sends; there is no interactive consent prompt. Opt out anytime by running `prisma telemetry disable`, or with `DO_NOT_TRACK=1` or `PRISMA_NEXT_DISABLE_TELEMETRY=1`. The command stores `"enableTelemetry": false` in your user config for you (the CLI's per-user config dir, **not** `prisma.config.ts`). Run `prisma telemetry status` to see what's currently in effect. This is relevant for agent-driven runs — the CLI records that an agent invoked it. What's collected, the per-user config path, and how to fully reset are documented in `docs/Telemetry.md`.

The flags `init` accepts (run `prisma orm init --help` for the source of truth):

- `--target <db>` — `postgres` or `mongodb`.
- `--authoring <style>` — `psl` or `typescript`.
- `--schema-path <path>` — defaults to `prisma/contract.prisma` (or `prisma/contract.ts`). **Pass `--schema-path src/prisma/contract.prisma` (or `.../contract.ts`)** to scaffold into the canonical `src/prisma/` location directly — `init`'s default is wrong today, see [TML-2532](https://linear.app/prisma-company/issue/TML-2532).
- `--confirm <directory name>` — grant the reinit consent non-interactively. Re-running init in a scaffolded directory asks you to type the directory name back before it overwrites; non-interactive runs pass the name with this flag instead.
- `--write-env` — also write `.env` (default writes only `.env.example`; `.env` stays under your control).
- `--probe-db` — connect to `DATABASE_URL` once and check the server version against the target's minimum.
- `--strict-probe` — fail init if the probe fails (no-op without `--probe-db`).
- `--skip-install` — skip dependency install + initial contract emit.
- `--skip-skills` — skip Prisma Next skills installation (air-gapped / restricted environments). The skill cluster is always installed at the project level — never globally — so its version stays locked to the project's Prisma Next version.

`init` writes (when it runs cleanly):

- `prisma.config.ts` at the project root.
- The contract source at `--schema-path` — `src/prisma/contract.prisma` if you passed the canonical override, `prisma/contract.prisma` if you accepted the (currently-wrong) default.
- `db.ts` in the same directory as the contract source.
- `prisma-next.md` — a human quick-reference.
- `.env.example` (and `.env` if `--write-env`).
- Updates `package.json` (deps + scripts) and `tsconfig.json` (required compiler options).
- Installs deps and runs `prisma-cli contract emit` once (the project-local bin `@prisma/cli` installs).
- Registers Prisma Next skills with the local agent runtime.

**If you took `init`'s default and ended up with a top-level `prisma/` directory** (TML-2532), the cleanup is one move + one config edit:

```bash
mkdir -p src && mv prisma src/prisma
# Then update prisma.config.ts so `contract` reads
# 'src/prisma/contract.prisma' (or .ts) instead of 'prisma/contract.prisma'.
pnpm prisma-cli contract emit   # re-emits contract.json + contract.d.ts under src/prisma/
```

Do this before running `db init` — once the marker row is written, restructuring is harder.

After init succeeds, the path converges on *Your first arc — connect, write, read* above. `init` has already seeded a starter contract with `User` and `Post` models (with a relation between them) and run `contract emit` once; the only remaining prerequisites are setting `DATABASE_URL` and initialising the database. Two commands:

1. Set `DATABASE_URL` in `.env` (copy from `.env.example`).
2. Initialise the database: `pnpm prisma-cli db init`. Creates tables, indexes, constraints, and writes the marker row — using the starter contract `init` generated.

Then run the snippet from *Your first arc* above against the `User` model. When the user is ready to extend the contract — add more models, change fields, add relations — chain to `references/contract.md`. For more queries, chain to `references/queries.md`.

**Why this is queries-first, not schema-editing-first.** `init` ships with `User` and `Post` on purpose: the user shouldn't have to design a schema to prove their setup works. Extending the contract is the next move *after* the first arc lands, not part of getting there. If the user asks you to skip straight to *"add a Comment model"* — sure, do that — but get one query green against `User` or `Post` first if there's any doubt the project is wired correctly.

## Workflow — Brownfield-DB (existing database, no contract)

The concept: against an existing database with no PN contract, `contract infer` walks the live schema (tables, columns, indexes — including expression and partial ones — constraints, and RLS enablement + policies) and writes a PSL contract that describes it. Where authoring would generate a CHECK constraint the database does not carry (the element-non-null check on a list column), infer emits `@noCheck(elementNotNull)` on that field, so the contract declares exactly what the database enforces. The reverse gap is closed too: a hand-written CHECK constraint the database enforces that authoring would never have generated comes back as `@@check(expression: <reprint>, map: "<name>")`, so it is a declared object from the first pull instead of an invisible extra a later destructive plan could drop. That inferred check warns (`PN_EXACT_NAME_BODY_COMPARISON`) the next time you run `contract emit` — expected, not a defect: the warning fires on any `map:` body regardless of who wrote it, and the comparison stays sound because both sides are Postgres's own reprint. The result is a *starting point*, not the final contract — review and clean it up, then `db sign` to record the current contract hash as the marker (instead of letting `db init` try to recreate the schema from scratch).

```bash
mkdir my-app && cd my-app
pnpm init
pnpm dlx @prisma/cli@next orm init --yes --target postgres --authoring psl \
  --schema-path src/prisma/contract.prisma
# scaffold lands; you'll overwrite the starter schema below
```

Then, with `DATABASE_URL` set in `.env`:

```bash
pnpm prisma-cli contract infer --db "$DATABASE_URL" --output src/prisma/contract.prisma
```

(Note: the flag is `--output`, not `--out`. Run `prisma contract infer --help` for the full surface.)

The agent should pause here and read the inferred PSL. Symptoms a re-author pass is needed:

- Tables PN couldn't categorise (e.g. legacy linking tables you could express as relations).
- Columns where PN's type guess is wrong (e.g. `String` where you want an extension type like `pgvector.Vector(length: 1536)`).
- Missing `@unique` / `@index` hints PN couldn't see.
- Field names you'd prefer to alias.

Then re-emit and sign:

```bash
pnpm prisma-cli contract emit
pnpm prisma-cli db sign
pnpm prisma-cli db verify   # clean immediately after a pull; reports drift if the DB changes later
```

Then run the snippet from *Your first arc — connect, write, read* above, using one of your existing tables in place of the starter model. The arc is the same; only the path that got you there differs.

## Commands you'll use day-to-day

A reference table — not a script to recite at the user. Commands surface in the workflow above as the user's next move requires them; this table is here for the moment the user asks for a wider view (typically after the first round-trip), and as a one-glance summary anyone newly oriented to Prisma Next can scan. For flag-level detail, run `<command> --help`; the help output is the source of truth.

| What you want to do | Command | Deeper skill |
|---|---|---|
| Apply the current contract to the DB the first time | `prisma db init` | this skill |
| Re-emit `contract.json` + `contract.d.ts` after editing the contract source | `prisma contract emit` | `references/contract.md` |
| Quick dev-only schema sync (no migration history kept) | `prisma db update` | `references/migrations.md` |
| Plan a migration from a contract diff | `prisma migration plan --name <slug>` | `references/migrations.md` |
| Apply pending migrations | `prisma db migrate` | `references/migrations.md` |
| Inspect the live database | `prisma db schema` | `references/debug.md` |
| Confirm the DB matches the contract (drift check) | `prisma db verify` | `references/debug.md` |
| Bring an existing DB into a PN contract | `prisma contract infer --db "$DATABASE_URL"` | this skill (brownfield) |
| Decode a structured error envelope | (read the `code` / `why` / `fix` fields) | `references/debug.md` |
| Report a bug or request a feature | (file via the feedback skill) | `references/feedback.md` |

## Decision — PSL vs TypeScript authoring

- **PSL** (`contract.prisma`) — the default. Concise, declarative, familiar to anyone who has used Prisma. Recommended for most projects.
- **TypeScript** (`contract.ts`) — a programmatic builder. Use when the contract is genuinely computed (multi-tenant per-tenant variants), when you reuse contract fragments across files, or when an extension requires constructs PSL doesn't yet express (e.g. pgvector's parameterised storage-type registration). Pairs with the Vite plugin from `references/build.md` for auto-emit on save.

Switch authoring later by re-running `prisma orm init` in the same directory. The init flow detects the existing scaffold and prompts to reinit (non-interactive runs grant the consent with `--confirm <directory name>`). Existing contract content is *not* automatically translated — you'll re-author by hand in the target language.

## Common Pitfalls

1. **Running `prisma orm init <project-name>` with a positional argument.** `init` operates on the current working directory; there is no positional project-name argument. `mkdir foo && cd foo && pnpm dlx @prisma/cli@next orm init`.
2. **`init` doesn't connect to your database.** It only scaffolds files and installs dependencies (and runs the initial `contract emit`). You connect with `db init` / `db update` / `db migrate`. If `init` succeeds and queries fail, the issue is `DATABASE_URL`, not `init`.
3. **Treating inferred PSL as the final contract.** `contract infer` produces a starting point. Don't `db sign` against a contract you haven't read.
4. **Forgetting to emit after editing the contract.** The contract artefacts (`contract.json`, `contract.d.ts`) are stale until you run `contract emit`. If the type-checker says a model "doesn't exist", you skipped emit.
5. **Setting `DATABASE_URL` in `prisma.config.ts` instead of `.env`.** The config reads `.env` automatically via `dotenv/config`. Hardcoding the URL leaks credentials and bypasses per-environment overrides. See `references/runtime.md`.
6. **Hand-editing `contract.json` or `contract.d.ts`.** They're emitted artefacts; the next `contract emit` overwrites your changes. Edit the source instead.
7. **Using `--out` for `contract infer`.** The flag is `--output`.

## What Prisma Next doesn't do yet

- **Migration from another ORM.** Prisma Next doesn't migrate your schema *from* Drizzle / Prisma 6/7 / Sequelize / TypeORM / Kysely / Knex / a raw driver. Workaround: install the matching `@internal/migrate-from-<orm>-skill` if one exists for your source, or treat the source as a brownfield database and `contract infer` from it. If you need a guided migration flow built-in, file a feature request via the `references/feedback.md` skill.
- **`prisma db push`-style production sync.** `db update` is the quick development path; for production, use migrations (`migration plan` + `db migrate`). PN deliberately does not offer a "push-to-prod-without-a-migration" surface — see `references/migrations.md`.
- **Studio / GUI database browser.** Use `prisma db schema` for a CLI tree-style summary of the live DB. If you need an interactive UI, file a feature request via the `references/feedback.md` skill.

## Reference Files

This skill is intentionally body-only; `prisma orm init --help`, `contract infer --help`, and `db sign --help` are the authoritative surfaces for flag-level detail. When in doubt, run `--help` and read the actual command's description rather than guessing from this skill.

## Checklist

- [ ] Confirmed which path applies (first-touch orientation / greenfield / brownfield) before proposing commands.
- [ ] **First-touch orientation:** named the contract path back to the user and framed its role (*source of truth from which query types, migrations, and runtime types flow*) before proposing any commands.
- [ ] **All paths:** brought the project to the *Your first arc* prerequisites (config, contract source, `db.ts`, `DATABASE_URL`, marker row) *before* writing application code.
- [ ] **All paths:** ran the first arc — one `create` + one `select` against the starter (or inferred) model — and got the round-trip working green.
- [ ] **All paths:** did *not* edit the contract source as part of the first arc. Schema extension is the *next* move, not the first.
- [ ] **All paths:** did *not* lead with a feature tour, capability inventory, or recital of CLI commands. Commands surfaced as the user's current move required them.
- [ ] Confirmed the user's target (`postgres` / `mongodb`) and authoring mode (`psl` / `typescript`).
- [ ] **First-touch orientation:** read `prisma.config.ts`, the contract source, `db.ts`, and `.env` before proposing anything — didn't assume what the scaffold tool / teammate left in place.
- [ ] **Greenfield path:** ran `prisma orm init` from the project directory — no positional project-name argument.
- [ ] **All paths:** the project ended up in the canonical `src/prisma/contract.{prisma,ts}` + `src/prisma/db.ts` + `migrations/app/` layout — including moving the scaffolded directory out of a top-level `prisma/` if `init` produced one (TML-2532).
- [ ] **Brownfield path:** ran `contract infer --db "$DATABASE_URL" --output src/prisma/contract.prisma`, reviewed the result, then `contract emit` + `db sign`.
- [ ] Set `DATABASE_URL` in `.env` and confirmed the value is reachable.
- [ ] Initialised the DB (`db init` greenfield / first-touch orientation) or signed the marker (`db sign` brownfield).
- [ ] Did NOT hand-edit `contract.json` or `contract.d.ts`.
- [ ] Did NOT set `DATABASE_URL` in `prisma.config.ts`.
- [ ] Confirmed the user understands what the *next* skill is for their workflow (typically `references/queries.md` for more queries, then `references/contract.md` when they're ready to extend the schema).
