# Project spec — Destructive changes need stated intent

**Linear:** [Destructive changes need stated intent](https://linear.app/prisma-company/project/destructive-changes-need-stated-intent-7626c0107cd9) ([TML-3421](https://linear.app/prisma-company/issue/TML-3421)) · **Branch:** `tml-3421-rename-hints`

## Purpose

The migration planner diffs two states and cannot tell intent from the diff. A renamed model looks exactly like a dropped table plus a created one, and a removed model looks the same as one the user forgot. Today the planner plans the destruction and relies on a consent prompt, or on a hand-written migration, to keep rows safe. Projects that use `db update` and keep no migration history cannot hand-write anything.

This project makes the ideal explicit: the planner refuses destructive operations by default, and the contract source carries the one thing the diff cannot infer, the user's intent. A hint turns a destructive-looking diff into a non-destructive plan where one exists, and states consent where destruction is the intent.

## At a glance

A user renames the `Profile` model to `User`, renames its `first_name` column, and removes the `Legacy` model for good:

```prisma
model User {
  id        Int    @id
  firstName String @hint(was: "first_name")

  @@hint(was: "Profile")
}

model Legacy {
  @@hint(deleted: true)
}
```

`prisma migration plan` writes a migration that renames the table, renames the column, renames every constraint and index whose name derives from either, and drops `Legacy`. `prisma db update` does the same against a live database. Once an environment has been updated, every hint matches nothing and does nothing, and the user deletes the hints and the `Legacy` block whenever they like. Without the `deleted` hint, both commands refuse to drop `Legacy`.

## Decisions settled in discussion (2026-10-01)

The reasoning and the alternatives rejected are in [`design-notes.md`](./design-notes.md). The implementation specification, with numbered rules every slice cites, is [`design.md`](./design.md).

1. **The planner refuses destructive operations by default.** `db update` already does this through its consent prompt. `migration plan` gains the same refusal so an ordinary plan never writes a drop the user has not stated. The command-level consent stays as the fallback for a change no hint can express.
2. **Hints are the stated intent, in the contract source.** One attribute, `@@hint(...)` on models and `@hint(...)` on fields, with named arguments. The vocabulary is `was` for a rename, `deleted` for a confirmed removal, and `deprecated` for an object the application no longer requires but the database may keep. Value hints that supply an expression, such as a cast for a type change or a backfill for a new required column, are future arguments of the same attribute and not this project.
3. **Low-hanging fruit first.** `was` on models, then `was` on fields, then the `migration plan` refusal, then `deleted`. `deprecated` is designed now and built in a follow-on, because it also needs `db verify` to tolerate a declared absence. Namespace moves, enum value renames and explicitly named index renames leave for a follow-on project.
4. **A hint names the old storage name**, the value `@@map` or `@map` would have carried. A hint resolves against the origin schema alone. The planner never opens an older contract, a migration directory or the source file to interpret the destination contract.
5. **A spent hint is silently ignored.** When the origin lacks the old name, the hint does nothing. An origin that has both the old and the new name of a `was` hint refuses the plan. `migration plan` reports the hints it consumed. Users may leave hints in place indefinitely, which `db update` projects need, since every environment plans live.
6. **A `deleted` model or field is a tombstone.** It contributes nothing to the contract's domain, storage or generated types. It contributes one entry to the hints section, keyed by its storage name. The storage hash of a schema with the tombstone equals the hash with the block deleted.
7. **Hints travel in the emitted `contract.json`** outside every hashed section, and are stripped from the snapshot store and from migration directories.
8. **Surfaces and targets.** PSL and TypeScript authoring. Postgres and SQLite. MongoDB is a follow-on project reusing the contract vocabulary. The Prisma 6 and Prisma 7 schema sources do not accept the attribute.

## Non-goals

- No inference of renames or drops from matching columns or any other heuristic.
- No value hints and no data moves between models in this project.
- No `deprecated` implementation in this project. The vocabulary is reserved and the design is recorded.
- No MongoDB operations.
- No hint acceptance in the Prisma 6 or Prisma 7 schema sources.
- No change to `db verify` in this project. It reports the drift that exists until an environment is updated. The `deprecated` follow-on is where verify changes.
- No reversal of the documented stance that `db update` is dev-only. The mechanism makes it safer; the stance is a separate decision.
- No record of hints in the migration manifest. ADR 199 removed that field; the migration's `ops.json` and `migration.ts` record the operations a hint produced.

## Place in the larger world

- **The recovered design.** `docs/architecture docs/Contract-Driven DB Update.md`, deleted on 2026-02-25 in commit `39cecd86ce`, describes `db update` as a production-grade, contract-driven path with an active, deprecated, deleted lifecycle in the authoring layer and planner hints such as `@hint(was:)`. This project builds its mechanism. The verification of that document against today's code is in `design-notes.md`.
- **Planner inputs.** Every planner takes a destination contract and an origin schema: a derived schema from a contract snapshot for `migration plan`, an introspected database for `db update` and `db init`. The SQL planners are `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts` and its SQLite sibling; both run one differ over two schema IRs ([ADR 235](../../docs/architecture%20docs/adrs/ADR%20235%20-%20The%20schema%20differ%20walks%20two%20derived%20schema%20IRs.md)). Hints become the third input.
- **Destructive consent today.** `db update` pre-plans, and if any operation is destructive it stops with `MIGRATION.DESTRUCTIVE_CHANGES` until the user types the database name or passes `--confirm` (`packages/1-framework/3-tooling/cli/src/control-api/operations/db-update.ts`). `migration plan` applies the same refusal only to auto-baselines (`migration-plan.ts`). Operation classes are additive, widening, destructive and data.
- **Rename substrate.** prisma/orm#30331 adds `renameTable` on Postgres and SQLite and the family-level `applyTableRename` in `packages/2-sql/9-family/src/core/migrations/apply-table-rename.ts`. It takes a start contract, an end contract and a `{from, to}` pair, rewrites the start contract with the table under its new name, and resolves the companion renames. A model hint is a second source of that pair.
- **Attributes.** PSL attributes are declared through specs ([ADR 231](../../docs/architecture%20docs/adrs/ADR%20231%20-%20Declarative%20attribute%20specifications.md)); the SQL family's built-ins live in `packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts` next to `map`. The central registry ([ADR 249](../../docs/architecture%20docs/adrs/ADR%20249%20-%20Central%20attribute-spec%20registry.md)) feeds the language server.
- **Contract hashing.** The storage hash covers target, family and `storage` only (`packages/1-framework/0-foundation/contract/src/hashing.ts`).
- **Snapshots.** `migration plan` writes the destination contract into the content-addressed store and copies it into the migration directory ([ADR 232](../../docs/architecture%20docs/adrs/ADR%20232%20-%20A%20migration%20is%20authored%20against%20its%20start%20and%20end%20contract%20snapshots.md), [ADR 240](../../docs/architecture%20docs/adrs/ADR%20240%20-%20Contract%20snapshots%20live%20in%20a%20content-addressed%20store.md)).
- **Naming.** Default constraint and index names derive from table and column names ([ADR 009](../../docs/architecture%20docs/adrs/ADR%20009%20-%20Deterministic%20Naming%20Scheme.md)), and a secondary index's physical name carries a hash of its content, which includes its column names ([ADR 243](../../docs/architecture%20docs/adrs/ADR%20243%20-%20Name-identified%20indexes%20and%20exact-name%20adoption.md)). A column rename changes the names of the objects built on the column.
- **Control policy.** ADR 224 fixes four policies. Under the default `managed`, an undeclared object in the database fails verify and plans as a drop. The `deprecated` follow-on narrows that for objects a tombstone names.
- **The verbatim guard.** `MIGRATION.TABLE_NAME_CASE_CHANGED` refuses the drop-and-create pair the verbatim table name change produces and lists the ways out ([psl-verbatim-table-names](../psl-verbatim-table-names/spec.md)).
- **Documentation already promising this.** The Data Contract and Migration System subsystem docs and ADR 001 describe `@hint(was: "old_name")` as the planner's source of intent. Their sentence saying hints are recorded in migration edges is stale since ADR 199.

## Cross-cutting requirements

1. **A hint is never a guess.** The planner acts on a `was` hint only when the origin has the old name and lacks the new one, and on a `deleted` hint only when the origin has the name. Both names present for `was` refuses with a structured error. A hint that matches nothing is a no-op with no diagnostic from `db update` or `db init`.
2. **Self-contained contract.** Resolving a hint reads the destination contract and the origin schema, nothing else.
3. **The contract shape is family-neutral.** Hints live in a dedicated unhashed section of `contract.json`, keyed by the storage coordinate they name, validated like every other section, and stripped from snapshots and migration directories. The storage hash of a contract with and without hints is identical.
4. **Refusal names the way out.** When `migration plan` or `db update` refuses a destructive operation, the error names the object and the hint that would state the intent, alongside the command-level consent.
5. **Companion objects follow a rename, never a rebuild.** Every constraint, index and policy whose name derives from a renamed table or column is renamed on both targets, under the rules prisma/orm#30331 established: an object the destination contract also changes keeps the name the database has; an explicitly named object keeps its name.
6. **Hints compose.** A model hint and field hints on the same model in one change resolve in order: the model rename first, then each field rename under the new table name.
7. **Same output as the hand-written route.** With a model hint, `migration plan` writes a `migration.ts` that calls `this.renameTable(...)` and an `ops.json` identical to the hand-written migration for the same change. The hand-written route stays, and the verbatim guard's remedy list names the hint first.
8. **Both authoring surfaces are equal.** The TypeScript DSL exposes the same hints on the model and field builders, lowering to the same contract section.
9. **One new column rename operation per target**, with prechecks and postchecks in the style of `renameTable`, exported through the target's migration facade.
10. **The vocabulary is reserved as a whole.** The attribute spec rejects unknown argument names, and `deprecated` is rejected with a message saying it is not yet supported rather than silently ignored.

## Transitional-shape constraints

- The project builds on prisma/orm#30331 and its first slice lands after that PR merges.
- The contract section, the attribute and the model rename land together. A contract section with no consumer, or an attribute with no effect, is not shipped on its own.
- Each slice that adds a hint kind or entity kind adds the planner behaviour for both targets in the same PR.
- The `migration plan` refusal lands only after `was` exists for models and fields, so the first refusal a user meets already has a hint-shaped way out for the common case. It ships with an upgrade fragment, since existing plans with drops change behaviour.

## Contract-impact

A new unhashed `hints` section on `contract.json`, holding one entry per named storage coordinate with `was` or `deleted`. Validation is additive: a contract without the section is unchanged. The exact key layout is settled in slice 1's spec and must leave room for `deprecated`.

## Adapter-impact

- **Postgres and SQLite:** planners consume model and field hints; new column rename operation; companion renames for column-derived names; drops from `deleted` hints under the existing drop operations.
- **MongoDB:** none in this project.

## ADR pointer

One ADR at close-out: destructive changes need stated intent, covering the refusal default, the attribute and its vocabulary including the reserved `deprecated`, the unhashed contract section, resolution against the origin schema, spent-hint semantics, tombstones, and the extension path for value hints. ADR 001, ADR 028 and the two subsystem docs are amended to drop the stale "recorded in migration edges" text.

## Project DoD

In addition to the team DoD floor in [`drive/calibration/dod.md`](../../drive/calibration/dod.md):

- A journey on Postgres and on SQLite renames a model and a field and deletes another model in one change with hints, runs `migration plan` then `migrate` on tables with rows, a unique constraint, a foreign key, a secondary index and a check, and afterwards the rows and objects are present under the new names, the deleted table is gone, a plan with no schema change is empty, and `db verify --schema-only` is clean.
- The same schema change through `db update` on both targets produces the same database state, with no consent prompt.
- Running `db update` a second time with the hints still present plans nothing.
- The same change with the `deleted` hint removed makes both `migration plan` and `db update` refuse, naming the model and the hint.
- A contract emitted with hints has the same storage hash as the same contract with the hints removed, and no migration directory or snapshot contains a `hints` section.
- The verbatim guard's error names the hint as its first remedy, and the upgrade fragments for the verbatim change and for the refusal default are validated by execution.
- The project's ADR and doc amendments are merged.

## Open questions

None outstanding at shaping. Settled in slice specs: the exact contract key layout; the wording of the refusal; how a tombstone block is parsed when it carries fields and relations.

## References

- `docs/architecture docs/Contract-Driven DB Update.md` at `39cecd86ce^` — the recovered design.
- [prisma/orm#30331](https://github.com/prisma/orm/pull/30331) — rename-table operation and `applyTableRename`.
- [`projects/psl-verbatim-table-names/`](../psl-verbatim-table-names/spec.md) — the project that made this one necessary.
- [ADR 224](../../docs/architecture%20docs/adrs/ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md) — control policy, the vocabulary `deprecated` must fit beside.
- [ADR 199](../../docs/architecture%20docs/adrs/ADR%20199%20-%20Storage-only%20migration%20identity.md) — removed `hints` from the migration manifest.
