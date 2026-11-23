# Slice 4: the data protection policy is enforced — spec

Project spec: [`../../spec.md`](../../spec.md). Decision record: [ADR 320](../../../../docs/architecture%20docs/adrs/ADR%20320%20-%20Databases%20record%20a%20change%20policy%20and%20a%20data%20protection%20policy.md). Linear: TML-3728.

## At a glance

A production database's ref declares that nothing may lose its data, and the database records it:

```text
$ prisma db migrate --db $PROD
✘ [MIGRATION.DATA_PROTECTION_FORBIDS] This database's data protection policy forbids data loss
  why: The marker records dataLoss: data-loss-forbidden. Migration 20261118T0900_drop_legacy drops column "user"."legacy_name".
→ This database forbids losing data, so this operation cannot run on it. Take it out of the migration. To drop the data, whoever owns the database must first change its data protection policy.
```

Nothing ran. `db update` refuses the same change, even with `--delete`. `migration plan --to production` refuses to write the migration in the first place.

Before this slice the two settings are stored and compared but nothing acts on them.

## Chosen design

### The settings a run is checked against

`checkRunPolicies` already returns the policies in force and, with `--permit-policy-change`, the policies to write. Every check below reads `toWrite?.policies.dataProtection ?? inForce.dataProtection`, the same rule the change policy check uses. A database with no marker has the defaults (`with-consent` for both), so nothing changes for it.

The policies are the database's, so they cover every contract space a command moves, extension spaces included.

### `db migrate` (and so a Composer deploy)

`resolveRecordedPath` already lists a recorded path's `dataLoss`: every operation whose `operationClass` is `destructive`. It lists `accessChanges: []`. This slice fills `accessChanges` from the target (next section) and makes the migrate operation read both, right after `checkRunPolicies` and before `runMigration`:

- `data-loss-forbidden` and any space's path lists a data loss: refuse.
- `access-widening-forbidden` and any space's path lists an access change: refuse.
- `with-consent` and `permitted`: run.

`db migrate --show` reports the same refusal, because it shows what `db migrate` would do.

No new check runs inside the runner. The runner already fails the run when the policies it was given differ from the marker under its lock, so a policy tightened by another process between the check and the run is caught.

### Which recorded operations change access

The framework's `ControlFamilyInstance` already has `storageNameOf(operation)`, which `resolveRecordedPath` uses to name what a recorded operation acts on. It gains a sibling, `accessChangesOf(operations)`, which returns `MigrationAccessChange[]` for a migration's recorded operations. The SQL family delegates to its target, as it does for the operation preview. The name and the return type are the ones the planners already use.

- **Postgres:** `disableRowLevelSecurity` (`widens: true`) and `dropRlsPolicy` (`widens: false`), recognised from `target.details.objectType` (`rowLevelSecurity`, `rlsPolicy`) and the operation's `id`, which the operation factory builds. A dropped policy is not an access change when a policy the same migration creates, under the same name or generated-name prefix, is still there when the migration ends, as in the planner. Renaming a policy is not an access change. Nothing reads the label.
- **SQLite, MySQL, MongoDB:** no such operations exist; the function returns none.

`access-widening-forbidden` refuses every listed access change, whether `widens` is true or false. That matches `db update`, which asks about both, and the project spec's definition (an operation that changes who can read or write rows).

**Known limits:** what a `rawSql` operation or a data transform does is not read, so a hand-written `ALTER TABLE … DISABLE ROW LEVEL SECURITY` is not recognised. Adding a policy and changing a policy's condition are not access changes to the planner today, so no command asks about or refuses them. The decision record and the skill say so.

### `db update`

After planning, with the user's `--rename` statements applied:

| Level | Data loss | Access change |
|---|---|---|
| `forbidden` | Any loss still in the plan refuses the run. `--delete`, the control API's `acceptDataLoss`, and an interactive answer cannot permit it. The question is never asked. | The same, for `--allow` and `acceptAccessChanges`. |
| `with-consent` | As today. | As today. |
| `permitted` | Nobody is asked; every unanswered loss is applied as a delete. `--rename` still applies. `--delete` given anyway is accepted. | Nobody is asked. `--allow` given anyway is accepted. |

A dry run refuses under `forbidden` exactly as a real run does.

### `migration plan --to <ref>`

`resolveToForPlan` returns the ref's declared `policies` when `--to` names a ref. After planning, with `--rename` and `--convert` statements applied:

- the ref declares `data-loss-forbidden` and the plan still loses data: refuse, and write nothing;
- the ref declares `access-widening-forbidden` and the planner lists an access change: refuse, and write nothing.

A setting the ref does not declare is not checked. `migration plan` given no ref checks nothing.

### The error

`MIGRATION.DATA_PROTECTION_FORBIDS`, built in `utils/policy-errors.ts` beside `errorChangePolicyForbids`, with the same `source` (the marker, or the ref when the run was given `--permit-policy-change` or when `migration plan` reads a ref).

- **summary:** says which setting forbids the change.
- **why:** the setting and where it is recorded, then each refused operation: its subject, and for `db migrate` the migration that contains it.
- **meta:** `{ spaceId, command, settings: [{ setting, level }], operations: [{ setting, spaceId, migration?, operationId?, subject, label, loss? }] }`. `loss` says how a planned operation loses data (`drop` or `typeChange`), when the plan says so.
- **next actions:** `user-choice`, no command. For data loss: the operation cannot run on this database; state a `--rename` if it was only a rename, convert a type change with `migration plan --convert`, or keep the data; really dropping it takes a change to the database's policy by its owner first. A migration that copies the data and then drops it is still refused. For access: change the contract or the migration so it does not change who can read or write the rows, or have the owner change the policy first. It never offers `--permit-policy-change`, `--delete` or `--allow`.

When one run breaks both settings, one error reports both.

## Scope

**In:** the control API operations `migrate`, `migrate-show`, `db-run` and `migration-plan`; `plan-resolution`; `resolveRecordedPath`; `ControlFamilyInstance.accessChangesOf` and its SQL, Postgres, SQLite, MySQL and MongoDB implementations; the error; `docs/reference/error-reference.md`; the glossary; the `prisma-8` skill; the CLI README; the Migration System doc; a note in ADR 320 on recorded access changes and the opaque-operation limit; upgrade instructions for extension authors.

**Out:** recognising access changes inside raw SQL; Composer; any new flag.

## Edge cases settled

- **A loss answered by `--rename`** is not a loss, under every level.
- **`--permit-policy-change` that loosens `forbidden` in the same run:** the run is checked against the ref's settings, so it runs, and the policy is written on success.
- **`--permit-policy-change` that tightens to `forbidden` with a lossy migration pending:** refused; the policy is not written.
- **A policy-only run** (nothing pending) has no operations, so nothing is refused.
- **An extension space's migration loses data under `forbidden`:** refused; the error names the space.
- **`db update` under `permitted` in a script with no terminal:** runs without `CLI.CONSENT_REQUIRED`.
- **`db init`:** no marker, no policy, unchanged.

## Done when

- Integration tests through the CLI on Postgres, SQLite and MongoDB: `db update` refuses, asks and proceeds under the three `dataLoss` levels; `db migrate` refuses a migration that drops a column under `data-loss-forbidden`, with and without a ref, and changes nothing.
- On Postgres: the same three levels for access changes in `db update`; `db migrate` refuses a recorded `disableRowLevelSecurity` and a recorded `dropRlsPolicy` under `access-widening-forbidden`.
- `migration plan --to <ref>` refuses and writes no migration directory when the ref forbids what the plan does.
- Unit tests assert the whole error envelope.
- `pnpm check:error-reference`, `pnpm lint:deps`, `pnpm lint:ratchets` and `pnpm check:upgrade-coverage` pass.

## Framework domain

`ControlFamilyInstance.accessChangesOf`, the `accessChangesOf` input threaded through `resolveRecordedPath` beside `storageNameOf`, and the doc comment on `PerSpacePlan.accessChanges` change the framework domain. The exemption granted for database policies on 2026-10-30 covers them: the policy is a framework concept, and the framework cannot name a target's operations itself.

## Failure states

Every refusal happens before the first operation runs. A refused `migration plan` writes no migration directory; it may already have re-pinned extension artifacts, which it does before planning on every run. A refused `db migrate` or `db update` leaves the database, the marker and the ref file as they were.
