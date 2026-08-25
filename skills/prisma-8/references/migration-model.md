
# Prisma Next — The Migration Graph and Refs (Mental Model)

> **Edit your data contract. Prisma handles the rest.**

This reference teaches the model behind migration planning: what the migration graph is, what refs are, how `migration plan` chooses where to start, and the one silent mistake the model exists to prevent — a plan that starts from an empty database while migrations already exist. Hold this model and both authoring loops (dev-database loop, deploy-first loop) follow from it; skip it and the planner's defaults will eventually produce a migration you didn't intend.

## When to Use

- Deciding where the next `migration plan` should chain from.
- `migration plan` output shows `from: (baseline)` and you didn't expect a from-scratch plan.
- Setting up on-disk migrations for a project whose databases are managed by a deploy pipeline (Prisma Composer or your own CD) rather than by `db init` / `db update`.
- A database already exists (marked and accurate) but the repo has no on-disk migrations for it — retrofit.
- Questions about refs: `migration ref set` / `list` / `delete`, what the `db` ref means, `--advance-ref`, why a ref is stale.

## When Not to Use

- Filling placeholders, applying migrations, hash mismatches, drift recovery → `references/migrations.md`.
- What runs on deploy, environment refs in CI, concurrent-migration conflicts → `references/migration-review.md`.
- First-time adoption of an existing database (`contract infer` + `db sign` mechanics) → `references/quickstart.md` § *Brownfield-DB*.

## Key Concepts

### The graph is a static artifact

The on-disk migrations under `migrations/<space>/` form a directed graph. **Each migration is an edge recording a `from` and a `to` contract storage hash** (in its `migration.json`; `from: null` denotes an edge from the empty database). Nodes are the hashes those edges mention. That is the whole structure — the graph records which contract states migrations exist between, and nothing else.

Consequences worth internalising:

- **No node is privileged.** There is no "current" node, no HEAD, no special tip the planner chains from. Multiple branch tips are legal (two migrations planned off the same node). Cycles are legal (a rollback edge back to an earlier hash creates one).
- **The graph does not know where your database is.** "Where is my database" is answered by the database's **marker** (a live-DB record of "this database is at hash X") and, offline, by **refs**. Never by the graph.
- **The graph does not know where your next migration should start.** The planner has to be told an origin. That is the entire job of refs and `--from`.

### Refs — version-controlled pointers

A ref is a small committed file, `migrations/<space>/refs/<name>.json` (for your app: `migrations/app/refs/<name>.json`), containing `{ hash, invariants }`. Two roles, by convention:

- **The `db` ref** records which contract hash the project's dev database has been brought to. It is a **checkpoint, not a promise**: dev commands write it after the fact so the offline planner knows where dev iteration left off, without opening a database connection.
- **Environment refs** (`staging`, `production`, …) name **the contract CD will migrate that environment to** — a forward promise the repo makes, consumed at deploy time. See `references/migration-review.md` for the deploy-side workflows.

`db` is a **default name, not a magic one**. It gets no special storage, no protection; dev commands simply default to advancing a ref of that name. You can point it anywhere with `migration ref set db <hash>` and a later `db update` on the default URL will overwrite it.

Manage refs with:

```bash
pnpm prisma migration ref set <name> <hash-or-ref>
pnpm prisma migration ref list
pnpm prisma migration ref delete <name>
```

`migration ref set` requires the target to be the `to` hash of an on-disk migration. A hash outside the graph is refused (`MIGRATION.HASH_NOT_IN_GRAPH`); a hash that appears in the graph only as a `from` — no bundle produces it — is refused too (`MIGRATION.REF_SET_BUNDLE_NOT_FOUND`). Find node hashes with `migration list`.

### Who advances refs

| Command | Ref advancement |
|---|---|
| `db init` / `db update` (default URL) | Implicitly advance `db` (override the name with `--advance-ref <name>`; suppressed whenever `--db` is passed without `--advance-ref`, regardless of the URL — even `--db $DATABASE_URL` pointing at the default database) |
| `db migrate --advance-ref <name>` | The **only** apply-time advancement |
| plain `db migrate` | **Never advances anything** — deliberate: deploy and CI applies must not infer dev intent |
| `migration plan` | Never advances anything — chaining discipline is yours |
| deploys (Composer / CD) | Write the database's marker; structurally cannot and do not touch repo refs |

### How `migration plan` picks its origin

`migration plan` resolves its origin in exactly this order:

1. Explicit `--from <ref-name | hash | hash-prefix | migration-dir | migration-dir^ | ./path | @contract | @db | @empty>` — `@db` reads the live database's marker and is the one origin form that is not offline; `@empty` names the empty database deliberately.
2. No `--from` → the `db` ref (`migrations/app/refs/db.json`).
3. No `db` ref → **greenfield: the plan starts from the empty database.**

It is **offline** — it never consults a database, never reads a marker. Whatever the refs on disk say is what it believes. The destination defaults to the emitted `contract.json` (`--to` overrides).

The human output names the resolved origin on its `from:` line. **`from: (baseline)` means the origin resolved to nothing — the plan starts from an empty database** and will contain a create for every object in the contract.

**Auto-baseline.** When the graph is *empty* and the origin resolved through a ref to a real hash (the typical first plan after `db update` cycles), the planner emits **two** bundles in one invocation — a baseline `null → ref-hash` plus the delta `ref-hash → contract` — so the ref's hash becomes a graph node and the plan can be applied. Expect two new directories in `git status`. Details and the related refusals (`MIGRATION.HASH_NOT_IN_GRAPH`, `MIGRATION.SNAPSHOT_MISSING`) are in `references/migrations.md` § *Dev → ship transition*.

## The trap — a greenfield plan over existing migrations

**A plan whose origin is the empty contract while migrations already exist on disk is almost always a mistake.** A full-create migration cannot do what you meant: a database that has the prior migrations applied refuses it (`MIGRATION.PATH_UNREACHABLE` — no path from its marker to the new plan's destination), and running its create statements against any populated schema fails outright. The CLI refuses this at plan time: when origin resolution falls all the way through (no `--from`, no `db` ref) and migrations exist, `migration plan` stops with `MIGRATION.PLAN_ORIGIN_UNKNOWN` instead of writing the package — the error's suggestions are the three exits below; do not reflexively take the `--from @empty` one, pick by intent.

How the fall-through happens: a project that never runs `db init` / `db update` (the deploy-first path below) never acquires a `db` ref, so *every* default plan resolves to the empty origin. Running the dev loop with an explicit `--db` has the same effect: `db init` / `db update` with that flag never advance the ref, whatever URL it carries. The first time that is correct (it is the baseline; an empty migration graph plans silently); every later time it is the trap the refusal catches.

**Recognize a from-empty plan** that was produced anyway (an explicit `--from @empty`, or an older CLI without the refusal), at either layer:

- Plan output says `from: (baseline)` — while `migrations/app/` already contains migration directories.
- The new package's `migration.json` has `"from": null` — while sibling migrations exist.
- The planned operations create objects you know already exist.

**Three exits.** Pick by intent, delete the mistaken package directory first if one was written:

1. **Set a ref to the intended origin, then re-plan with the default.** Usually the last shipped migration's `to` hash: `migration list` to find it, `migration ref set db <hash>`, `migration plan --name <slug>`. Do this when you want future plans to chain without flags.
2. **Pass the origin explicitly:** `migration plan --from <ref-or-hash-or-migration-dir> --name <slug>`. Do this for a one-off, or when a different ref (e.g. `production`) is the honest origin.
3. **You genuinely mean the empty origin** — a first baseline, or a deliberate rebuild of everything. Say it explicitly: `migration plan --from @empty --name <slug>`. This is the only case where `from: (baseline)` over a non-empty directory is right, and it should be rare enough to say out loud.

## Workflow — the dev loop

The concept: while the schema is in flux, iterate the dev database with `db init` / `db update` — they apply the contract *and* keep the `db` ref current. When the shape settles, plan: the plan chains from the ref, and the auto-baseline covers the case where the graph is still empty.

```bash
pnpm prisma db init                                     # once; advances the db ref
pnpm prisma contract emit && pnpm prisma db update      # iterate; each advances the db ref
pnpm prisma contract emit && pnpm prisma migration plan --name <slug>
pnpm prisma db migrate --db $DATABASE_URL
```

After a plain `db migrate` the marker advances but the ref lags; refresh with `db update` (no-op on the DB when already current) or apply with `db migrate --advance-ref db` in the first place. Full mechanics, refusals, and recovery: `references/migrations.md` § *Dev → ship transition*.

## Workflow — the deploy-first loop (Composer / CD-managed databases)

The concept: the deploy pipeline owns the databases, so `db init` / `db update` never run and nothing ever advances a `db` ref for you. Deploys replay each database from its marker to the contract emitted at build time; they never write to `migrations/app/refs/`. Two disciplines keep this loop safe:

**Author the baseline before the first deploy.** Before anything is deployed:

```bash
pnpm prisma contract emit
pnpm prisma migration plan --name init      # from: (baseline) — intended, this once
git add migrations/ && git commit
```

This is the one intended greenfield plan. With the baseline committed, the deployed database's marker always corresponds to a graph node, and every later state is reachable by planned migrations.

**Chain every later plan from the last shipped contract.** Nothing advances refs in this loop, so either keep the `db` ref current yourself — after each plan, `migration ref set db <new-migration-to-hash>` (the hash is a graph node as soon as the plan is written; `migration list` shows it) — or pass `--from <last-migration-dir>` on every plan. Committing the ref together with the migration keeps teammates' default plans chaining correctly too.

If you skip the chaining, the next default plan resolves to greenfield: the trap above. And note the planner accepts *any* graph-node origin without complaint — planning from a stale ref silently creates a second branch tip (legal, occasionally intended, usually not). Check `migration list` when in doubt.

## Workflow — adopt a pre-existing database

The concept: a database that predates Prisma Next enters the system by describing it, not migrating it — `contract infer` derives the contract from the live schema, and after review + `contract emit`, `db sign` records the marker. Full recipe: `references/quickstart.md` § *Brownfield-DB*.

```bash
pnpm prisma contract infer --db "$DATABASE_URL" --output src/prisma/contract.prisma
# review and re-author, then:
pnpm prisma contract emit
pnpm prisma db sign
```

After adoption the graph is still empty. Before the next schema change ships, author the baseline (deploy-first loop above) or start the dev loop — otherwise the first real plan lands in the trap.

## Workflow — retrofit a database that has no on-disk migrations

The concept: the database exists and its marker is accurate (hash **M**) — it was built by `db update` in another checkout, by a deploy pipeline, or adopted via `db sign` — but the migration graph doesn't reach M. The goal is to **make the graph reach the marker's hash**: once a baseline `null → M` exists, applying against the marked database is clean by construction — the runner starts at the marker, so the baseline never executes; only real deltas past M run.

- **It's your dev database.** Run `db update` (default URL; no-op on the DB when the contract already matches) — it advances the `db` ref and stores the contract snapshot. The next `migration plan` auto-emits the baseline plus your delta. This is just the dev loop's dev → ship transition.
- **It's a deployed database you must not touch.** Build the baseline offline, at the deployed contract state:
  1. Bring the contract source back to the deployed state (check out the deployed revision of the contract file, or stash your edits), then `contract emit`.
  2. `migration plan --name baseline` — greenfield, intended: one bundle `null → M`. Confirm its `to` matches the database (`db verify --db "$URL"` is clean at this revision).
  3. Restore the current contract source, `contract emit`.
  4. `migration ref set db <M>` (M is now a graph node), then `migration plan --name <slug>` — the delta `M → current`.

  `db migrate` against the marked database applies only the delta.

## Common Pitfalls

1. **Assuming `migration plan` chains from the newest migration on disk.** It never does. The origin is `--from`, else the `db` ref, else empty. If neither exists, you get a from-scratch plan with no warning.
2. **Expecting `migration plan` or plain `db migrate` to keep the `db` ref current.** Neither touches refs. Only `db init` / `db update` advance implicitly, and only `--advance-ref` advances at apply time.
3. **Expecting a deploy to update refs.** Deploys write the database's marker; the files under `migrations/app/refs/` only change when you change them.
4. **Reading `from: (baseline)` as informational.** Over a non-empty migrations directory it is the trap announcing itself. Stop and pick an exit before applying or committing.
5. **`migration ref set` with a hash no on-disk migration produces.** A ref target must be the `to` hash of an on-disk migration bundle. A hash outside the graph is refused (`MIGRATION.HASH_NOT_IN_GRAPH`); a from-only graph node is refused with `MIGRATION.REF_SET_BUNDLE_NOT_FOUND`, whose fix text points at fixtures and is unhelpful here. Either way: plan the edge whose `to` is the hash first (baseline or delta), then set the ref.
6. **Treating `db` as reserved.** It's a naming default. Setting it yourself is fine and sometimes exactly right (deploy-first chaining, retrofit); just expect dev commands on the default URL to overwrite it.
7. **Authoring the first migration after the first deploy.** Then no graph node corresponds to what shipped, and every incremental path needs the retrofit. Baseline before the first deploy — it's one command.

## What Prisma Next doesn't do yet

- **No plan-time ref advancement.** `migration plan` cannot advance a ref for you; keeping the chain current is manual (`migration ref set` after each plan, or `--from` every time). If you want a plan-time advancement flag, file a feature request via the `references/feedback.md` skill.

## Checklist

- [ ] Named the intended origin before planning — a ref, a hash, or a deliberate `--from @empty`.
- [ ] Read the plan output's `from:` line and confirmed it names that origin — not `(baseline)` over an existing graph.
- [ ] In a deploy-first project: baseline authored and committed before the first deploy; every later plan chained via the `db` ref or `--from`.
- [ ] After each plan in a loop where nothing advances refs: advanced the `db` ref (`migration ref set db <to-hash>`) or resolved to pass `--from` next time.
- [ ] For a marked database with no on-disk migrations: made the graph reach the marker's hash (auto-baseline via `db update`, or an offline baseline plan) before planning deltas.
- [ ] Did NOT expect plain `db migrate`, `migration plan`, or a deploy to advance any ref.
- [ ] Did NOT apply or commit a `from: (baseline)` plan without confirming the empty origin was the intent.
