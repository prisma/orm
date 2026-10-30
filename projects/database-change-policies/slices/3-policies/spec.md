# Slice 3: refs declare policies, the marker records them, and the change policy is enforced — spec

Linear: [TML-3727](https://linear.app/prisma-company/issue/TML-3727). Project spec: [`../../spec.md`](../../spec.md), sections *Policies*, *Where policies are stored*, *What each command does*, *Refs and databases must agree* and *Errors*. Branch: `tml-3727-policies`.

## At a glance

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

A deploy to that ref writes the policies into the database's marker when told it may, and every command obeys what the marker says:

```text
$ prisma db migrate --to production --db $PROD
✖ The ref's policies differ from the database's (MIGRATION.POLICY_MISMATCH)
  why  production declares change: migrate; the database has change: migrate, reconcile.
  next Make the ref match the database, or have whoever owns the database apply the ref's policies.

$ prisma db migrate --to production --permit-policy-change --db $PROD
✔ Applied 2 migrations; the database now permits change: migrate

$ prisma db update --db $PROD
✖ This database's change policy permits only migrations (MIGRATION.CHANGE_POLICY_FORBIDS)
  why  The marker records change: migrate, so db update may not move it.
  next Author a migration with prisma migration plan, then deploy it.
```

## Chosen design

### The policy types live in the framework's control types

`packages/1-framework/1-core/framework-components/src/control/` gains, beside `MigrationOperationPolicy`:

```ts
export type ChangeStrategy = 'migrate' | 'reconcile';
export type DataLossLevel = 'data-loss-forbidden' | 'data-loss-with-consent' | 'data-loss-permitted';
export type AccessWideningLevel = 'access-widening-forbidden' | 'access-widening-with-consent' | 'access-widening-permitted';

export interface DatabasePolicies {
  readonly change: readonly ChangeStrategy[];
  readonly dataProtection: { readonly dataLoss: DataLossLevel; readonly accessWidening: AccessWideningLevel };
}

/** What a ref declares: every key optional; an absent key declares nothing. */
export type DeclaredPolicies = …;

export const DEFAULT_POLICIES: DatabasePolicies = {
  change: ['migrate', 'reconcile'],
  dataProtection: { dataLoss: 'data-loss-with-consent', accessWidening: 'access-widening-with-consent' },
};

export function policiesOf(marker: ContractMarkerRecord | undefined): DatabasePolicies;
export function policyDifferences(declared: DeclaredPolicies, inForce: DatabasePolicies): readonly PolicyDifference[];
```

`policiesOf` reads `marker.meta.policies`, validates it with arktype, and fills every absent setting from `DEFAULT_POLICIES`. A `meta.policies` that fails validation is a corrupt marker row and fails as `CONTRACT.MARKER_ROW_CORRUPT`; the framework function returns a result and the CLI raises the error, with the space. `policyDifferences` compares only the keys the declaration carries. The name is `DatabasePolicies`, never `policy` alone: the runner's `options.policy` is already the allowed-operation-classes setting.

### Refs

`RefEntry` in `packages/1-framework/3-tooling/migration/src/refs.ts` gains `readonly policies?: DeclaredPolicies`, validated by the file's arktype schema with the same error (`MIGRATION.INVALID_REF_FILE`) for a bad value. Unknown keys inside `policies` are rejected, so a typo such as `dataloss` is caught when the ref is read.

**Every writer keeps what it did not change.** Today `migration ref set` (`control-api/operations/ref.ts`), ref advancement after `db init`, `db update` and `db migrate --advance-ref` (`control-api/operations/ref-advancement.ts`) and `db sign` (`orm/db/sign.ts`) each call `writeRef` with `{hash, invariants: []}`, which erases the invariants a person wrote. They are replaced by one primitive in `refs.ts`:

```ts
export async function advanceRef(refsDir: string, name: string, hash: string): Promise<RefEntry>;
```

It reads the existing entry if there is one, writes `{...existing, hash}`, and returns what it wrote. A ref that does not exist yet is written as `{hash, invariants: []}`. The control API's `ref set` result reports the entry's invariants and policies as written, not `[]`.

### The marker

`meta.policies` holds a full `DatabasePolicies` or nothing. It is written only by a run given `--permit-policy-change`, through the runner's marker update, so ADR 021's rule that the runner is the only marker writer still holds. The runner options gain `readonly databasePolicies?: DatabasePolicies`; when present, the marker update sets `meta.policies` to it.

**Every marker writer preserves `meta`.** The rule for all four targets: a marker update that does not set `meta.policies` leaves it as it is. Today's offenders:

- MySQL's `upsertMarkerRow` (`packages/3-targets/mysql/…/marker-ledger.ts`) writes `meta = '{}'` on every upsert. It merges instead, or writes `meta` only when inserting.
- Each target's `initMarker` writes a fresh row; it runs only when no marker exists, so it has nothing to preserve, but it must accept `databasePolicies` so a first deploy with a ref that declares policies records them.

The write joins the run's transaction on Postgres, SQLite and MySQL. On MongoDB it is the compare-and-swap marker update after the last migration, so a failed run leaves the policies as they were.

### The control API

`MigrateOptions` replaces `refHash`, `refInvariants` and `refName` with one field, and gains the consent:

```ts
readonly ref?: { readonly name: string } & RefEntry;
readonly permitPolicyChange?: boolean;
```

`DbUpdateOptions` gains the same two. `DbSignOptions` gains nothing: signing reads the marker it is about to overwrite.

Composer passes `refHash` today; the upgrade fragment under `upgrade-instructions/pending/` tells it to pass `ref` and, from slice 5, `permitPolicyChange`.

### What each operation does, in order

**`migrate`** (`control-api/operations/migrate.ts`), per contract space, before any DDL:

1. Read the marker; `policiesOf` gives the policies in force.
2. If a ref was given and `policyDifferences(ref.policies, inForce)` is not empty: without `permitPolicyChange`, fail with `MIGRATION.POLICY_MISMATCH`. With it, the run's policies are the in-force ones overlaid with the ref's declarations, and the marker update will write them.
3. If the run's `change` lacks `migrate`, fail with `MIGRATION.CHANGE_POLICY_FORBIDS`.
4. Plan the path as today. The data protection check on the planned migrations is slice 4.
5. If nothing is pending and no policy is to be written, return "already up to date" as today. If nothing is pending but policies are to be written, run the runner with zero edges so it writes the marker; the result says what changed.
6. Run, writing `meta.policies` with the marker.

The policies are the database's, not a space's: they are read from and written to the application space's marker, and steps 1 to 3 run once per run. An extension space's marker never carries policies; the application space's policies govern every space the run moves.

**`dbUpdate`** (`control-api/operations/db-update.ts` and `db-run.ts`): steps 1 to 3 the same, with `reconcile` in step 3. In `plan` mode (the dry run) a refusal is reported the same way, so an agent previewing sees the refusal before it tries to apply.

**`db sign`**: reads the marker; if one exists and its `change` lacks `reconcile`, fails with `MIGRATION.CHANGE_POLICY_FORBIDS`. No marker means adoption; nothing refuses it. Signing never changes policies.

**`migration status --to <ref>`** with a database: after the existing applied-and-pending report, a `differences` block lists each setting the ref declares that differs from the marker's, and the summary line says `policies differ from <ref>`; `--json` carries `policyDifferences`. The command's exit code is unchanged.

**`migration plan --to <ref>`**: unchanged in this slice; its data protection check is slice 4.

### The CLI

`db migrate` and `db update` gain `--permit-policy-change` (boolean). The flag's help text: `Write the ref's declared policies into the database before enforcing them`. No error suggests it: no next action proposes it, and `POLICY_MISMATCH` never hints at it. A next action that repeats the command the user ran (for example "run db migrate again" after a failed migration) repeats the flags the user gave, including this one; it never adds it. The skill documents it.

`db migrate --to <ref>` and `db update --to <ref>` resolve the ref as today and also pass the whole entry as `ref`.

### Errors

One line per field; the terminal wraps. Every code is registered in `docs/reference/error-reference.md`.

**`MIGRATION.POLICY_MISMATCH`**
- summary: `The ref's policies differ from the database's`
- why: `<ref> declares <setting>: <declared>; the database has <setting>: <in force>.` One sentence per differing setting, joined with spaces. Strategy sets print comma-separated.
- next: `user-choice`: `Make the ref match the database, or have whoever owns the database apply the ref's policies.`
- meta: `spaceId`, `refName`, `differences: [{setting, declared, inForce}]`.

**`MIGRATION.CHANGE_POLICY_FORBIDS`**
- summary, when `reconcile` is refused: `This database's change policy permits only migrations`; when `migrate` is refused: `This database's change policy permits only db update`.
- why: `The marker records change: <strategies>, so <command> may not move it.` When the refusal comes from the ref's declaration under `--permit-policy-change`, `<ref> declares change: <strategies>, so <command> may not move it.`; `meta.change` is then the declared strategies.
- next, `reconcile` refused: `user-choice`: `Author a migration with {bin} migration plan, then deploy it.` `migrate` refused: `run-command`, label `Reconcile the database`: `{bin} db update --to <target> [--db <url>]`.
- meta: `spaceId`, `command` (`db update` | `db sign` | `db migrate`), `change` (the strategies in force).

**`MIGRATION.MARKER_MISMATCH`** (built in `utils/marker-mismatch.ts`) now takes the policies in force. When `change` includes `reconcile`, the next actions are the two `db update` commands only; the conditional sentence "Unless this database changes only through migrations…" goes. When it does not, the single `user-choice` from the project spec: `This database's change policy permits only migrations. Author migrations that bring it back onto the graph: one from <last graph hash> to its current contract, then one from there to <target>. Commit them and deploy again.` (`from the nearest contract in the migration graph` when there is no last graph hash.) `meta` gains `change`.

### Documents

- **ADR 314 — Databases record a change policy and a data protection policy.** States the two policies and their levels, the ref-declares / marker-records split, the agreement rule with explicit consent, the defaults, and that the ledger is untouched. Supersedes ADR 287's "`db update` is for development only" (ADR 307 already notes the wording; 309 is where the replacement rule lives). Lists the alternatives from `design.md`.
- ADR 021 and ADR 218: a status-line note pointing at ADR 314 for `meta.policies` and the ref's `policies` field. Accepted ADRs are not edited beyond that.
- `docs/glossary.md`: entries for change policy, data protection policy, their values, and a sentence distinguishing them from control policy; the `migrate` entry widens to "bring the database to a ref, applying its declared policies with consent".
- `skills/prisma-8/`: `references/migrations.md` documents the ref field, the marker, `--permit-policy-change` and both errors, and replaces the "Unless this database changes only through migrations" guidance with "read the error; it names the one recovery the policy permits"; `references/debug.md` lists both codes; `SKILL.md`'s rule gains "the database's change policy decides which".
- `docs/reference/error-reference.md`: the two new codes and the changed `MARKER_MISMATCH` meta.
- `upgrade-instructions/pending/database-policies/app/instructions.md`: `MigrateOptions.ref` replaces the three ref fields; `permitPolicyChange`; the runner's `databasePolicies` option.

## Coherence rationale

The ref field, the marker field, the comparison and the enforcement are one feature: a ref that declares policies nobody enforces is noise, and enforcement without a way to set the policy is a lock with no key. Data protection enforcement is left to slice 4 because it needs per-target classification of recorded operations, which is its own design question.

## Scope

**In:** everything above, on Postgres, SQLite, MySQL and MongoDB; tests.

**Out:** data protection enforcement (slice 4); Composer (slice 5); a privileged role for writing policies; a `db policy` command.

## Pre-investigated edge cases

| Case | Expected |
|---|---|
| Existing database, no `meta.policies`, ref without `policies` | Nothing compared, nothing written, every command behaves as today |
| Ref declares only `change`, marker has nothing | Only `change` is compared; with the flag, the marker gets the full `DatabasePolicies` with the data settings at their defaults |
| Ref declares policies equal to the defaults, marker has nothing | No difference; nothing written |
| `db migrate --to production --permit-policy-change` with nothing pending | The runner runs zero edges and writes the marker; output says `Policies updated` and names the settings |
| Postgres run fails after the policy check | Transaction rolls back; `meta.policies` unchanged |
| MongoDB run fails on the second migration | First migration applied; `meta.policies` unchanged; retry with the flag writes it |
| `db update --dry-run` on a migrations-only database | `CHANGE_POLICY_FORBIDS`, nothing planned |
| `db sign` on a database with no marker | Proceeds (adoption) |
| `db sign` on a migrations-only database | `CHANGE_POLICY_FORBIDS` with `command: db sign` |
| Extension space marker with `change: [migrate]` | `db update` refuses on that space too |
| Marker `meta.policies` is not a valid object | `CONTRACT.MARKER_READ_FAILED` |
| `migration ref set production <hash>` on a ref with policies and invariants | Both kept |
| `db update` advancing the `db` ref that carries policies | Kept |
| MySQL `db migrate` twice | `meta.policies` survives the second run's upsert |
| Off-graph marker, `change: [migrate]` | `MARKER_MISMATCH` with the single migration action |
| Off-graph marker, default policies | `MARKER_MISMATCH` with the two `db update` actions only |

## Slice-specific done conditions

- Integration tests on Postgres, SQLite, MySQL and MongoDB: a deploy with a mismatching ref fails before any DDL; with the flag it writes `meta.policies` and applies the migrations in one run; a policy-only run writes the marker; a failed run leaves the policies unchanged; `db update` and `db sign` are refused under `change: [migrate]`; `db update` and `db migrate` behave as today on a database with no policies.
- Unit tests: `policiesOf` defaults and validation; `policyDifferences`; `advanceRef` keeps invariants and policies for all three callers; both error builders assert whole envelopes; `marker-mismatch` for both policy cases.
- The MySQL marker test proves `meta` survives an upsert.
- `pnpm check:error-reference` passes; the skill, glossary and ADRs say what this spec says.

## Decisions after the first review

The architect and code reviews (in `reviews/`, not committed) found the following; each is decided here and fixed in the slice.

| Finding | Decision |
|---|---|
| The ADR number 309 was taken on `main` while the branch was open | The decision record becomes the next free number after rebasing on `main`. |
| Policies were read and enforced per contract space, but only the application space's were ever written | Policies belong to the database. They live on the application space's marker and govern every space. |
| `TargetRef` (`{name?: string} & RefEntry`) let a nameless entry carry policies and meant different things on `migrate` and `dbUpdate` | `MigrateOptions` and `DbUpdateOptions` take `ref?: NamedRef` (`{name: string} & RefEntry`, required name) for policies and invariants, and `migrate` keeps a separate `targetHash?: string` for a `--to` that names a hash, `@db` or `@empty`. `dbUpdate` refuses, as an internal error, a `ref` whose hash is not the contract it reconciles to. |
| An invalid `meta.policies` raised `CONTRACT.MARKER_READ_FAILED`, a connectivity error, rebuilt by catching it by code | `CONTRACT.MARKER_ROW_CORRUPT`, raised once in the CLI from a result the framework parser returns. |
| `change: []` was accepted, and its advice looped between the two commands | `change` holds at least one strategy, in the ref and in the marker. |
| A policy-only `db update` wrote a zero-operation ledger row | The runner decides the marker write and the ledger write separately; a run that applies no operation writes no ledger row. |
| The policy check read the marker before the runner took its lock | The runner receives the policies the check used and compares them with the marker under its lock, as it already compares the hash; a difference fails the run as a concurrent change. |
| Postgres wrote `meta` back after reading it, so a concurrent write to another `meta` key could be lost | Postgres sets `meta.policies` with a server-side `jsonb` merge; SQLite and MySQL do it inside their exclusive transaction. |
| `db migrate` checked the policies twice, in the command and in the control API | Once, in the control API. |
| The `meta.policies` key and its stored form had no owner | The framework exports the key and the serialiser, and the overlay of a declaration on the policies in force; the targets and the CLI use them. Each value list is defined once, as a constant array the types and the schema derive from. |
| The internal names (`policiesOf`, `PolicyDifference`, `DEFAULT_POLICIES`, `policiesUpdated`) collide with the operation policy, control policy and row-level-security policies | Internal names say "database policies". The public codes `MIGRATION.POLICY_MISMATCH` and `MIGRATION.CHANGE_POLICY_FORBIDS` stay as the project spec names them. |
| A difference named `dataLoss` while the ref file nests it under `dataProtection` | A difference names the ref file's key path: `change`, `dataProtection.dataLoss`, `dataProtection.accessWidening`. |
| A re-run command in failure advice dropped `--permit-policy-change` | It repeats the flags the user gave (see *The CLI*). |
| `db sign`'s refusal could not repeat `--config` | `DbSignOptions` gains `invocation`. |
| `db migrate --show` did not preview a policy refusal | It reports the refusal the run would hit, with the same envelope. |
| MySQL and MongoDB did not run the `db migrate --to <ref>` journeys; the failed-run guarantee was tested through the CLI only on Postgres and MongoDB | Both are added on all four targets. The MongoDB failed-run test also checks that the first migration stayed applied and that a retry with the flag records the policies. |
| ADR 307 and the Migration System doc did not mention policies | ADR 307 gains a status note; the subsystem doc describes the ref field, the marker field and the checks. |

Deferred: MongoDB reports a failed schema command as `CLI.UNEXPECTED` rather than `MIGRATION.EXECUTION_FAILED` ([TML-3779](https://linear.app/prisma-company/issue/TML-3779)); it predates this slice. The marker-destination shape declared in many places predates the slice; the slice adds the field through one framework type where the runners receive it, and the remaining copies are a separate refactor.
