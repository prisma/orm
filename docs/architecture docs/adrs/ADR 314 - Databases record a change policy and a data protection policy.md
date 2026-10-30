# ADR 314 — Databases record a change policy and a data protection policy

**Status:** Accepted
**Date:** 2026-10-30

## Decision

Every database records two policies in its marker, and every command that changes a database obeys them.

- **Change policy:** the strategies the database may be changed by. `migrate` walks the migration graph from the marker to a target, running each recorded migration (`db migrate`, a Composer deploy). `reconcile` plans the operations that make the live database satisfy a contract, runs them, then signs the database (`db update`, and `db sign`, the signing step alone). A database that changes only through reviewed migrations, such as production, records `["migrate"]`.
- **Data protection policy:** two settings, each with three levels. `dataLoss` is `data-loss-forbidden`, `data-loss-with-consent` or `data-loss-permitted`; `accessWidening` is `access-widening-forbidden`, `access-widening-with-consent` or `access-widening-permitted`. An operation loses data when it drops a table or column or changes a type in a way that loses values: the operations whose class is `destructive`. An operation widens access when it changes who can read or write a model's rows, such as dropping a row-level-security policy; the target identifies these from each operation's structure, never from its label.

A ref declares the policies its database should have:

```json
// migrations/app/refs/production.json
{
  "hash": "4b1c…e09a",
  "invariants": [],
  "policies": {
    "change": ["migrate"],
    "dataProtection": { "dataLoss": "data-loss-with-consent", "accessWidening": "access-widening-forbidden" }
  }
}
```

The application space's marker stores the policies in force under `meta.policies`, in the same shape, on every target. They are the database's policies: they govern every contract space a command moves, and an extension space's marker never carries them. A setting the marker does not record takes the default, which is today's behaviour: `change: ["migrate", "reconcile"]`, both data settings `with-consent`. Nothing is ever written to the ledger: it is the journal of applied migrations, and a policy change is not one.

**A ref and its database must agree.** A command given a ref (`db migrate --to <ref>`, `db update --to <ref>`, a Composer deploy with a target ref) compares each setting the ref declares with the database's before running anything. A difference fails with `MIGRATION.POLICY_MISMATCH`. With `--permit-policy-change` (Composer: `permitPolicyChange`), the run is checked against the ref's policies, runs, and writes them into the marker when it succeeds, inside the run's transaction where the target has one and after the last migration on MongoDB. Once the runner holds its lock (on SQLite, its exclusive transaction), and before it applies the first space, it compares the policies the check used with the application space's marker. MongoDB has no lock: it compares them before the first space, and writes the application space's marker only while it still stores them. A concurrent policy change fails the run instead of being overridden. A command given no ref, or a ref that declares nothing, never changes a policy. No error ever suggests the flag.

**Enforcement.** `db update` and `db sign` need `reconcile`; `db migrate` needs `migrate`; a refusal is `MIGRATION.CHANGE_POLICY_FORBIDS`. `db migrate` refuses a run containing a migration with a destructive operation under `data-loss-forbidden`, or an access-widening operation under `access-widening-forbidden` (`MIGRATION.DATA_PROTECTION_FORBIDS`); under `with-consent` it runs, the consent having been given when the migration was planned. `db update` under `forbidden` refuses the loss even with `--delete`; under `with-consent` it asks, as today; under `permitted` it does not ask. `migration plan --to <ref>` checks the plan against the ref's declared data protection. A database with no marker has no policy, so adoption by `db sign` and `db init` are never refused.

The error for a database whose marker is outside the migration graph (`MIGRATION.MARKER_MISMATCH`, [ADR 307](ADR%20307%20-%20No%20recovery%20resets%20or%20drops%20a%20database.md)) gives the one recovery the change policy permits: `db update` where `reconcile` is allowed, otherwise authored migrations.

## Why

On 2026-10-15 an agent proposed resetting a shared development database because it believed `db update` was only for local databases. Nothing in the system said which databases may be moved directly and which only through migrations; the only guidance was prose, and the prose was wrong. A rule that exists only as prose is one an agent short of ideas will walk past. So the database carries the rule and the tools enforce it.

Two policies, not one "protected" flag, because the questions are independent. The incident's database had data that mattered, so a reset was wrong, yet reconciling it was right. A single flag cannot say that.

The marker holds the policies, and the ref declares them, for the same reason the marker holds the contract hash: a database must be readable on its own, without a checkout ([ADR 021](ADR%20021%20-%20Contract%20Marker%20Storage.md)). A plan made offline against a ref needs that database's policies, so the ref declares them. The two are desired state and actual state, the split the migration model already uses for contracts.

A policy changes only with explicit consent because a command that both enforces a policy and rewrites it from the ref it is given would override the policy it is meant to enforce. The consent is a flag on the deploy, not a separate command, because a CD pipeline can only deploy what is committed. The policies are written when the run succeeds so a failed deploy never leaves a loosened policy and none of the change that needed it.

## Consequences

- `RefEntry` gains an optional `policies` field, and every ref writer keeps the fields it does not change ([ADR 218](ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md)).
- The marker's `meta` carries `policies`. The framework owns that key: it exports the key, the stored form, the parser and the comparison, and the targets write the value it gives them without interpreting it. Every marker write on every target preserves the `meta` keys it does not own ([ADR 021](ADR%20021%20-%20Contract%20Marker%20Storage.md)).
- The control API's `migrate` and `dbUpdate` take the ref entry and `permitPolicyChange`.
- [ADR 287](ADR%20287%20-%20Prisma%208%20has%20no%20db%20push%20to%20production.md)'s rule that production changes only through migrations is now something a database states about itself.
- The policies stop mistakes, not deliberate workarounds: anyone who can write the marker table, or who passes the flag with an edited ref, can change them. A privileged role for policy writes is a follow-up.
- Control policy ([ADR 224](ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md)) is unrelated: it says whether Prisma may write a given database object.

## Alternatives considered

- **Better error and skill text only.** Rejected: prose is what failed.
- **A single "protected" flag.** Rejected: it cannot describe a database whose data matters but which may be reconciled.
- **The marker names its ref and the ref holds the rules** (the Rails model). Rejected: the database could not be read without a checkout.
- **A deploy always applies its ref's policies.** Rejected: it would override the policy it enforces.
- **A deploy that proceeds on a mismatch and reports it as pending.** Rejected: the ref would stop describing its database, and plans made against it could be refused at apply.
- **Writing the new policy before the migrations run.** Rejected: a failed MongoDB deploy would leave a loosened policy behind.
- **A ledger row for every policy change.** Rejected: the ledger's rows are applied migrations ([ADR 228](ADR%20228%20-%20Migration%20apply%20ledger%20is%20a%20per-migration%20journal.md)), it has no schema upgrade path, and the ref file's git history already records what was declared.
- **A separate `db policy set` command.** Rejected: a pipeline only deploys, and a second way to change a policy is a second path around review.
- **A new marker column.** Rejected: `meta` exists on every target for fields added later.
