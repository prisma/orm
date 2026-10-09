# Slice spec — `--convert` and `--backfill` write the placeholder migration only when asked

**Project:** [`projects/migration-statements/`](../../spec.md) · **Slice 3a** · **Linear:** [TML-3477](https://linear.app/prisma-company/issue/TML-3477), [TML-3517](https://linear.app/prisma-company/issue/TML-3517) · **Branch:** `tml-3477-convert-backfill` · **Builds on:** slice 2 (merged).

## At a glance

A user changes `User.age` from `String` to `Int` on Postgres:

```text
$ prisma migration plan --name age-to-int
✖ [CLI.CONSENT_REQUIRED] 1 subject needs a statement, and the session is not interactive.
  why: Change type of column "User"."age" would lose the data of field "User.age".
→ Pass --convert User.age
→ Pass --delete User.age

$ prisma migration plan --name age-to-int --convert User.age
⚠ migration.ts has a placeholder: replace it with the conversion, then run the file to re-emit.
```

`migration.ts` then holds one placeholder, where the conversion goes:

```ts
this.alterColumnType({
  table: 'User',
  column: 'age',
  type: 'int4',
  using: placeholder('User.age:using'),
}),
```

The user writes `using: '"age"::integer'` (or any SQL expression), runs the file, and gets an applicable migration. On SQLite the placeholder sits in the table rebuild's copy step for that column.

Adding a required `email` field to an existing `User` table plans a temporary default by default: the column is added with a fill value and the default is dropped, and nothing is asked. To write the fill yourself, run `prisma migration plan --backfill User.email`. That writes the nullable column, a data transform with a placeholder, and `SET NOT NULL`.

Today `migration plan` writes these placeholders on its own for every type change and every required field on an existing table. Users who didn't want them get a migration they can't apply until they edit it. After this slice it writes them only when asked.

## Chosen design

### The two verbs

- **`--convert <Model.field>`** answers a type change that would lose data. It is accepted by `migration plan` only. It names the field by its destination name, like the new side of a rename: after `--rename User.age:User.years`, write `--convert User.years`. It needs the origin contract, like `rename`, and fails with `MIGRATION.STATEMENT_ORIGIN_UNKNOWN` without one. It must name a field that exists on both sides and whose type changes.
- **`--backfill <Model.field>`** is an opt-in that answers no question. It is accepted by `migration plan` only. It names a field that is required in the destination and is either new on an existing table or optional in the origin. Anything else is an error that names what was found.
- `db update` declares both verbs only to refuse them, with `MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE`. The error says `db update` has no migration file to fill and names `migration plan`. It doesn't fall through to the engine's generic "no flag registered" error, which doesn't explain the rule. The shared verb table in `orm/statement-verbs.ts` declares the verbs per command, so neither command accepts a verb by accident.

### What the planners write

| Diff | No statement | `--convert` | `--backfill` |
| --- | --- | --- | --- |
| Type change the target knows is safe (`int4`→`int8`) | direct alter, `widening`, nothing asked | error: nothing to convert | — |
| Any other type change | refused: question offers `convert` and `delete`. `--delete` plans the direct alter, `destructive` | Postgres: `alterColumnType` with `using: placeholder(…)`. SQLite: `recreateTable` whose copy step takes `placeholder(…)` for the column. Class `data` | — |
| Required field added to an existing table | temporary-default recipe on both targets, both commands, `additive` | — | nullable add, `dataTransform` with placeholders, then `SET NOT NULL` (SQLite: a tightening rebuild) |
| Optional field made required | direct `SET NOT NULL` (SQLite: tightening rebuild), `widening`. Fails at apply if NULLs exist, with advice that names `--backfill` | — | `dataTransform` with placeholders, then `SET NOT NULL` |

The four automatic placeholder strategies (Postgres `notNullBackfillCallStrategy`, `typeChangeCallStrategy`, `nullableTighteningCallStrategy`; SQLite `nullabilityTighteningBackfillStrategy`) fire only for a field a statement names. Statements reach them as destination coordinates through the strategy context. They change no names in the working schema, so they don't go through the rename path in `planStatements`. A converted type change carries no separate NULL-handling transform; the conversion expression can map NULL itself.

A `delete` answer to a type-change question keeps planning the direct alter, and the statement is reported as giving up the field's values in a type change (`delete values of field "User.age" (type change)`), not as deleting the field; slice 2's manual QA found the old wording misleading (F14). A converted alter is classed `data`, because the user writes its data step. So it isn't a `destructive` operation and leaves `dataLoss`. A typed `convert` at the prompt re-plans like a typed rename, and the type-change question isn't asked again.

### The questions know why data is lost

Each `dataLoss` entry gains `loss: 'drop' | 'typeChange'`, set by each target's operation-subjects function. The CLI stops guessing from whether the destination still has the field. A `typeChange` question offers `convert` and `delete` in `migration plan`, and `delete` only in `db update`. A `drop` question offers `rename` and `delete`, as today. The re-plan loop (`askPlanQuestions`) carries every planned statement, not only renames.

`ResolvedMigrationStatement` gains a `kind`, which is `rename`, `convert` or `backfill`. Every reader that assumes a rename now switches on `kind` first. One example is the SQL family's `StatementPlanner`, which today plans any non-model statement as a column rename. MongoDB keeps refusing statements it can't carry out, until slices 4a and 4b.

### The temporary default becomes a real migration call

The Postgres temporary-default and direct-add calls render as `rawSql({ id, label, operationClass })` with no SQL. Re-running such a `migration.ts` doesn't reproduce `ops.json` (cross-cutting requirement 7). They now render as a facade call that builds the same operation. SQLite gets the recipe as a rebuild in which the new column's copy value is a literal. This needs a new per-column copy-expression option on `recreateTable`, which `--convert` also uses, and a SQLite fill-value map (integer `0`, real `0`, text `''`, blob `X''`, and the values its boolean and date-time codecs store). It is refused on the same primary-key, unique and foreign-key conditions as Postgres. This closes the deferred item "SQLite `db update` cannot add a required field to a table that has rows".

### `alterColumnType` takes plain options

The Postgres facade's `alterColumnType` options are reshaped so the rendered call shows a readable shape with an optional `using`, and no internal names (`qualifiedTargetType`, `formatTypeExpected`, `rawTargetTypeForLabel`). The `using` slot renders as code, so it can hold `placeholder(…)`, and an unfilled slot makes `toOp()` return the unfilled-placeholder result the CLI already handles. Upgrade instructions are recorded for hand-written migrations.

### The NOT NULL failure names the NULLs (TML-3517)

When `SET NOT NULL` or a SQLite tightening rebuild meets NULL values, the runner reports how many rows hold NULL in which column. It says to fill them, make the field optional, or plan with `--backfill`. `MigrationRunnerFailure` gains a `fix`, and the `db update`, `db init` and `migrate` error mappers use it instead of the fixed advice about schema drift.

## Coherence rationale

Everything in this slice serves one change: the placeholder migration is written only when a statement asks for it. The verbs, the loss kind, the statement `kind`, the temporary default becoming real on both targets, the `alterColumnType` reshape and the NULL advice are each what that change needs to work on Postgres and SQLite. The reviewer reads one rule and its consequences.

## Scope

**In:**
- `--convert` and `--backfill` on `migration plan`, for Postgres and SQLite, refused on `db update`.
- The loss kind on `dataLoss` entries, and the statement `kind`.
- Ending automatic scaffolding.
- The temporary default as a real call on both targets, including the SQLite recipe.
- The `alterColumnType` reshape.
- TML-3517.
- The project spec's wording: "an existing table", not "a non-empty table", since `migration plan` can't see rows.
- An amendment to ADR 200, which says only a data transform holds a placeholder.
- The Migration System doc's claim that the Postgres planner writes no placeholder data transforms, which the code contradicts.
- Docs: Migration System § Statements, error reference, CLI README, `skills/prisma-8/references/migrations.md`.
- An app upgrade fragment: type changes ask, scaffolds are opt-in, and the temporary default applies under `migration plan`.
- Upgrade instructions for the facade change.

**Deliberately out:**
- `--convert` on a variant (slice 3b).
- MongoDB (slice 4b).
- A temporary default for a field in a new unique or foreign key, which stays refused as today.
- Detecting rows offline.

## Pre-investigated edge cases

| Case | Handling |
| --- | --- |
| A temporary value in a unique column fails on the second row | The recipe is refused for new unique, primary-key and foreign-key columns, as on Postgres today |
| A convert after a rename in the same run | The convert uses the destination name, which the diff issues already use |
| A placeholder operation has no position until re-emit | Applied-statement positions for a convert are empty until the file is re-run, as for every placeholder today |

## Slice-specific done conditions

- The project DoD's convert and backfill lines pass on Postgres and SQLite, reading "an existing table".
- Re-running every `migration.ts` the planners write in this slice's tests reproduces its `ops.json`.

## Open questions

None.

## References

- Grounding report (local, gitignored): `wip/grounding-3a.md`.
- [`../../design-notes.md`](../../design-notes.md): the scaffold rule and the convert and backfill rows.
- [ADR 200](../../../../docs/architecture%20docs/adrs/ADR%20200%20-%20Placeholder%20utility%20for%20scaffolded%20migration%20slots.md): the placeholder flow.
