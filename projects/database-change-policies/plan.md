# Database change policies: may db update run, and may a change lose data — plan

**Spec:** [`spec.md`](spec.md). **Rationale:** [`design.md`](design.md). **Linear:** [P-TML-1165](https://linear.app/prisma-company/project/databases-declare-how-they-may-change-a870e49c25a5).

## Summary

Five slices, one pull request each, three in `prisma/orm` and two in `prisma/composer`. Slice 1 fixes the off-graph error and the texts that misled the agent, so agents benefit before policies exist. Slices 3 and 4 add the policies. Slices 2 and 5 bring each change to Composer once an ORM release carries it.

```
1 (orm) ──► 2 (composer)
   └──► 3 (orm) ──► 4 (orm)
           └──► 5 (composer)
```

## Slice 1: the off-graph error, and no more reset advice (orm) (TML-3725)

**Outcome:** the control API's `migrate` returns structured envelopes instead of its own failure codes (`MIGRATION_PATH_NOT_FOUND`, `RUNNER_FAILED`). A database whose marker is not a graph node gets `MIGRATION.MARKER_MISMATCH` with the spec's summary and `why`, built from the ledger. A database in the graph with no path to the target gets `MIGRATION.PATH_UNREACHABLE`. The CLI's pre-DDL `MIGRATION.MARKER_MISMATCH` uses the same content and drops its two recoveries that cannot work. Nothing anywhere recommends a reset or scopes `db update` to local databases.

**Next actions in this slice:** policies do not exist yet, so the error cannot know which recovery a database permits. It lists both, each labelled with the kind of database it is for:

1. "Unless this database changes only through migrations, as production does, move it with db update; its data stays": `db update --dry-run`, then `db update`.
2. "Otherwise plan a migration" from the last graph hash to the database's contract, then to the target, and deploy again.

Slice 3 replaces this with the one recovery the database's policy permits. Without the labels, every database would look like it permits reconciliation, and the error would send agents to run `db update` on production.

**In scope:**
- the control API's `migrate` failures;
- `errorMarkerMismatch` and `errorPathUnreachable`;
- reading the ledger for the last graph hash;
- error-reference entries;
- the `prisma-8` skill: the rule at the top of `SKILL.md`, the "A database whose marker is not in the migration graph" section, the debug table and the routing triggers;
- the migration domain docs' wording for `db update`;
- ADR 307, which supersedes the drift recovery decision record's reset recoveries;
- the Migration System doc's recovery table.

**Builds on:** nothing. **Hands to:** slice 2, the envelopes Composer will show. Slice 3, the error that will choose its recovery by policy.

## Slice 2: Composer shows the control API's errors (composer) (TML-3726)

**Outcome:** Composer's deploy step shows the control API's envelope (summary, `why` and next actions) for every migrate failure. `noPathRefusal` and Composer's own `OrmMigrationFailureCode` values for these failures are gone.

**Builds on:** slice 1, released in an ORM `8.0.0-rc`. **Hands to:** slice 5.

## Slice 3: policies are recorded, compared and enforced for change policy (orm) (TML-3727)

**Outcome:**
- **Refs:** they accept `policies`, and every ref writer keeps the field.
- **The marker:** it stores the policies in force under `meta.policies` on Postgres, SQLite, MySQL and MongoDB. Other marker writes keep them.
- **The ledger:** it records policy changes.
- **The mismatch rule:** commands given a ref apply it, with `MIGRATION.POLICY_MISMATCH`, and `--permit-policy-change` on `db migrate` and `db update`.
- **`migration status --to <ref>`:** it reports a mismatch.
- **Enforcement:** `db migrate`, `db update` and `db sign` enforce the change policy with `MIGRATION.CHANGE_POLICY_FORBIDS`.
- **The off-graph error:** it gives the one recovery the database's change policy permits.

**In scope:**
- the ref schema and writer in `@internal/migration-tools`;
- marker reads and writes on the four targets;
- the ledger record and its writers;
- the control API operations and CLI commands above;
- the new decision record;
- glossary entries for change policy and the widened `migrate`;
- notes in the decision records on refs, the marker and the ledger;
- the skill's documentation of policies, the flag and the new errors.

**Builds on:** slice 1. **Hands to:** slice 4 (stored policies and the mismatch rule). Slice 5 (the control API's `permitPolicyChange` option and policy comparison).

**Note:** data protection settings are stored, compared and changed in this slice, because they share the storage and the mismatch rule. They are not yet enforced. Until slice 4 merges, the skill documents only the change policy as enforced.

## Slice 4: data protection is enforced (orm) (TML-3728)

**Outcome:**
- **`db update`:** it applies the three levels of `dataLoss` and `accessWidening` to its questions, as the spec's table says.
- **`db migrate`:** it refuses, with `MIGRATION.DATA_PROTECTION_FORBIDS`, a run containing a migration with a destructive operation under `data-loss-forbidden`, or an access-widening operation under `access-widening-forbidden`.
- **Targets:** each target provides the function that identifies access-widening operations in a recorded `ops.json` from their structure.
- **`migration plan --to <ref>`:** it checks the plan against the ref's declared data protection.

**In scope:**
- the planner's question handling;
- the runner-side check;
- the target functions for Postgres, SQLite and MongoDB;
- glossary entries for data protection;
- the skill's documentation of the levels.

**Builds on:** slice 3. **Hands to:** close-out.

**Design question this slice answers:** which recorded operations widen access on each target. Postgres has the row-level-security operations. SQLite and MongoDB may have none, and then their function returns no operations.

## Slice 5: Composer applies and compares policies (composer) (TML-3729)

**Outcome:**
- Composer's deployment resource accepts `permitPolicyChange` (default `false`) and passes it to the control API.
- The "already at target" check compares the target ref's declared policies as well as the hash and invariants, so a policy-only change deploys.

**Builds on:** slices 2 and 3, released. **Hands to:** close-out.

## Dependencies

- Slices 2 and 5 need an ORM `8.0.0-rc` release containing slices 1 and 3 respectively. Users of Composer get the improved error only when slice 2 ships in a Composer release.
- Each ORM slice reaches users, including the skill, in the next `8.0.0-rc` after it merges.

## Gates

- Each slice: typecheck and lint for every touched package; the touched packages' tests; `pnpm lint:deps`.
- Slices 1, 3 and 4: the integration and end-to-end files that run `db migrate`, `db update` or `db sign`, run locally before queueing; `pnpm fixtures:check` if ref or marker fixtures change.
- Slices 3 and 4: integration tests on Postgres, SQLite and MongoDB.
- Slices 2 and 5: Composer's `orm-migrate` unit and integration tests.

## Close-out

- Verify the project DoD in [`spec.md`](spec.md).
- File the follow-ups listed in [`design.md`](design.md) in Linear.
- Move anything long-lived out of `projects/database-change-policies/`. The new decision record holds the decisions.
- Strip repo-wide references to the folder, then delete it.
