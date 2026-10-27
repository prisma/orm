# Slice 1: the off-graph error, and no more reset advice — spec

Linear: [TML-3725](https://linear.app/prisma-company/issue/TML-3725). Project spec: [`../../spec.md`](../../spec.md), section *Errors*. Branch: `tml-3725-off-graph-error`.

## At a glance

A Composer deploy or `prisma db migrate` against a database whose marker is not in the migration graph fails with:

```text
✖ The database is at a contract that is not in the migration graph (MIGRATION.MARKER_MISMATCH)
  why  The database's marker names 267755c4…, which no migration in migrations/app starts or ends at. After 9f1e02ab…, the last graph contract it reached, it applied 20261013T0910_request_description, which is no longer on disk.
  next Unless this database changes only through migrations, as production does, move it with db update; its data stays:
         prisma db update --to 4b1c…e09a --dry-run --db <url>
         prisma db update --to 4b1c…e09a --db <url>
       Otherwise plan a migration from 9f1e02ab… to its current contract, then one to 4b1c…e09a, and deploy again.
```

## Chosen design

### The control API's `migrate` already returns structured envelopes

`executeMigrate` in `packages/1-framework/3-tooling/cli/src/control-api/operations/migrate.ts` already fails with a `CliStructuredError` built where the failure is detected, so Composer receives the same code, `why`, `nextActions` and `meta` the CLI prints. This slice changes only what the no-path branch returns, below.

### Two causes, two codes

When `migrate` finds no path from the database to the target, it distinguishes:

1. **The marker's storage hash is not a node of the space's migration graph** → `MIGRATION.MARKER_MISMATCH`, with the content below. This applies per contract space: the application space and each extension space.
2. **The marker is a graph node, but the target is not reachable from it** → `MIGRATION.PATH_UNREACHABLE`, with its current content (plan `--from <marker> --to <target>`, then apply).

An empty database (no marker) is never case 1.

### `MIGRATION.MARKER_MISMATCH` content

- **summary:** `The database is at a contract that is not in the migration graph`
- **why:** as in the example above, built from:
  - the marker's storage hash;
  - the space's migrations directory, relative to the project, as printed elsewhere in migrate errors;
  - **the last graph hash and the missing migrations, from the database's ledger.** Read the space's ledger (`readLedger`), newest entry first. The first entry whose `to` is a graph node gives the last graph hash; the entries newer than it, oldest first, give the missing migrations by `migrationName`. If no entry's `to` is a graph node, leave out the sentence naming the last graph hash and list nothing. If the ledger cannot be read, leave both out; never fail the error for it.
- **nextActions**, in order:
  1. `user-choice`: `Unless this database changes only through migrations, as production does, move it with db update; its data stays:`
  2. `run-command`, label `Preview the changes`: `{bin} db update --to <target hash> --dry-run --db <url>`
  3. `run-command`, label `Reconcile the database`: `{bin} db update --to <target hash> --db <url>`
  4. `user-choice`: `Otherwise plan a migration from <last graph hash> to its current contract, then one to <target hash>, and deploy again.` When there is no last graph hash, say `from the nearest contract in the migration graph` instead.

  The `why` is one line per field; the terminal wraps it. Every sentence has to earn its place: no cause the history sentence already shows, and no separate "no reset" sentence, since "its data stays" says it.
- **meta:** `spaceId`, `markerHash`, `targetHash`, `lastGraphHash` (or absent), `missingMigrations` (array of names, possibly empty; absent when the ledger cannot be read).

Ledger rows written by `db update` or `db init` carry no migration name; the `why` says such a command moved the database outside the graph instead of naming a migration. Each list in the `why` shows at most five names. For an extension space, whose migrations come with the extension, the next actions send the user to a version of the extension whose migrations include the database's contract, since `db update` walks extension graphs and fails the same way. An extension space that ships no migrations is never refused, as before.

Commands print through `cliCommand` (`utils/printed-command.ts`), like every other printed command: arguments first, then the `--config` and `--db <url>` the caller was given, with hashes in full. A caller that is not the CLI, such as Composer, passes `invocation.dbGiven: true`, so the commands it shows name `--db <url>` and are not run against a developer's configured database by mistake. Composer sets it in slice 2.

The CLI's existing pre-DDL check and `db migrate --show` (`control-api/operations/graph-queries.ts`) raise the same envelope, for every contract space as the control API does, so all paths produce identical output. Its current recoveries, `migration plan --from <graph tip>` and `migration ref set db <marker hash>`, are removed: neither brings the database back onto the graph.

No error in this slice suggests `contract infer`, a reset, or dropping the database.

## Coherence rationale

One reviewer can hold this in one sitting: one failure type is replaced by envelopes, one error gains a ledger-built explanation, and the skill and docs change to match. Splitting the docs off would ship an error whose guidance the skill contradicts.

## Scope

**In:**
- the control API `migrate` no-path branch;
- the CLI's `db migrate` rendering;
- `errorMarkerMismatch` and the pre-DDL check;
- the ledger read;
- `docs/reference/error-reference.md` entries for `MIGRATION.MARKER_MISMATCH` (new producing site and meta shape) and any code whose producing site moves;
- tests;
- the `prisma-8` skill (`SKILL.md` rule and triggers, `references/migrations.md` new section and the `db update` wording, `references/debug.md` table, `references/migration-review.md` and `references/migration-model.md` where they describe these recoveries);
- the migration domain docs (`docs/design/10-domains/migration/README.md`, `user-journeys.md`): replace "dev-only" and "tears down and rebuilds" for `db update`;
- a new decision record, ADR 307 "No recovery resets or drops a database", which supersedes ADR 123's reset recoveries and "auto-reset" development policy (accepted ADRs are not edited; ADR 123 gains only a status line);
- other CLI error text that advises a reset or a drop: `utils/db-init-failure.ts` and the `migrate reset` redirect in `orm/family.ts`;
- the Migration System doc's recovery table.

**Out:**
- policies of any kind (slice 3);
- Composer (slice 2);
- `migration plan` and `migration ref set` errors other than the ones above.

## Pre-investigated edge cases

| Case | Expected |
|---|---|
| The incident: marker at a hash whose migration was deleted; ledger shows a graph hash, then the deleted migration | `MARKER_MISMATCH` naming both, with all four next actions |
| Marker off the graph, ledger empty or every `to` off the graph | `MARKER_MISMATCH` without the last-graph-hash sentence; the migration next action says "from the nearest contract in the migration graph" |
| Marker in the graph, target not reachable | `PATH_UNREACHABLE`, unchanged content |
| No marker (empty database) and no path | Not `MARKER_MISMATCH`; the existing no-path or never-planned error |
| Extension space off its graph | `MARKER_MISMATCH` for that space, naming its migrations directory |
| A runner failure | `MIGRATION.RUNNER_FAILED`, same content as today |

## Slice-specific done conditions

- Integration test on Postgres replays the incident through `db migrate` and asserts the whole envelope (code, summary, why, nextActions, meta).
- No text under `skills/`, `docs/` or CLI error strings recommends resetting or dropping a database to fix a migration problem, or scopes `db update` to local, solo or dev-only databases.
