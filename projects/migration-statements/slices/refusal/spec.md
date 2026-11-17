# Slice spec — Both commands refuse data loss until the user states what each operation means

**Project:** [`projects/migration-statements/`](../../spec.md) · **Slice 2** · **Linear:** [TML-3476](https://linear.app/prisma-company/issue/TML-3476) · **Branch:** `tml-3476-statement-refusal` (on top of slice 1, prisma/orm#30638) · **Depends on:** the engine slice [`../engine-statement-prompt/spec.md`](../engine-statement-prompt/spec.md), published as `@prisma/cli-engine` 0.7.

## At a glance

A user removes the `Legacy` model and renames `Profile` to `User`, then plans without saying what they mean about `Legacy`:

```text
$ prisma migration plan --name tidy-users --rename Profile:User
✖ [CLI.CONSENT_REQUIRED] 1 operation would lose data, and the session is not interactive.
  Table "Legacy" would be dropped and its rows lost.
→ To rename it: --rename Legacy:<new name>
→ To delete it: --delete Legacy
```

With `--delete Legacy` the plan is written, and `Drop table "Legacy"` is listed as `destructive` with the statement that allowed it. Run by a human in a terminal, the same command asks:

```text
? Table "Legacy" would be dropped and its rows lost. What do you mean?
  (delete, or rename Legacy:<new name>) › delete
```

`prisma db update` behaves the same way against a live database. `--confirm <database>` no longer consents to data loss on either command, and there is no blanket consent: each operation that loses data has its own statement. Before `db update` drops a row-level-security policy or disables row-level security on a table, it asks the same way with the verb `allow`: `--allow User` consents to one operation that changes who can read or write `User`'s rows.

## Chosen design

### What is refused

An operation is refused when its class is `destructive`, and after this slice an operation is `destructive` only when it loses rows or values:

| Operation | Class after this slice | Subject |
| --- | --- | --- |
| Drop table (Postgres, SQLite), drop collection (MongoDB) | destructive | the model |
| Drop column (Postgres, SQLite) | destructive | the field |
| Alter column type outside the known safe widenings (Postgres); SQLite table rebuild caused by a type change | destructive | the field |
| `SET NOT NULL`, safe type widenings (`int2`→`int4`→`int8`, `float4`→`float8`), SQLite rebuilds caused only by a nullability tightening | widening | none |
| MongoDB index drop, validator tightening, change-stream image settings | widening | none |

`widening` means an operation that changes existing structure without losing data; its doc comment says so. A refused non-drop (the type change) is consented with `--delete <field>` in this slice, as the project spec's DoD says; `--convert` replaces that in slice 3.

### The structured refusal

The family planner's success result gains `dataLoss: readonly MigrationOperationSubject[]`, one entry per destructive operation in plan order: `{ operationIndex, subject }`. `subject` is a `MigrationSubject`: `{ kind: 'model' | 'field', namespaceId, model, field? }` when the family can map the operation's table or column back to the origin contract (`fromContract`), else `{ kind: 'storage', name }` with the storage name as the planner knows it. The framework type lives beside `AppliedMigrationStatement` and carries no family vocabulary. The SQL family maps through `model.storage.table` and `fields[f].column`; MongoDB through the collection name. A table no contract declared (drift) is a `storage` subject.

The CLI turns each entry into one engine question (`ctx.prompt.statements`): question text from the operation's label, `subject` written as the coordinate (`Legacy`, `User.name`, or the storage name), `verbs: ['rename', 'delete']` for a model or field subject and `['delete']` for a storage subject. The engine handles the command line, the non-interactive refusal that lists every question, and the interactive prompt. The CLI never reads the TTY.

### `--delete` and how statements consent

- `--delete <coordinate>` is an engine statement flag (each command declares its verbs from one shared table: `migration plan` declares `rename` and `delete`, `db update` all three). Its text is a model or field coordinate in slice 1's grammar, or the storage name when the refusal said so. A namespace coordinate (`--delete billing`) is deferred to slice 3, with the namespace renames (decided 2026-10-08 at the whole-slice review: the engine answers a question only by a value that equals its subject or starts with it, so a namespace-wide consent needs the ORM to pre-answer from the namespace, which slice 3 builds with its namespace nouns). In this slice every `delete` names one model, field or storage object.
- A `delete` never reaches the planner. Planning runs first with the `rename` statements; the plan's `dataLoss` entries are then matched against the answers. `validate` for a `delete` answer checks the text equals the subject; the text is any non-empty string, because a storage name may contain `:`. `validate` for a `rename` answer resolves the statement with slice 1's resolver against the two contracts and accepts only when its old side is the subject.
- A `rename` answered at the prompt or on the command line that passes validation is added to the statement list and the plan is run again, exactly as if it had been typed on the command line; the second plan must have no `dataLoss` entry for that subject, else the run fails (`MIGRATION.STATEMENT_DID_NOT_RESOLVE_LOSS`). Order between a run's `--rename` and `--delete` values comes from the engine's ordered verb-flag list.
- The missing-origin check in `resolve-statements.ts` moves inside the per-statement loop: with no origin contract, `rename` statements fail with `MIGRATION.STATEMENT_ORIGIN_UNKNOWN` and `delete` statements still work, because they are matched against the plan, not resolved against a contract.
- `--confirm` is no longer asked for by either command. `guardDestructiveChanges`, the plan-hash consent round trip, `MIGRATION.DESTRUCTIVE_CHANGES` and `CONSENT_PLAN_MISMATCH` go, on both commands, including `migration plan`'s auto-baseline consent, which becomes the same per-operation refusal. The control API keeps `acceptDataLoss` as the programmatic equivalent and gains `statements` as the preferred form.
- `migration plan` refuses before writing anything (slice 1's rule stands). An auto-baseline whose delta is refused writes nothing.

### Access widening (`allow`)

`db update` asks before applying an operation that changes who can read or write rows: disabling row-level security (which widens access) and dropping a row-level-security policy (which changes it; dropping a permissive policy narrows). Both stay `widening` as operation classes, and each operation is its own question, answered by its own `--allow <Model>`. The family's success result lists them in `accessWidening: readonly { operationIndex, subject, widens }[]` with the model as subject (`MigrationAccessChange`; `widens` is true for disabling row-level security, false for a policy drop); the CLI asks with verb `allow` only (`--allow User`). `migration plan` does not ask: the written migration is reviewed before it runs. The transient DROP in a policy replacement (DROP then CREATE of a changed policy) is not listed.

### Output

The `Statements applied` block gains `delete` and `allow` lines (`delete model "Legacy" (1 operation)`), and JSON `appliedStatements` entries carry `verb`. `describeMigrationStatement` writes them. A destructive operation in the human plan output keeps its `⚠` marker.

### MongoDB

The Mongo planner keeps refusing `rename` statements. Since `delete` never reaches a planner, a MongoDB project consents to a collection drop with `--delete <Model>` and is not blocked before slice 4.

## Coherence rationale

The refusal, the verb that answers it, and the removal of the blanket consent ship together because a release with both consents is contradictory and a refusal with no way out is unshippable (project transitional-shape constraint 2). The reclassification ships here because the refusal would otherwise block adding a required field. The `allow` consent ships here because it is the same prompt shape and Will tied it to this slice on prisma/orm#30638.

## Scope

**In:** the reclassification on all three targets; `dataLoss` and `accessWidening` on the planner result and the family mapping to subjects; the `delete` and `allow` verbs through the engine; the per-statement origin check; removal of the blanket consent paths and their errors; output and JSON; the CLI README (`migration plan`, `db update`), the Migration System doc § Statements and § Operation Model, the error reference, the CLI Style Guide's consent section (statements are the data-loss form); upgrade fragments (app: `--confirm` no longer consents to data loss, `migration plan` refuses every plan that loses data; extension: `dataLoss`/`accessWidening` on the success result, `MigrationSubject`); journeys on Postgres, SQLite and MongoDB; the engine pin bumped to 0.7.

**Out:** `--convert`, `--backfill`, value and namespace renames (slice 3); MongoDB rename statements (slice 4); the `@@map`-only rename gap (decided 2026-10-07: no statement; the refusal keeps slice 1's manual steps); any storage-object statement syntax (deferred).

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| `--delete` names a model that is not dropped | `CLI.CONSENT_UNUSED` from the engine. |
| `--delete User` when only `User.name` is dropped | Unused; the refusal said `User.name`. A model delete does not cover its fields. |
| `--rename Legacy:Archive` where `Archive` is not in the destination | Slice 1's `STATEMENT_UNRESOLVED`, before planning. |
| `db update --db <url>` with no snapshot | `rename` fails as in slice 1; subjects are storage names; `--delete users` works. The refusal says the names are storage names because the origin contract is unknown. |
| A destructive operation inside an extension contract space | Listed with its storage subject; the app's statements cannot name it. |
| `migration plan --to <dir>^` (rollback) that drops a table | Refused like any plan; `--delete` consents. |
| Dry run (`db update --dry-run`) | Plans and lists `dataLoss`; asks nothing. |
| Same `--delete` twice | Second is unused. |

## Slice done conditions

- Project DoD journeys restricted to rename plus delete, on Postgres, SQLite and MongoDB: `migration plan --rename ... --delete Legacy` then `migrate`; the same through `db update` with no prompt; both commands refuse without `--delete`, and the refusal's `nextActions` contain the exact flag that then succeeds; `--confirm <database>` no longer consents; a second `db update` with the same statements fails on the first statement.
- A journey that adds a required field plans and applies with no refusal on all three targets.
- A `db update` on Postgres that drops a policy refuses without `--allow <Model>` and applies with it.
- `pnpm fixtures:check` with no churn except the example migrations whose classes changed; `lint:framework-vocabulary` count unchanged.

## Open questions

None.

## References

- [`../../spec.md`](../../spec.md) decisions 1, 2, 6; requirements 4, 10, 12. [`../../plan.md`](../../plan.md) slice 2. [`../../deferred.md`](../../deferred.md).
- [`../engine-statement-prompt/spec.md`](../engine-statement-prompt/spec.md).
- `docs/CLI Style Guide.md` § Destructive operation confirmation; `docs/architecture docs/subsystems/7. Migration System.md` § Operation Model.
- prisma-cli `packages/cli-engine/src/execution/prompts.ts`.
