
# Prisma Next — Migration Review (Deployment + Concurrency)

> **Edit your data contract. Prisma handles the rest.**

This skill is about *reviewing* migrations, not authoring them. It covers the questions that come up at deploy time and when multiple developers are landing migrations concurrently.

The skill teaches *the system's mental model* — what a ref is, what a marker is, what the migration graph is — and shows how to ask the system for its state. It does **not** prescribe rigid step-by-step procedures: most "review" questions are answered by understanding the model and querying the right thing. Rigid procedures are reserved for the rare case where there's literally one safe path.

## When to Use

- User asks *"what migrations will run when I merge this?"* or *"what's about to run on deploy?"*.
- User hit a concurrent-migration conflict (`main` advanced while their branch was open).
- User wants to wire up a `staging` / `production` ref so CI can deploy against it.
- User wants to run a migration against an environment that isn't the local dev DB.
- User asks about CI integration for migrations.

## When Not to Use

- User wants to *author* a migration → `references/migrations.md`.
- User wants to fix a hash-mismatch / drift in a single env → `references/migrations.md` (re-plan path) or `references/debug.md` (envelope-driven).
- User wants to edit the contract → `references/contract.md`.

## Key Concepts — the navigation model

**Every migration question is a navigation from an *origin* to a *destination*.** Once you have this model, the rest of the skill is just "which command asks the system about which navigation."

### Origin

The **origin** is the database's *current contract hash*. The database carries a row in PN's marker table that records *"this database is at hash X"*. When the CLI runs online (a `--db <url>` is provided, or `db.connection` is set in `prisma.config.ts`), PN reads the marker and that hash is the origin. Offline (no DB connection), the origin is unknown — many commands degrade to listing the on-disk migrations and skip the per-edge applied/pending status.

A live DB is therefore the authoritative source of origin. The "recorded marker" in any other artifact (refs, local cache, your assumptions) is a working copy that can drift; the live DB never does.

### Destination

The **destination** is the contract hash you want the database to be at. Two ways to name a destination:

- **A `--to <name>`** — a named pointer to a hash, stored under `migrations/app/refs/<name>.json`. Refs are named after environments by convention (`staging`, `production`) to communicate *"this is where production is expected to be"*. The ref itself is just a hash + an optional set of required invariants; it has nothing to do with which database you connect to.
- **The current contract head** — implicit when no `--to` is passed. This is the hash of the current `contract.json` on disk.

`--to staging` does **not** mean "connect to the staging database." It means "navigate the database I connected to (via `--db` or config) toward whatever hash this ref points at." Database selection is orthogonal: pass `--db $STAGING_DATABASE_URL` to actually point at staging.

### The migration graph

The on-disk migrations form a directed graph: **nodes are contract hashes; edges are migrations.** Each migration declares a `from` hash and a `to` hash. A migration applies only when the database's current marker matches its `from` hash; running it advances the marker to its `to` hash.

The graph is a static, committed artifact. Several branch tips may coexist, rollback edges may form cycles, and no node is privileged — "where is my database" is answered by the marker and refs, never by the graph itself. `references/migration-model.md` carries the full model, including how `migration plan` chooses its origin.

`migration status` queries the graph for the path from origin to destination and reports per-edge status:

- **applied** — on the path from `EMPTY_CONTRACT_HASH` to the marker (history).
- **pending** — on the path from the marker to the destination (what would run).
- **unreachable** — on the path from `EMPTY_CONTRACT_HASH` to the destination, but the marker is on a different branch and won't reach it without first re-routing.

### Diagnostic codes

`migration status` emits structured diagnostics on the result envelope (`diagnostics[].code`) so the agent can branch on the code rather than parsing the prose summary. Each diagnostic also carries `severity` (`warn` or `info`), a human `message`, and `hints` — the same hints the CLI prints under the summary line.

| Code | Severity | Meaning in the navigation model | Next move |
|---|---|---|---|
| `MIGRATION.UP_TO_DATE` | info | Marker = destination; no edges to walk. | Nothing to do. |
| `MIGRATION.DATABASE_BEHIND` | info | Marker is an ancestor of the destination; N pending edges in between. | `db migrate --to <name> --db $URL`. |
| `MIGRATION.MISSING_INVARIANTS` | info | Marker reached destination structurally but missing required invariants the ref declares. | `db migrate --to <name> --db $URL` to take a path that covers them. |
| `MIGRATION.NO_MARKER` | warn | Online, but the database has no marker row — never initialised. | `db migrate --db $URL` (first apply writes the marker). |
| `MIGRATION.MARKER_NOT_IN_HISTORY` | warn | Online; marker hash is not a node in the graph. The database was changed outside the migration system. | Decide which side is truth: `db sign` (accept DB as truth), `db update` (push contract to DB), `contract infer` (re-derive contract from DB), or `db verify` (inspect first). **Not** the same as `MIGRATION.MARKER_MISMATCH`: `MARKER_NOT_IN_HISTORY` is emitted during the runner's graph walk when the live marker is off the path being traversed; `MARKER_MISMATCH` fires earlier, at the CLI pre-DDL gate, when the marker hash is not a graph node at all. |
| `MIGRATION.DIVERGED` | warn | Multiple valid leaves; the destination is ambiguous. | Pass `--to <name>`, or `migration ref set <name> <hash>` to create one. |
| `CONTRACT.AHEAD` | warn | Contract head is not in the graph — the contract was edited without re-planning. | `migration plan` to extend the graph. |
| `CONTRACT.UNREADABLE` | warn | `contract.json` couldn't be read. | `contract emit` to regenerate it. |

### Graph-tree output

`migration status` (and `migration list`) render the migration graph as a colored lane tree in the terminal. Two flags control the rendering:

- `--legend` — prints the key for the tree glyphs and lane colors before the tree.
- `--ascii` — replaces box-drawing glyphs with pipe-safe ASCII characters (useful in CI logs or environments that don't support Unicode).

Both flags are also available on `migration list` and `migration graph`. `migration log` supports `--ascii` only (it renders a flat chronological table, not a tree).

### Plan- and apply-time diagnostics

These codes surface on `migration plan`, `migration ref set`, and `db migrate` — not on `migration status`. See [Migration System § Recovery affordances](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md#recovery-affordances) and [ADR 218](../../docs/architecture%20docs/adrs/ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md).

| Code | When | Meaning | Next move |
|---|---|---|---|
| `MIGRATION.HASH_NOT_IN_GRAPH` | `migration plan` (non-empty graph) or `migration ref set` | Resolved hash is not a node in the on-disk migration graph — typical when the default `db` ref points past the graph tip after dev-only `db update` cycles. | `migration plan --from <reachable-ref>` (e.g. `--from production`); or realign the ref with `migration ref set db <graph-node-hash>`. |
| `MIGRATION.SNAPSHOT_MISSING` | `migration plan` | A named ref has no pointer file (`<name>.json`), and the hash being resolved isn't a node in the migration graph either. | `migration ref set <name> <hash>` to create the ref, `db update --advance-ref <name>` to advance it, or pass a hash that is a graph node. |
| `MIGRATION.MARKER_MISMATCH` | `db migrate` (pre-DDL, before the runner) | Live DB marker hash is not a graph node — drift the offline planner cannot see. | `migration plan --from <graph-tip>` if the marker is canonical; `migration ref set db <marker-hash>` if the on-disk graph is canonical; investigate out-of-band applies. |
| `MIGRATION.PATH_UNREACHABLE` | `db migrate` (path resolution) | No migration path from the current marker to the resolved target in the on-disk graph. | Read the improved `fix` payload — it names `fromHash` / `targetHash` and suggests `migration plan --from <from> --to <target>`; run `migration list` to inspect the graph. |

A CI gate should read `diagnostics` from `--json` output and decide based on `severity` plus `code`; see *Workflow — CI* below for the structure.

## Workflow — *"What's about to run on deploy?"*

The user asks: *"I'm about to merge this PR. What migrations are going to run when I deploy to staging?"*

This is the navigation question: **origin** = staging's live marker; **destination** = the ref `staging` (or the contract head if you haven't set one). Ask the system:

```bash
pnpm prisma migration status --to staging --db "$STAGING_DATABASE_URL"
```

The command:

1. Reads the staging DB's marker (the origin).
2. Resolves `staging` to a contract hash (the destination).
3. Renders the path between them as an ordered list of migrations, with per-edge `applied` / `pending` / `unreachable` status, and an explicit summary line of the form *"N migration(s) behind ref 'staging'"*.
4. Prints a header that names the config, migrations directory, the active ref, and the database connection (masked) — so the framing is visible in the output.

If you omit `--db`, the command runs offline: it lists the migrations on disk but cannot tell you what's applied, because it has no origin. That's fine for *"what's on this branch?"*; it's not fine for *"what's about to run on staging?"* — for that you need staging's live marker.

If you omit `--to`, the destination defaults to the contract head — which answers *"is this branch's contract reachable from the database, and how?"*, not *"what runs on deploy"*. Pass the ref explicitly when the question is about a specific environment.

`migration status` summarises each pending migration's operations by class (`additive`, `widening`, `data`, `destructive`) and reports a destructive-op count when destructive operations are present. Surface that count to the user before they merge or deploy — destructive operations are the class that warrants manual review.

## Workflow — *"What state is each environment at?"*

Just `migration status --db $URL` for each environment's DB. The marker (origin) comes back from the DB itself; the summary line tells you whether the environment is at the contract head, at a named ref, ahead of head, or on a divergent branch.

## Concept — concurrent migrations on the same branch point

This used to be called *diamond convergence* in some PN docs; the situation is the same regardless of the label.

**What's happening.** Two topic branches each authored a migration off the same parent contract hash. The first branch merges to `main`; the destination ref (e.g. `production`) advances to that branch's `to` hash. Your branch's migration still has its `from` hash pointing at the *old* parent. The migration graph, after rebase, no longer has a clean path through your migration:

- Your migration's `from` is no longer an ancestor of the new head.
- Or your migration's `from` is reachable, but the path through your migration arrives at a hash that's not the union of both branches' changes.

Either way, the on-disk plan is stale.

**Resolution.** The on-disk plan is stale because its `from` hash is no longer the head of the graph; apply the cluster's standard *edit → plan → apply* loop to the post-rebase state and the planner produces a fresh migration whose `from` matches the new head.

**The one thing the planner can't do for you** is port custom data-transform logic from the abandoned `migration.ts` into the new one — schema deltas are derived from the contract, but any hand-written `data` operations are yours to carry across before applying. There is no separate "revalidate" step, no special "diamond apply" flow.

## Workflow — set, list, get, delete refs

Refs are small artifacts. There's no per-environment lifecycle; you just point a name at a hash.

```bash
pnpm prisma migration ref set production <contract-hash>
pnpm prisma migration ref list
# `migration ref get` was removed — use `migration ref list` and filter by name
pnpm prisma migration ref list | grep production
pnpm prisma migration ref delete production
```

`migration ref set` writes a file at `migrations/app/refs/<name>.json` carrying the hash and any required invariants. Refs are commit-friendly artifacts — keep them in git; the team agrees on what `production` points at the same way they agree on what `main` is. The hash being set must be the `to` of an on-disk migration, or the command refuses — see `references/migration-model.md` for the refusal codes.

Two ref roles, one mechanism: environment refs like `production` are the contract CD will migrate that environment to (a forward promise), while the `db` ref is a checkpoint of where the project's dev database was last brought to — written by `db init` / `db update`, consumed by `migration plan` as its default origin. `references/migration-model.md` covers the `db` ref, advancement rules, and plan-origin resolution.

## Workflow — apply a migration against an environment

```bash
pnpm prisma db migrate --to production --db "$PRODUCTION_DATABASE_URL"
```

The destination is the ref's hash; the origin is the production DB's live marker. The command computes the path between them and applies each pending migration in order, advancing the marker.

`--db` is the environment selection knob. `--to` is the destination-hash knob. They're independent.

## Concept — ref-mismatch on CI / deploy

CI reports: *"the recorded ref `production` is at hash X; the live DB is at hash Y."*

The mismatch is a fact about *two pieces of state that disagree*. The investigation is the same regardless of which piece is wrong:

- **DB ahead of the ref.** Someone applied a migration outside CI without updating the ref in git. Re-record the ref with `prisma migration ref set <ref-name> <db-marker-hash>` (commit + push); then audit how the out-of-band apply happened.
- **DB behind the ref.** A previous deploy was rolled back, or the DB was restored from an older backup. Either re-apply forward with `prisma db migrate --to <ref-name> --db $URL`, or re-route the ref backward to match what's actually deployed with `prisma migration ref set <ref-name> <db-marker-hash>`. The choice is the user's — name both options.
- **DB on a different branch.** An out-of-band schema change (manual SQL, ad-hoc migration) wrote something the migration graph doesn't model. Run `prisma db verify` to inspect the drift, then either `prisma contract infer` to re-derive the contract from the database, or edit the contract and run `prisma migration plan` so the database is the eventual destination.

`migration ref set` to silently align the ref with whatever the DB happens to be at is almost never the right move. It papers over drift that you'll pay for later.

## Workflow — CI: verify a branch can advance the target environment

The gate is `migration status --to <env> --db $URL`: it computes the path from the live marker to the ref and reports it, without mutating anything. There is no `--dry-run` flag on `db migrate`; the inspect / gate step is `migration status`.

For a human-readable ordered preview of the migration path before applying, use `db migrate --show --db $URL`. For applied history after a deploy, use `migration log --db $URL` (flat chronological table).

```yaml
- name: Verify staging is reachable
  run: |
    pnpm prisma migration status \
      --to staging --db "$STAGING_DATABASE_URL" --json > status.json
    node -e '
      const s = JSON.parse(require("fs").readFileSync("status.json", "utf8"));
      const warns = (s.diagnostics ?? []).filter(d => d.severity === "warn");
      if (warns.length) {
        console.error("Blocking diagnostics:", warns);
        process.exit(1);
      }
    '
- name: Apply
  run: pnpm prisma db migrate --to staging --db "$STAGING_DATABASE_URL"
```

`migration status` exits non-zero only on hard errors (unreadable migrations directory, unsatisfiable invariants, unreconstructable history). Diagnostics like `MIGRATION.MARKER_NOT_IN_HISTORY`, `MIGRATION.DIVERGED`, `CONTRACT.AHEAD`, and `MIGRATION.NO_MARKER` are reported on the result envelope with `severity: 'warn'` but the process exits `0` — the agent (or a CI gate) must inspect `diagnostics[]` and fail the build itself. Use `--json` so the gate parses a structured shape rather than the human summary.

`db migrate` is interactive-free and has no destructive-op confirmation prompt — the safety rails that prompt for destructive changes live on `db update` (see the `references/migrations.md` skill). Whatever the planner put in the migration graph is what `db migrate` runs; review happens at `migration plan` and at `migration status` time, before the apply step.

## Common Pitfalls

1. **Reading `migration status` without `--to` for a deploy question.** That asks *"can this branch's contract reach the head?"*, not *"what's about to run on staging?"*. Always pass the ref when the question is about a specific environment.
2. **Reading `migration status` without `--db` for a deploy question.** Without a live DB, you have no origin. The output lists what's on disk; it can't say what's applied on the environment. Pass `--db $URL` for any high-stakes question.
3. **Confusing the ref with a DB connection.** `--to staging` selects the destination hash, not the database. Pass both `--to` and `--db` explicitly.
4. **Treating diamond convergence as a special procedure.** It's not. It's the normal *edit → plan → apply* loop applied to the post-rebase state. The only extra step is *"port any data-transform logic from your old `migration.ts` over."*
5. **Running `migration ref set` to silence a CI mismatch without understanding the cause.** That can mask out-of-band changes or rollback drift. Investigate first.

## What Prisma Next doesn't do yet

- **Per-environment migration ordering beyond the default chain.** If you need staging to skip a migration that production requires (or vice versa), the supported path is to author the per-env divergence as separate migrations and gate them in your deploy script. If you want first-class per-env routing, file a feature request via the `references/feedback.md` skill.
- **A built-in side-by-side "branch diff" view.** There is a full-graph render (`migration graph`) that shows branches, but no `git diff`-style comparison between two branches' migration sets. Workaround: run `migration status` on each branch and `diff` the output. If you want a built-in branch-comparison view, file a feature request via the `references/feedback.md` skill.

## Reference Files

This skill is intentionally body-only; the underlying CLI reference (`prisma migration status --help`, `prisma db migrate --help`, `prisma migration ref --help`) is the authoritative surface for flag-level detail. When in doubt, run `--help` and read the actual command's description rather than guessing from this skill.

## Checklist

- [ ] Named both the **origin** (live DB marker) and the **destination** (ref or contract head) for the question the user asked.
- [ ] Passed `--db $URL` whenever the question involves a specific environment.
- [ ] Passed `--to <name>` whenever the question is about deploying *to* a named environment, not just *from* the current branch's head.
- [ ] Read the `migration status` header (it names config, ref, database) and the summary line (it names the origin/destination distance) before reading the per-edge list.
- [ ] For concurrent-migration conflicts: re-applied the *core* workflow (edit → plan → apply) rather than following a memorised "diamond convergence" procedure. Ported any data-transform logic from the abandoned `migration.ts` over.
- [ ] For a ref-mismatch: investigated *which* piece of state is wrong (DB ahead, DB behind, DB on a divergent branch). Did NOT `migration ref set` to silence the mismatch.
- [ ] Surfaced the destructive-op count from `migration status` (the only operation class that warrants manual review pre-deploy) before the user merges or deploys.
- [ ] In CI: parsed `migration status --json` `diagnostics[]` and gated on `severity === 'warn'`; did NOT rely on a `--dry-run` flag on `db migrate` (no such flag exists).
- [ ] Did NOT confuse `--to` with database selection (`--to` picks the destination hash; `--db` picks the database).
- [ ] Did NOT use `--ref` (removed; use `--to`).
- [ ] Did NOT confabulate a "branch diff" CLI subcommand, a `migration revalidate` step, or any other API the skill above doesn't reference.
