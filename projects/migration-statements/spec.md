# Project spec — Destructive changes need stated intent

**Linear:** [Destructive changes need stated intent](https://linear.app/prisma-company/project/destructive-changes-need-stated-intent-7626c0107cd9) ([TML-3474](https://linear.app/prisma-company/issue/TML-3474)) · **Branch:** `tml-3474-migration-statements`

## Purpose

The migration planner diffs two states and cannot tell intent from the diff. A renamed model looks exactly like a dropped table plus a created one, and a removed model looks the same as one the user forgot. Today the planner plans the destruction and relies on a blanket consent prompt, or on a hand-written migration, to keep rows safe. Projects that use `db update` and keep no migration history cannot hand-write anything.

This project makes two things true. The planner refuses any operation that loses data unless the user has said what they mean about that operation. And the user says it on the command line, in the vocabulary of their contract, as a statement the planner acts on: a rename, a deletion, a conversion or a backfill. Nothing is inferred, nothing is asked, and nothing is written into the contract source.

This is the second attempt. The first stated intent in the contract source with `@@hint(was:)` and was shelved on 2026-10-05 as unintuitive. Its planner substrate is reused; its contract section is not.

## At a glance

A user renames the `Profile` model to `User`, renames its `name` field, and removes the `Legacy` model for good. The contract source already says all of that. The command says what it means:

```text
$ prisma migration plan --name tidy-users --rename Profile:User --rename User.name:User.fullName --delete Legacy
✔ Planned 5 operation(s)
  Rename table "Profile" to "User"                            widening
  Rename constraint "Profile_pkey" to "User_pkey"             widening
  Rename column "User"."name" to "fullName"                   widening
  Rename constraint "User_name_key" to "User_fullName_key"    widening
  Drop table "Legacy"                                          destructive
```

`migration.ts` carries `renameTable`, `renameColumn` and `dropTable` calls, the same file a user could write by hand. `prisma db update` with the same statements does the same against a live database. Without `--delete Legacy`, both commands refuse:

```text
✖ The plan would lose data. State what you mean about each operation:
  Table "Legacy" would be dropped and its rows lost.
    To rename it:  --rename Legacy:<new name>
    To delete it:  --delete Legacy
```

A type change gets the same treatment with its own statements:

```text
$ prisma migration plan --name age-to-int --convert User.age
⚠ migration.ts has a placeholder: replace it with the conversion, then run the file to re-emit.
```

## Decisions settled in discussion (2026-10-05)

The reasoning and the alternatives rejected are in [`design-notes.md`](./design-notes.md).

1. **Data loss is refused by default, in both commands.** An operation is destructive only when it loses data: dropping a model or field, deleting a value rows still carry, or changing a field's type in a way the database cannot keep. Drops of indexes, constraints, checks, policies and defaults lose nothing and are widening. `db update` already refuses through its consent prompt; `migration plan` gains the same refusal for every plan, not only auto-baselines.
2. **Intent is stated on the command line, up front.** There is no prompt that guesses whether a drop is a rename, and no detection of candidate pairs. The refusal is where the user learns what to type, and it prints each statement ready to paste. The eventual direction (see [`plan.md`](./plan.md) § Delivered: the interactive prompt and requirement 12 below) is that when a human runs the command in a terminal, the refusal becomes an interactive prompt that asks the user to state what each destructive operation is; the answers are the same statements. "No prompt" was the initial design stance, not a rule; the rule is that nothing is guessed.
3. **Four verbs, four nouns.** The verbs are `rename`, `delete`, `convert` and `backfill`. The nouns are namespace, model, field and value, addressed by contract coordinates such as `User`, `User.name`, `Status.ARCHIVED`, `Bug` and `Address.street`, with the namespace prefixed when the contract has more than one. Rename and delete apply to all four nouns; a model rename across namespaces is a move. Convert applies to fields and to variants whose discriminator value changed. Backfill applies to fields.
4. **Statements are intent, not hints.** A statement that cannot be resolved against the origin and destination contracts, or cannot be applied, is an error and nothing is planned. There is no "spent" or "ignored" statement. A statement that resolves and applies but changes nothing in storage, such as renaming a value object or a relation field, is reported as applied with no operations.
5. **Everything is in the application domain.** The command line never carries a table, column, collection, SQL expression or literal value. The framework resolves coordinates against the two contracts; the family turns the resolved statement into storage operations.
6. **`--delete` is per-operation consent and replaces `--confirm`.** Each destructive operation needs its own statement. A namespace delete covers everything in the namespace and the refusal still lists each model. The interactive consent question stays and asks per operation; answering it is the same as typing the statement.
7. **Convert and backfill scaffold the existing placeholder migration.** `--convert` writes the type change with `placeholder()` in the slot that carries the conversion: the `using` expression on Postgres, a data transform on Mongo. `--backfill` writes the scaffolded backfill transform. The user fills the slot in `migration.ts` and re-emits, exactly as the placeholder flow works today. Neither is available on `db update`, which has no file to fill; without `--backfill` the planner's existing temporary-default recipe applies, which loses nothing.
8. **The origin contract is required for renames and conversions.** `migration plan` has it from its origin ref. `db update` resolves the marker's contract hash in the local snapshot store. When no origin contract can be found, every rename and convert statement fails with one error, `--delete` still works, and the user hand-edits the migration if they have one.
9. **Statements compose in order** over a working copy of the origin, so a later statement names things by their new names. A swap of two names is refused in this project.
10. **One statement surface for every family.** Postgres and SQLite rename tables and columns; Mongo renames collections and rewrites documents for field renames; a value object field rename rewrites the stored JSON on SQL and the subdocuments on Mongo. Same statement, each family's own operations.

## Non-goals

- No prompt that guesses whether a drop is a rename, and no rename detection from matching columns or any other heuristic. A prompt that asks the human to state the intent, without guessing, is the stretch goal in [`plan.md`](./plan.md), not a non-goal.
- No intent in the contract source. `@@hint` and any attribute like it are not part of this project; the shelved attribute is not revived.
- No expressions, literals or values on the command line. A conversion or a backfill value is written into the migration file.
- No scaffolded migrations from `db update`.
- No split or merge of tables, no moving a field between models, no primary key changes, no moving a variant between single-table and multi-table storage, no making an existing model a variant. These stay hand-written data migrations.
- No `deprecated` lifecycle and no change to `db verify`.
- No reliance on the marker's `contract_json` column, which the docs call optional and diagnostic. The origin contract comes from the snapshot store or not at all.
- No reversal of the documented stance that `db update` is dev-only.

## Place in the larger world

- **Planner inputs.** Every planner takes a destination contract and an origin schema: derived from a contract snapshot for `migration plan`, introspected for `db update` and `db init`, and one differ runs over two schema IRs ([ADR 235](../../docs/architecture%20docs/adrs/ADR%20235%20-%20The%20schema%20differ%20walks%20two%20derived%20schema%20IRs.md)). `migration plan` also hands the SQL planner the origin contract as `fromContract` (`packages/1-framework/3-tooling/cli/src/control-api/operations/plan-resolution.ts`); the `db update` path passes `fromContract: null` (`packages/1-framework/3-tooling/migration/src/aggregate/strategies/plan-from-diff.ts`). Statements become the third input, and `db update` learns to supply the origin contract.
- **Where the origin contract comes from for `db update`.** The database marker stores the contract hash the database was last updated to ([ADR 021](../../docs/architecture%20docs/adrs/ADR%20021%20-%20Contract%20Marker%20Storage.md)), and `db update` advances the `db` ref to the same hash ([ADR 218](../../docs/architecture%20docs/adrs/ADR%20218%20-%20Refs%20with%20paired%20contract%20snapshots%20and%20universal%20graph-node%20invariant.md)). The content-addressed snapshot store ([ADR 240](../../docs/architecture%20docs/adrs/ADR%20240%20-%20Contract%20snapshots%20live%20in%20a%20content-addressed%20store.md)) holds the contract for that hash when the project has it.
- **Consent today.** `db update` pre-plans and refuses with `MIGRATION.DESTRUCTIVE_CHANGES` until the user types the database name or passes the engine's `--confirm <database>` token (`packages/1-framework/3-tooling/cli/src/orm/db/consent.ts`, `control-api/operations/db-update.ts`). `migration plan` applies the same refusal to auto-baselines only, with the project directory as the token (`control-api/operations/migration-plan.ts`). The CLI README's `db update` section still describes a `--yes` flag that no longer exists.
- **The placeholder flow.** `migration plan` already scaffolds data transforms with `placeholder()` slots on Postgres for a required column on an existing table, a nullable-to-required change and an unsafe type change (SQLite only for nullable-to-required), writes `ops.json` as `[]` with `pendingPlaceholders`, and the user fills the slots and re-runs `migration.ts` to re-emit ([ADR 200](../../docs/architecture%20docs/adrs/ADR%20200%20-%20Placeholder%20utility%20for%20scaffolded%20migration%20slots.md), [ADR 196](../../docs/architecture%20docs/adrs/ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md), `packages/3-targets/3-targets/postgres/src/core/migrations/planner-strategies.ts`). Under `db update`, whose policy excludes the `data` class, those strategies stand down and direct DDL is emitted. The Postgres `alterColumnType` operation already has a `using` option the planner never fills.
- **Rename substrate.** `renameTable` exists on Postgres and SQLite from prisma/orm#30331. The shelved prisma/orm#30570 refactored it onto a working schema shared by the planner and the hand-written facade, with companion constraint names taken from the destination contract and foreign keys paired by their own and referenced columns, and reclassified non-data drops as widening. That code is the starting point; the contract `hints` section it also added is not.
- **Operation classes.** Additive, widening, destructive and data (`packages/2-sql/9-family/src/core/migrations/types.ts`). Every Postgres type change is destructive today except a short list of safe widenings; Mongo classifies by validator comparison (`packages/3-mongo-target/1-mongo-target/src/core/migrations/mongo-planner.ts`).
- **Coordinates.** A contract entity is addressed by plane, namespace, kind and name ([ADR 221](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md), [ADR 224](../../docs/architecture%20docs/adrs/ADR%20224%20-%20Namespace%20concretions%20address%20entities%20by%20coordinate.md)); the contract source declares namespaces as `namespace <name> { ... }` blocks; the query surface resolves a bare name through the sole namespace ([ADR 223](../../docs/architecture%20docs/adrs/ADR%20223%20-%20Target-owned%20default%20namespace.md)). Variants and discriminators are [ADR 173](../../docs/architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md); value objects are [ADR 178](../../docs/architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md), stored as one JSONB column on SQL and a subdocument on Mongo.
- **Family vocabulary.** `packages/1-framework` may not name a family or target (`no-family-vocabulary-in-framework`, enforced by the `lint:framework-vocabulary` ratchet). The statement parser and resolver live there and speak only contract vocabulary.
- **Documentation already promising something like this.** The Data Contract and Migration System subsystem docs and ADR 001 describe `@hint(was: "old_name")` in the contract source as the planner's source of intent. This project replaces that promise.

## Cross-cutting requirements

1. **Statements are the only source of intent.** The planner never infers a rename, never asks whether a drop is one, and never reads intent from the contract. A change with no statement is planned as the diff shows it, and refused if that loses data.
2. **Contract vocabulary only.** A statement names namespaces, models, fields and values as the contract source names them. The framework resolves every coordinate against the origin and destination contracts before any family code runs; the family receives resolved entities, never names to look up.
3. **One statement surface, both commands.** `migration plan` and `db update` accept the same statements with the same meaning, and the plan a statement produces is the same whichever command ran it. `db update` obtains its origin contract from the marker hash through the snapshot store.
4. **Refusal names the way out.** When either command refuses, the error lists every destructive operation with the rename and delete statements that would resolve it, spelled exactly as the user would type them. In a terminal the same list is the consent question, asked per operation.
5. **An unusable statement is an error.** A coordinate that does not resolve in the contract it must resolve in, a rename whose new name already exists in the origin, a statement the control policy forbids, or a rename and convert statement with no origin contract: each fails before anything is planned, naming what was searched and what was found. Running the same statements twice fails the second time.
6. **Statements compose in order.** Each statement is applied to the working copy of the origin before the next is resolved, so `--rename Profile:User --rename User.name:User.fullName` is valid and the second statement uses the new table name. A swap is refused with a message.
7. **Same output as the hand-written route.** A plan produced from statements writes a `migration.ts` whose calls a user could have written by hand, and re-running that file reproduces `ops.json`. Statements are never recorded anywhere; the migration file is the record.
8. **Companion objects follow a rename, never a rebuild.** Every constraint and index whose name derives from a renamed table or column is renamed on both SQL targets to the name the destination contract gives it, explicit or derived.
9. **Scaffolds reuse the placeholder flow.** `--convert` and `--backfill` produce the existing placeholder-bearing migration, with the placeholder in the operation that consumes the value. The pending state, the empty `ops.json` and the re-emit path are unchanged.
10. **Destructive means data loss.** Drops of indexes, unique and foreign-key constraints, checks, row-level-security policies, defaults and native enum types, and disabling row-level security, are widening on every target. A type change the family knows to be widening needs no statement.
11. **Framework stays family-agnostic.** The statement grammar, parser and resolver carry no family or target vocabulary, and each family documents what every verb means for its storage.
12. **Built for the interactive prompt to drop in.** The refusal is a structured list of destructive operations, each with its entity in domain coordinates and the statements that would resolve it; the error text is rendered from that list. Statement strings are parsed, resolved and applied through one entry point that does not know whether they came from the command line or from an answer typed at a prompt, so statements can be added after the command has started. See [`plan.md`](./plan.md) § Delivered: the interactive prompt.

## Transitional-shape constraints

- The refusal in `migration plan` lands only after `--rename` exists for models and fields, so the first refusal a user meets has a rename-shaped way out for the common case. It ships with an upgrade fragment, since plans with drops change behaviour.
- `--delete` and the removal of `--confirm` land in the same slice, on both commands, with their upgrade fragment. No release has both.
- Each slice that adds a verb or a noun adds it for Postgres and SQLite in the same PR. Mongo follows in its own slice using the same framework surface, and the framework surface is designed for it from the first slice.
- The reclassification of non-data drops as widening lands with the first slice, salvaged from prisma/orm#30570, since a SQLite rename rebuilds indexes and would otherwise require consent.

## Contract-impact

None. `contract.json`, `contract.d.ts`, snapshots and migration manifests are unchanged. The `hints` section the shelved attempt added is not carried over.

## Adapter-impact

- **Postgres and SQLite:** planners take statements as an input; a column rename operation with prechecks and postchecks on each target; companion renames for column-derived names; the `using` placeholder on the Postgres type change; the SQLite type change scaffold; deletes under the existing drop operations; widening reclassification.
- **MongoDB:** a collection rename operation; field renames and value renames as data transforms; convert as a data transform scaffold; deletes under the existing drop and unset operations.

## ADR pointer

One ADR at close-out: destructive changes need stated intent, covering the refusal default and what counts as destructive, the statement vocabulary and its grammar, resolution against the two contracts, the per-operation consent model, the scaffold rule, and the origin-contract requirement. ADR 001, ADR 028 and the two subsystem docs that describe `@hint(was:)` are amended to describe statements instead.

## Project DoD

In addition to the team DoD floor in [`drive/calibration/dod.md`](../../drive/calibration/dod.md):

- A journey on Postgres and on SQLite renames a model and a field and deletes another model in one `migration plan` with three statements, runs `migrate` on tables with rows, a unique constraint, a foreign key, a secondary index and a check, and afterwards the rows and objects are present under the new names, the deleted table is gone, a further plan is empty, and `db verify --schema-only` is clean.
- The same change through `db update` with the same statements on both targets produces the same database state and no consent prompt. Running the same `db update` again with the same statements fails on the first statement.
- The same change with `--delete` omitted makes both commands refuse, and the refusal text contains the exact statement that then succeeds.
- A type change through `migration plan --convert` writes a migration whose only placeholder is in the Postgres `using` slot; filling it and re-running the file produces an applicable migration that converts the rows. The same change without a statement is refused by both commands, and `--delete` on the field plans the direct alter.
- A new required field on an existing table through `migration plan --backfill` writes the scaffolded backfill transform; without the statement both commands plan the temporary-default recipe.
- On Mongo, the rename journey above with a collection and a document field, through both commands, and a value object field rename that rewrites subdocuments.
- A `db update` against a database whose marker hash has no local snapshot fails every rename and convert statement with one error naming the hash, and succeeds with `--delete` alone.
- `--confirm` is gone from both commands, the CLI README describes the statements and the consent model, and the upgrade fragments for the refusal and the consent change are validated by execution.
- The project's ADR and doc amendments are merged.

## Open questions

Settled in the first slice's spec, not here: the exact grammar of a coordinate when a namespace and a model share a name, the separator spelling, and whether `--delete` on a type-changed field keeps that word or gets its own.

## References

- [`design-notes.md`](./design-notes.md) — the discussion record, the verb and noun matrix, the scenarios, the prior art.
- [prisma/orm#30570](https://github.com/prisma/orm/pull/30570) — the shelved slice whose planner substrate this project reuses.
- [prisma/orm#30331](https://github.com/prisma/orm/pull/30331) — the rename-table operation.
- [ADR 200](../../docs/architecture%20docs/adrs/ADR%20200%20-%20Placeholder%20utility%20for%20scaffolded%20migration%20slots.md) — the placeholder flow convert and backfill reuse.
- [ADR 224](../../docs/architecture%20docs/adrs/ADR%20224%20-%20Namespace%20concretions%20address%20entities%20by%20coordinate.md) — entity coordinates.
