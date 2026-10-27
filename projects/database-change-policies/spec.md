# Database change policies: may db update run, and may a change lose data — spec

The reasoning, scenarios, prior art and rejected alternatives are in [`design.md`](design.md). The slices are in [`plan.md`](plan.md). Linear: [P-TML-1165](https://linear.app/prisma-company/project/databases-declare-how-they-may-change-a870e49c25a5).

## The decision

Every database records two policies in its marker, and every command that changes a database obeys them:

- a **change policy**: whether the database may be changed by walking the migration graph (`migrate`), by reconciling it to a contract (`reconcile`, which is what `db update` does), or by both;
- a **data protection policy**: whether an operation that loses data, or that widens who can read or write rows, is forbidden, needs consent, or is permitted.

A ref declares the policies its database should have. A deploy to that ref changes the database's policies only when given explicit consent, `--permit-policy-change`.

When a deploy finds the database off the migration graph, its error says why, and offers the recovery the database's change policy permits. No error, document or skill text ever recommends resetting or dropping a database: a database can always be moved, by migrations or by `db update`.

## Purpose

On 2026-10-15 an agent proposed resetting a shared development database because it believed `db update` was only for local databases and that only a migration could move the database. Nothing in the system said which databases may be moved directly and which may only change through reviewed migrations, so the agent had only prose to go on, and the prose pointed the wrong way. This project makes each database carry that answer, makes every command obey it, and makes the off-graph error state the permitted recovery.

## Design

### Policies

**Change policy.** A set of the strategies the database may be changed by:

| Strategy | What it does | Commands |
|---|---|---|
| `migrate` | Walks the migration graph from the marker to the target, running each migration | `db migrate`, a Composer deploy |
| `reconcile` | Plans the operations that make the live database satisfy a destination contract, runs them, then signs the database | `db update`, and `db sign` (the signing step alone) |

**Data protection policy.** Two independent settings, each with three levels:

| Setting | Levels |
|---|---|
| `dataLoss` | `data-loss-forbidden`, `data-loss-with-consent`, `data-loss-permitted` |
| `accessWidening` | `access-widening-forbidden`, `access-widening-with-consent`, `access-widening-permitted` |

An operation **loses data** when it drops a table or column, or changes a column's type in a way that loses values. In a migration's `ops.json` these are the operations whose `operationClass` is `destructive`. A data transform is not counted as losing data.

An operation **widens access** when it changes who can read or write a model's rows, for example dropping a row-level-security policy or disabling row-level security. `db update` already identifies these when it plans. For a recorded migration, the target identifies them from each operation's structure in `ops.json` (its operation kind and the object it acts on), through a function the target provides. Nothing reads an operation's label to decide.

**Defaults.** A database whose marker records no policy, and any setting a marker does not record, takes the default:

| Setting | Default |
|---|---|
| `change` | `["migrate", "reconcile"]` |
| `dataLoss` | `data-loss-with-consent` |
| `accessWidening` | `access-widening-with-consent` |

The defaults are today's behaviour, so existing databases behave exactly as before.

### Where policies are stored

**In a ref.** A ref file gains an optional `policies` field. Users write it by editing the ref file, as they do for `invariants`:

```json
// migrations/app/refs/production.json
{
  "hash": "4b1c…e09a",
  "invariants": [],
  "policies": {
    "change": ["migrate"],
    "dataProtection": {
      "dataLoss": "data-loss-with-consent",
      "accessWidening": "access-widening-forbidden"
    }
  }
}
```

Every key is optional. A key a ref omits is **undeclared**: the ref says nothing about that setting. Every command that writes a ref file (`migration ref set`, ref advancement by `db init`, `db update`, `db sign` and `db migrate --advance-ref`) keeps an existing `policies` field unchanged. Only a person editing the file changes it.

**In the marker.** The application space's marker row stores the policies in force under `meta.policies`, in the same shape as the ref's `policies`. The `meta` column already exists on Postgres, SQLite, MySQL and MongoDB, so no marker table changes. MySQL's marker upsert currently replaces `meta` with `{}` on every write, and must stop doing so. A marker write that does not change policy keeps `meta.policies` as it is.

**In the ledger.** Every change to a database's policies appends a ledger entry recording the previous policies, the new policies and when the change happened. It has no migration name or hash. Existing ledger entries are migration entries.

### What each command does

Every command below reads the database's policies from its marker, never from the repository, and enforces them before running any operation.

| Command | Change policy | Data loss | Access widening |
|---|---|---|---|
| `db migrate`, Composer deploy | Requires `migrate` | `forbidden`: refuses a run containing a migration with a destructive operation. `with-consent`: runs; the consent was given when the migration was planned. `permitted`: runs. | `forbidden`: refuses a run containing a migration with an access-widening operation. `with-consent` and `permitted`: run. |
| `db update` | Requires `reconcile` | `forbidden`: refuses any plan that loses data, even with `--delete`. `with-consent`: asks, as today (`--delete`, `--rename`). `permitted`: does not ask; an unanswered loss is applied as a delete, and `--rename` statements still apply. | `forbidden`: refuses, even with `--allow`. `with-consent`: asks, as today. `permitted`: does not ask. |
| `db sign` | Requires `reconcile` | Not applicable: it changes no schema | Not applicable |
| `migration plan --to <ref>` | Not applicable | Checks the plan against the ref's declared `dataLoss`: `forbidden` refuses to write a plan that loses data | Same, against `accessWidening` |
| `migration status --to <ref>` (with a database) | Reports when the ref's declared policies differ from the database's | | |

`db init` runs against a database with no marker, so no policy applies to it.

### Refs and databases must agree

When a command is given a ref (`db migrate --to <ref>`, `db update --to <ref>`, a Composer deploy with `targetRef`), it compares each setting the ref **declares** with the database's, before running anything:

- **They agree:** the command runs under the database's policies.
- **They differ, without `--permit-policy-change`:** the command fails with `MIGRATION.POLICY_MISMATCH` before running anything.
- **They differ, with `--permit-policy-change`:** the command first writes the ref's declared settings into the marker and appends a ledger entry, then runs under the new policies. When nothing else is pending, it changes only the policies.

Undeclared settings are never compared and never written. A command given no ref, including a Composer deploy with no `targetRef`, never changes a policy.

On Postgres and SQLite the policy write is part of the run's transaction, so a run that fails leaves the policies unchanged. On MongoDB the policy write happens before the migrations and stays if a migration then fails; the ledger records it.

`--permit-policy-change` is accepted by `db migrate` and `db update`. Composer's deployment resource gains `permitPolicyChange`, default `false`. No error ever lists `--permit-policy-change` as a next action.

### Errors

Each error is a structured envelope built where the failure is detected, in the control API, with its own code, `why` and `nextActions`. The CLI renders it. Composer renders it too, instead of writing its own text. The control API's `migrate` stops returning its own failure codes (`MIGRATION_PATH_NOT_FOUND`, `RUNNER_FAILED`) and returns these envelopes, as the structured-errors decision record requires. Every code is registered in `docs/reference/error-reference.md` in the slice that introduces it.

**The database is off the migration graph: `MIGRATION.MARKER_MISMATCH`.** Raised by the control API's `migrate` (so by `db migrate` and Composer) when the marker's hash is not a node of the migration graph. The CLI already raises this code for this case before running DDL; the control API now raises it too, with this content:

> **summary:** The database is at a contract that is not in the migration graph
>
> **why:** The database's marker names `<marker hash>`, which no migration in `migrations/app` starts or ends at. After `<last graph hash>`, the last graph contract it reached, it applied `<migration names>`, which are no longer on disk.

The last graph hash and the missing migrations come from the database's ledger: walking back from the newest entry, the first entry whose `to` is a graph node gives the last graph hash, and the entries after it name the missing migrations. When the ledger has no such entry, the sentence about the last graph hash is left out.

The next actions depend on the database's change policy:

| Change policy permits | Next actions |
|---|---|
| `reconcile` | 1. Run `prisma db update --db <url> --to <target> --dry-run` and review the plan. 2. Run `prisma db update --db <url> --to <target>`. 3. Deploy again. |
| `migrate` only | One `user-choice` action, with no command: "This database's change policy permits only migrations. Author migrations that bring it back onto the graph: one from `<last graph hash>` to the database's current contract, then one from there to the target. Commit them and deploy again." The skill gives the commands; the error does not suggest `contract infer`, which overwrites the contract source unless given a separate output path. |

**The database is in the graph but the target is not reachable: `MIGRATION.PATH_UNREACHABLE`.** Unchanged, except that it is built in the control API. Its recovery, `migration plan --from <marker hash> --to <target>`, works because the marker's hash is a graph node.

**`MIGRATION.MARKER_MISMATCH` from the CLI's pre-DDL check** gets the same content, replacing its current recoveries (`migration plan --from <graph tip>` and `migration ref set db <marker hash>`), which do not bring the database back onto the graph.

**New codes:**

| Code | Raised when | Next actions |
|---|---|---|
| `MIGRATION.CHANGE_POLICY_FORBIDS` | A command needs a strategy the database's change policy does not include | When `reconcile` is refused: author a migration with `prisma migration plan` and deploy it. When `migrate` is refused: run `prisma db update`. |
| `MIGRATION.DATA_PROTECTION_FORBIDS` | A run or plan contains an operation the data protection policy forbids. `meta` lists each operation and its subject. | Change the contract or the migration so it does not lose data or widen access. For a loss, carry the data first with a data transform. |
| `MIGRATION.POLICY_MISMATCH` | A ref declares a policy that differs from the database's. `why` lists each differing setting with both values. | Make the ref match the database, or have whoever owns the database apply the ref's policies. |

### Composer

Composer's deploy step (`packages/1-prisma-cloud/1-extensions/target/src/orm-migrate.ts` in `prisma/composer`):

- shows the control API's envelope (summary, `why` and next actions) and deletes `noPathRefusal`;
- passes `permitPolicyChange` from the deployment resource to the control API;
- treats a database as "already at target" only when its hash, invariants and declared policies all match the target ref.

### The `prisma-8` skill

- `SKILL.md`, near the top: "Never reset or drop a database to fix a migration, marker or contract problem. A database can always be moved: by `db update` where its change policy permits reconciliation, otherwise by authoring migrations."
- `references/migrations.md` gains a section, "A database whose marker is not in the migration graph". It explains the cause, then gives both recoveries from the error above, with the `db update --dry-run` step first and a warning to read every data transform in the skipped migrations and carry their data by hand.
- `references/migrations.md` replaces "use `db update` on a solo dev database" with the change policy rule, and documents policies, `--permit-policy-change` and the new errors.
- `references/debug.md` lists `MIGRATION.MARKER_MISMATCH`, `MIGRATION.CHANGE_POLICY_FORBIDS`, `MIGRATION.DATA_PROTECTION_FORBIDS` and `MIGRATION.POLICY_MISMATCH`.
- The routing table's triggers send "migration path not found", "no authored path", "marker mismatch" and "reset the database" to the new section.

### Recorded decisions and documents

- A new decision record, "Databases record a change policy and a data protection policy".
- A decision record, "No recovery resets or drops a database" (ADR 307), supersedes the drift recovery decision record's "reset and reapply" recoveries and its "auto-reset" development policy. The change policy decision record supersedes ADR 287's "`db update` is for development only".
- The glossary defines change policy, data protection policy and their values, says how they differ from control policy, and widens `migrate` to "bring the database to a ref, applying its policies with consent".
- The migration domain docs replace "dev-only" and "tears down and rebuilds" for `db update`.
- The Migration System doc's recovery table matches the errors above.
- The decision records on refs, the marker and the ledger gain notes for the new fields.

## Requirements this design satisfies

| Requirement | Satisfied by |
|---|---|
| No agent is ever told to reset a database | The errors, the skill rule and the document changes |
| An agent hitting the off-graph error knows why and what is permitted | `MIGRATION.MARKER_MISMATCH` built from the ledger, with next actions chosen by the change policy |
| Production can be protected from `db update` | The change policy, enforced by `db update` and `db sign` |
| A database can be read on its own | Policies in the marker; every command reads them from there |
| A plan made offline against a ref can be applied | `migration plan --to <ref>` checks the ref's policies, and a deploy fails when the ref and the database disagree |
| A command never overrides the policy it enforces | Policies change only with `--permit-policy-change`, and a missing declaration changes nothing |
| A CD pipeline can apply a reviewed policy change | `--permit-policy-change` and Composer's `permitPolicyChange` |
| A policy change needs no migration | A deploy writes policies when they are the only difference |
| Existing projects keep working | The defaults equal today's behaviour, and refs without `policies` declare nothing |

## Non-goals

- **Permitted change operations and the compatibility policy.** The policy shape leaves room for both.
- **Protection from deliberate workarounds**, such as writing the marker with SQL or passing `--permit-policy-change` with an edited ref. A privileged database role for writing policies is a follow-up.
- **A one-step command** that brings an off-graph database back onto the graph with migrations.
- **Composer repairing a database by itself** when a deploy finds no path.
- **Change authority, execution constraints and rollback policy.**
- **`prisma postgres connection delete --project`**, a separate ticket.

## Project DoD

- Replaying the incident on Postgres, a `db migrate` and a Composer deploy to a database whose marker is off the graph fail with `MIGRATION.MARKER_MISMATCH`, naming the last graph hash and the missing migrations, saying the database need not be reset, and giving the next actions for its change policy (integration tests in both repositories).
- On a database whose policy permits only `migrate`, `db update` and `db sign` fail with `MIGRATION.CHANGE_POLICY_FORBIDS` (integration tests).
- Under `data-loss-forbidden`, a migration that drops a column fails with `MIGRATION.DATA_PROTECTION_FORBIDS` in `db migrate` and in a Composer deploy, with and without a ref, and `db update` refuses the same change even with `--delete` (integration tests).
- A deploy to a ref whose declared policy differs from the database's fails with `MIGRATION.POLICY_MISMATCH` before running anything; with `--permit-policy-change` it writes the policy, appends the ledger entry, then runs; with nothing else pending it changes only the policy (integration tests on Postgres, SQLite, MySQL and MongoDB).
- `migration ref set` and ref advancement keep an existing `policies` field (tests).
- The skill, the decision records, the glossary and the migration docs say what this spec says. No text in the repository recommends resetting or dropping a database to fix a migration problem, or scopes `db update` to local, solo or dev-only databases.
- Linear tickets exist for each follow-up in [`design.md`](design.md).
- `projects/database-change-policies/` is deleted, with anything long-lived moved to `docs/`.

## References

- [`design.md`](design.md) and [`plan.md`](plan.md)
- [ADR 218 — Refs and the rule that a migration starts from a graph node](../../docs/architecture%20docs/adrs/ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md)
- [ADR 176 — Data migrations as invariant-guarded transitions](../../docs/architecture%20docs/adrs/ADR%20176%20-%20Data%20migrations%20as%20invariant-guarded%20transitions.md) and [ADR 208 — Invariant-aware migration routing](../../docs/architecture%20docs/adrs/ADR%20208%20-%20Invariant-aware%20migration%20routing.md)
- [ADR 123 — Drift detection, recovery and reconciliation](../../docs/architecture%20docs/adrs/ADR%20123%20-%20Drift%20Detection,%20Recovery%20&%20Reconciliation.md)
- [ADR 021 — Contract marker storage](../../docs/architecture%20docs/adrs/ADR%20021%20-%20Contract%20Marker%20Storage.md) and [ADR 228 — The migration ledger is a per-migration journal](../../docs/architecture%20docs/adrs/ADR%20228%20-%20Migration%20apply%20ledger%20is%20a%20per-migration%20journal.md)
- [ADR 245 — Errors are structured at origin](../../docs/architecture%20docs/adrs/ADR%20245%20-%20Errors%20are%20structured%20at%20origin%3B%20results%20carry%20one%20ok%20discriminator.md)
- [Migration domain](../../docs/design/10-domains/migration/README.md) and [Migration System](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md)
