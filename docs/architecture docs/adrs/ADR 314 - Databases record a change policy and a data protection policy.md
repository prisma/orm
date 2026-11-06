# ADR 314 — Databases record a change policy and a data protection policy

**Status:** Accepted
**Date:** 2026-10-30

## Example

A team wants its production database to change only through reviewed migrations. It says so in production's ref file:

```json
// migrations/app/refs/production.json
{
  "hash": "4b1c…e09a",
  "invariants": [],
  "policies": { "change": ["migrate"] }
}
```

The database does not yet record that rule, so a deploy to the ref stops before it changes anything:

```text
$ prisma db migrate --to production --db $PROD
✘ [MIGRATION.POLICY_MISMATCH] The ref's policies differ from the database's
  why: production declares change: migrate; the database has change: migrate, reconcile.
→ Make the ref match the database, or have whoever owns the database apply the ref's policies.
```

Whoever owns production applies the rule with explicit consent, and from then on the database itself refuses `db update`:

```text
$ prisma db migrate --to production --permit-policy-change --db $PROD
✔ Policies updated: change: migrate

$ prisma db update --db $PROD
✘ [MIGRATION.CHANGE_POLICY_FORBIDS] This database's change policy permits only migrations
  why: The marker records change: migrate, so db update may not move it.
→ Author a migration with prisma migration plan, then deploy it.
```

## Decision

Every database records two policies about itself, and every command that changes a database obeys them:

- a **change policy**: whether the database may be moved by walking the migration graph, by reconciling it directly to a contract, or by both;
- a **data protection policy**: whether a change may lose data, and whether it may widen who can read or write rows.

The database records them in its marker. A ref declares the policies its database should have. A command given a ref refuses to run when the two disagree, and changes the database's policies only when told it may.

## The two policies

Prisma 8 has two ways to move a database to a new contract:

- **`migrate`** walks the migration graph: it runs, in order, the reviewed migrations committed in `migrations/` that lead from the database's current contract to the target. `db migrate` and a Composer deploy do this.
- **`reconcile`** plans the operations that make the live database satisfy a contract, runs them, and then signs the database, which records that contract as the one the database is at. `db update` does this. `db sign` is the signing step on its own.

The **change policy** is the set of these strategies the database permits. Production usually permits only `migrate`: every change to it is a migration someone reviewed, and its migration history is kept. A development or staging database usually permits both.

The **data protection policy** has two settings, each with three levels:

| Setting | Levels |
|---|---|
| `dataLoss` | `data-loss-forbidden`, `data-loss-with-consent`, `data-loss-permitted` |
| `accessWidening` | `access-widening-forbidden`, `access-widening-with-consent`, `access-widening-permitted` |

An operation loses data when it drops a table or column, or changes a column's type in a way that loses values; these are the operations whose class is `destructive`. An operation widens access when it changes who can read or write a model's rows, such as dropping a row-level-security policy. Each target decides which operations widen access from their structure, never from their label.

The two policies are separate because they answer separate questions, and every combination occurs:

| | Data must be kept | Data is disposable |
|---|---|---|
| **`migrate` only** | Production | A staging database refilled from fixtures |
| **`migrate` and `reconcile`** | A shared development database | A local or test database |

A database that records no policy takes the defaults: `change: ["migrate", "reconcile"]`, and `with-consent` for both data settings. `db update` then asks before it loses data, and `db migrate` runs a lossy migration because consent was given when the migration was planned. A database without policies therefore behaves exactly as one that never had them.

## Where the policies live

**The database records the policies in force.** The marker is the record each database keeps of the contract it is at, one per contract space (the application, and each extension that owns part of the schema). The application space's marker stores the policies under `meta.policies`, in the same shape as the ref's `policies`, on every target. They are the database's policies, so they govern every contract space a command moves; an extension space's marker never carries them. A setting the marker does not record takes its default.

**A ref declares the policies its database should have.** A ref is a named pointer at a contract, kept in the repository at `migrations/<space>/refs/<name>.json`. Every key in `policies` is optional, and a ref declares nothing about a key it leaves out. Only a person editing the file changes it; every command that rewrites a ref keeps the fields it does not change.

Both copies exist for different readers. A command connected to a database must know the database's rules without a checkout of the repository, just as the marker records the contract hash so the database can describe itself ([ADR 021](ADR%20021%20-%20Contract%20Marker%20Storage.md)). A plan made offline against a ref must know the rules of the database that ref describes. The ref is the desired state and the marker the actual state, the same split the migration model uses for contracts.

**Nothing is written to the migration ledger.** The ledger records applied migrations ([ADR 228](ADR%20228%20-%20Migration%20apply%20ledger%20is%20a%20per-migration%20journal.md)), and a policy change is not one. The ref file's history in version control records what was declared and when.

## How a database's policies change

A command given a ref (`db migrate --to <ref>`, `db update --to <ref>`, a Composer deploy with a target ref) compares each setting the ref declares with the database's before it runs anything:

- **They agree:** the command runs under the database's policies.
- **They differ:** the command fails with `MIGRATION.POLICY_MISMATCH`.
- **They differ and the command was given `--permit-policy-change`** (Composer: `permitPolicyChange`): the run is checked against the ref's policies, runs, and writes them into the marker when it succeeds. If the policies are the only difference, it writes the policies and nothing else.

A command given no ref, or a ref that declares nothing, never changes a policy.

The consent is explicit because a command that enforced a policy and also rewrote it from whatever ref it was handed would override the policy it enforces: an agent with an edited ref, or a branch deploying to a shared database, would loosen it without anyone deciding to. The consent is a flag on the deploy, not a separate command, because a CI/CD pipeline can only deploy what is committed: a reviewed change to the ref and the migration it allows ship in the same deploy.

No error ever suggests the flag. An agent that has run out of ideas acts on whatever an error offers it, and an error that offered `--permit-policy-change` would have that agent loosen production's policy to get its deploy through. The flag is documented in the command's help and in the `prisma-8` skill.

The policies are written when the run succeeds, so a failed deploy never leaves a database with a loosened policy and none of the change that needed it. On Postgres, SQLite and MySQL the write is part of the run's transaction. MongoDB has no transaction around a run, so it writes the policies with the application space's marker after the last migration.

Another process may change the policies while a command runs. The runner therefore compares the policies the command checked with the marker before it applies the first space, while it holds its lock, as it already does for the contract hash. MongoDB has no lock: it compares them before the first space and writes the application space's marker only while the marker still records them. A concurrent change fails the run with `MIGRATION.MARKER_CAS_FAILURE`; it is never overridden.

## What each command enforces

| Command | Change policy | Data protection |
|---|---|---|
| `db migrate`, a Composer deploy | Needs `migrate` | Under `forbidden`, refuses a run containing a migration that loses data or widens access. Under `with-consent` and `permitted`, runs it. |
| `db update` | Needs `reconcile` | Under `forbidden`, refuses the change even with `--delete` or `--allow`. Under `with-consent`, asks. Under `permitted`, does not ask. |
| `db sign` | Needs `reconcile` | Not applicable: it changes no schema |
| `migration plan --to <ref>` | Not applicable | Refuses to write a plan the ref's declared settings forbid |

A refusal by the change policy is `MIGRATION.CHANGE_POLICY_FORBIDS`; one by the data protection policy is `MIGRATION.DATA_PROTECTION_FORBIDS`. `db sign` is governed because it rewrites the marker to whatever contract the database satisfies, which is the move that takes a database off its migration graph. A database with no marker has no policy, so adopting an existing database with `db sign` and creating one with `db init` are never refused.

When a database's marker names a contract that is not in the migration graph, the error and the `migration status` warning give the one recovery its change policy permits ([ADR 307](ADR%20307%20-%20No%20recovery%20resets%20or%20drops%20a%20database.md)): `db update` where `reconcile` is permitted, otherwise authoring migrations that bring the database back onto the graph.

## Consequences

- A ref file may carry `policies`, and every command that writes a ref keeps the fields it did not change ([ADR 218](ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md)).
- The framework owns `meta.policies`: its key, its stored form, its parser, the comparison and the defaults. Targets write the value the framework gives them, and every marker write on every target keeps the `meta` keys it does not own. MongoDB's guarded marker write is built from the framework's key and value lists, so it accepts exactly the stored values the framework would read as the checked policies.
- [ADR 287](ADR%20287%20-%20Prisma%208%20has%20no%20db%20push%20to%20production.md)'s rule that production changes only through migrations becomes something a database states about itself and the tools enforce.
- The policies stop mistakes, not deliberate workarounds. Anyone who can write the marker table, or who passes `--permit-policy-change` with an edited ref, can change them.
- Control policy ([ADR 224](ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md)) is a different concept: it says whether Prisma may write a given database object.
- The names leave room for other kinds of change control later, such as which operation classes may run, or which running application versions must stay compatible during a change.

## Alternatives considered

- **Better error and documentation text only.** Rejected. A rule that exists only as prose is one an agent short of ideas will walk past. An agent that believed `db update` was only for local databases proposed resetting a shared development database whose data mattered; the text it read was wrong, and nothing in the tools contradicted it.
- **A single "protected" flag.** Rejected. It cannot describe a database whose data must be kept but which may be reconciled, such as a shared development database.
- **The marker names its ref, and the ref holds the rules**, as Rails records an environment name. Rejected: the database could not be read without the repository.
- **A deploy always applies its ref's policies.** Rejected: the command would override the policy it enforces.
- **A deploy that runs despite a mismatch and reports it as pending.** Rejected: the ref would stop describing its database, and plans made against it could be refused when applied.
- **Writing the new policies before the migrations run.** Rejected: on MongoDB a failed deploy would leave a loosened policy behind.
- **A ledger row for every policy change.** Rejected: the ledger holds applied migrations, its row shape has no upgrade path, and the ref file's history already records what was declared.
- **A separate `db policy set` command.** Rejected: a pipeline can only deploy, and a second way to change a policy is a second way around review.
- **A new marker column.** Rejected: `meta` exists on every target for fields added later, so no marker table changes.
