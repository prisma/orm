# Slice 3a — `--convert` and `--backfill`

**Linear:** [TML-3477](https://linear.app/prisma-company/issue/TML-3477), [TML-3517](https://linear.app/prisma-company/issue/TML-3517) · **Branch:** `tml-3477-convert-backfill` · **Builds on:** slice 2 (merged) · **Project:** [`../../spec.md`](../../spec.md)

## In one example

`User.age` changes from `String` to `Int` on Postgres.

```text
$ prisma migration plan --name age-to-int
✖ [CLI.CONSENT_REQUIRED] 1 subject needs a statement, and the session is not interactive.
  why: Change type of column "User"."age" would lose the data of field "User.age".
→ Pass --convert User.age
→ Pass --delete User.age

$ prisma migration plan --name age-to-int --convert User.age
⚠ migration.ts has a placeholder: replace it with the conversion, then run the file to re-emit.
```

`migration.ts` then has one slot to fill:

```ts
this.alterColumnType({
  table: 'User',
  column: 'age',
  type: 'int4',
  using: placeholder('User.age:using'),
}),
```

The user writes `using: '"age"::integer'`, runs the file, and applies it.

## What changes for users

| Change in the schema | Today | After this slice |
| --- | --- | --- |
| Type change that loses data | Placeholder migration, written without asking | Refused. Answer `--convert` (fill in the conversion) or `--delete` (accept the loss) |
| Type change that keeps every value (`int4` → `int8`) | Planned, nothing asked | Same |
| Required field added to an existing table | Placeholder migration, written without asking | Filled with a temporary value (`''`, `0`, …), nothing asked. `--backfill` writes a slot to fill instead |
| Optional field made required | Placeholder migration, written without asking | `SET NOT NULL`, nothing asked. Fails if NULLs exist, and says how many. `--backfill` writes a slot to fill instead |
| Any of the above through `db update` | No placeholders | Same. `--convert` and `--backfill` are refused: `db update` has no file to fill |

SQLite works the same way. Two SQLite gaps close on the way:
- `db update` can add a required field to a table with rows. Today it fails.
- A type change gets a slot for the conversion. Today SQLite just rebuilds the table.

## Decisions to check

1. **Temporary values without asking.** Without `--backfill`, `migration plan` writes fill values such as `''` or `0` into existing rows. The project spec already decided this. It is the biggest behaviour change in the slice.
2. **`alterColumnType` changes shape.** Its options become `{ table, column, type, using? }`. Today they expose internal names. Hand-written migrations that call it need the upgrade instructions.
3. **A type change answered with `delete` is reported honestly.** The output says `delete values of field "User.age" (type change)`, not "delete field". Slice 2's QA found the old wording misleading.

## The two flags

**`--convert <Model.field>`**
- Answers a type change that would lose data.
- `migration plan` only.
- Names the field by its new name. After `--rename User.age:User.years`, write `--convert User.years`.
- Needs the old contract, like `--rename`.

**`--backfill <Model.field>`**
- Optional. Answers no question.
- `migration plan` only.
- The field must be required now, and either new on an existing table or optional before.

**On `db update`,** both flags fail with `MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE`, which points to `migration plan`.

## What the planners write

| Case | Postgres | SQLite |
| --- | --- | --- |
| `--convert` | `alterColumnType` with `using: placeholder(…)` | Table rebuild whose copy step has `placeholder(…)` for the column |
| `--backfill`, new field | Add nullable column, data transform with placeholders, `SET NOT NULL` | Add nullable column, data transform, tightening rebuild |
| `--backfill`, optional made required | Data transform with placeholders, `SET NOT NULL` | Data transform, tightening rebuild |
| New required field, no flag | Add with temporary default, drop the default | Rebuild that copies the temporary value into the new column |

## How the pieces fit

- **Questions know why data is lost.** Each data-loss entry says `drop` or `typeChange`. A `typeChange` question offers `convert` and `delete`; a `drop` question offers `rename` and `delete`.
- **A converted change stops being data loss.** It is classed `data`, because the user writes the conversion. So it is not asked about again.
- **A typed `convert` at the prompt re-plans,** the same way a typed rename does.
- **Placeholders appear only when a flag asks.** The four strategies that write them today run only for a field a flag names.
- **The temporary default becomes a real call in `migration.ts`.** Today it renders as an empty `rawSql(...)`, so re-running the file does not reproduce `ops.json`.
- **The NOT NULL failure names the NULLs (TML-3517).** It says how many rows hold NULL in which column, and suggests filling them, keeping the field optional, or `--backfill`. It no longer talks about schema drift.

## Why one pull request

Everything here serves one rule: a placeholder migration is written only when a flag asks for it. The reviewer reads that rule and its consequences.

## Scope

**In**
- Both flags on Postgres and SQLite; refused on `db update`.
- Ending automatic placeholders.
- The temporary default on both targets, as a real call.
- The `alterColumnType` reshape, with upgrade instructions.
- TML-3517.
- Docs:
  - ADR 200: it says only a data transform can hold a placeholder.
  - The Migration System doc: it says the Postgres planner never writes placeholders.
  - Migration System § Statements, the error reference, the CLI README, `skills/prisma-8/references/migrations.md`.
- An app upgrade fragment for the behaviour changes.
- The project spec: "an existing table", not "a non-empty table". `migration plan` cannot see rows.

**Out**
- `--convert` on a variant: slice 3b.
- MongoDB: slice 4b.
- A temporary value for a new unique, primary-key or foreign-key column. It stays refused, as on Postgres today.

## Edge cases already known

| Case | Handling |
| --- | --- |
| A temporary value in a unique column fails on the second row | Refused for new unique, primary-key and foreign-key columns |
| `--convert` after a rename in the same run | Uses the new name, which the planner already uses |
| A placeholder operation has no position until the file is re-run | The convert's reported positions are empty until then, as for every placeholder today |

## Done when

- The project's convert and backfill checks pass on Postgres and SQLite.
- Re-running every `migration.ts` that this slice's tests write reproduces its `ops.json`.

## Implementation notes

- `dataLoss` entries gain `loss: 'drop' | 'typeChange'`, set by each target's operation-subjects function. `dataLossQuestion` stops inferring it from whether the destination has the field.
- `ResolvedMigrationStatement` gains `kind: 'rename' | 'convert' | 'backfill'`. Every reader that assumes a rename switches on `kind` first, including the SQL `StatementPlanner`, which today plans any non-model statement as a column rename.
- `askPlanQuestions` re-plans with every planned statement, not only renames.
- Convert and backfill reach the strategies as destination coordinates through the strategy context. They do not go through `planStatements`, because they rename nothing.
- Strategies gated: Postgres `notNullBackfillCallStrategy`, `typeChangeCallStrategy`, `nullableTighteningCallStrategy`; SQLite `nullabilityTighteningBackfillStrategy`.
- `alterColumnType`'s after-check compares the column's `format_type` text, which `migration.ts` no longer carries. The facade derives it from `type` through the control stack's data types (any of a data type's texts, rendered as its `format_type` text; a type that names its own kind, such as an enum, from its quoted name), and the planner derives it the same way, so `ops.json` is unchanged by a re-run. A `type` the stack cannot read fails with a structured error. A test runs every Postgres data type through both and checks they agree. Decided 2026-10-09 by the orchestrator: comparing only the type OID would let a length-only change look already applied, so the runner would skip it.
- `AlterColumnTypeClass` gains `data`. The `using` slot renders as code, imports `placeholder`, and an unfilled slot makes `toOp()` return the unfilled-placeholder result.
- `recreateTable` gains a per-column copy expression, used by convert and by the SQLite temporary value. SQLite gets a fill-value map: integer `0`, real `0`, text `''`, blob `X''`, and what its boolean and date-time codecs store.
- `MigrationRunnerFailure` gains `fix`. The `db update`, `db init` and `migrate` error mappers prefer it.
- Grounding report (local, gitignored): `wip/grounding-3a.md`.
