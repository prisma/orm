# Slice 6: autoincrement on an existing column, and Prisma 7 constraint names

_Parent project: `projects/prisma7-contract-source/`. Linear: TML-3466 (autoincrement) and TML-3452 (constraint names). One PR. Outcome: after the handover proven in slice 5, giving an existing column `autoincrement()` migrates correctly, and every primary key and foreign key Prisma 8 creates, drops or renames has the name Prisma 7 gave it._

Both defects were known before slice 5 and were steered around by its test. This slice puts them back on the path: the handover test gains an edit that hits each one, and that edit fails before the fix.

## At a glance

```prisma
model Post {
  id        Int @id @default(autoincrement())
  serial    Int @default(autoincrement())   // was `serial Int` with existing rows
  ...
}
```

`migration plan` today writes nothing for `serial`. After this slice it writes one operation:

```sql
CREATE SEQUENCE IF NOT EXISTS "public"."Post_serial_seq" AS integer;
ALTER TABLE "public"."Post" ALTER COLUMN "serial" SET DEFAULT nextval('"public"."Post_serial_seq"'::regclass);
ALTER SEQUENCE "public"."Post_serial_seq" OWNED BY "public"."Post"."serial";
SELECT setval('"public"."Post_serial_seq"'::regclass, GREATEST(COALESCE(MAX("serial"), 0), 0) + 1, false) FROM "public"."Post";
```

And a fresh database replayed from `migrations/` has `_PostToTag_AB_pkey`, as Prisma 7 named it, not `_PostToTag_pkey`.

## Part A: `autoincrement()` on an existing column (TML-3466)

### Today

- `buildSetDefaultColumn` (`packages/3-targets/3-targets/postgres/src/core/migrations/column-ddl-rendering.ts` ~159-175) returns `undefined` for an autoincrement default because `postgresDefaultToDdlColumnDefault` (`op-factory-call.ts` ~142-163) returns `undefined` for it. That helper is shared with the create path, where `undefined` is correct (SERIAL carries the default), so the fix branches in `buildSetDefaultColumn`, not in the helper.
- `mapColumnDefaultNodeIssue` (`issue-planner.ts` ~707-733) then returns `ok([])`. Both `not-found` (no default before) and `not-equal` (a literal default before) are dropped.
- `setDefault` in `operations/columns.ts` (~256-272) refuses `autoincrement()` with `CONTRACT.DEFAULT_INVALID` reason `set-default-autoincrement`. The adapter's `pgRenderDdlColumnDefault` (`packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts` ~1769-1790) throws for it on non-SERIAL types.
- Tests that pin the no-op and the refusal: `postgres/test/migrations/column-ddl-rendering.test.ts` ~152-161; `6-adapters/postgres/test/migrations/op-factory-call.lowering.test.ts` ~331-342; `docs/reference/error-reference.md` ~392; `skills/prisma-8/references/migrations.md` ~362.
- Verify treats any `nextval(` default as `autoincrement()` (`default-normalizer.ts` ~437-439), so any attached sequence verifies.

### Chosen design

- **One operation**, the existing `setDefault.{table}.{column}` id, additive when the column had no default and widening when it replaces a default. Its steps, in order:
  1. `CREATE SEQUENCE IF NOT EXISTS <seq> AS smallint|integer|bigint`, matching the column's `int2|int4|int8` (as SERIAL does). `IF NOT EXISTS` because removing autoincrement leaves the owned sequence in place (removal is `DROP DEFAULT` only, unchanged), so adding it back must reuse it.
  2. `ALTER TABLE <table> ALTER COLUMN <col> SET DEFAULT nextval('<seq>'::regclass)`.
  3. `ALTER SEQUENCE <seq> OWNED BY <table>.<col>`.
  4. `SELECT setval('<seq>'::regclass, COALESCE(MAX(<col>), 0) + 1, false) FROM <table>`, so existing rows never collide. Prisma 7 omits this; it is a Prisma 7 bug, not parity to keep.
- **Checks.** Precheck: the column exists. Postcheck: `pg_get_serial_sequence('<table>', '<col>') IS NOT NULL` and the column default starts with `nextval(`. A plain "column has a default" postcheck already holds in the literal-to-autoincrement case and the runner would skip the operation.
- **Sequence name.** What Postgres names a SERIAL column's sequence: `{table}_{column}_seq`, quoted, case-preserving, in the table's schema, truncated the way Postgres `makeObjectName` truncates (trim the longer of table and column, by bytes, on character boundaries, until `table + "_" + column + "_seq"` fits 63 bytes). Add the helper beside `default-constraint-names.ts`; reuse the byte-aware truncation pattern in `packages/2-sql/1-core/schema-ir/src/naming.ts` if it fits. Test it against names Postgres itself produces for SERIAL columns on PGlite (ASCII over 63 bytes, multibyte, mixed case, non-public schema).
- **Surface.** Extend the existing `setDefault` path so the planned call and the authored `setDefault(..., fn('autoincrement()'))` in `migration.ts` produce the same steps. Remove the `set-default-autoincrement` refusal for integer columns; keep a refusal for non-integer columns, with an updated error-reference entry.
- **Layering.** Postgres target and adapter only. No contract, framework or family change.

### Tests (write them first; each must fail before the fix)

- Unit: `buildSetDefaultColumn` returns a column for int2/int4/int8 autoincrement and refuses other types; the lowering of `setDefault` with `autoincrement()` renders the four steps (snapshot); the sequence-name helper cases; the issue mapper produces `setDefault` for `not-found` (additive) and literal-to-autoincrement (widening).
- Integration on PGlite (model on `planner.authored-function-defaults.integration.test.ts`): for int2, int4 and int8, seed rows, plan and apply; `column_default` is `nextval(...)`; `pg_get_serial_sequence` resolves; an insert without a value gets max + 1; re-planning gives no operations; removing autoincrement plans `dropDefault`; adding it back reuses the sequence and succeeds.
- End to end: see Part C.

## Part B: Prisma 7 constraint names (TML-3452)

### Today

The contract IR already carries an optional `name` on primary keys and foreign keys, the planner already uses a stated name before deriving one (`issue-planner.ts` ~425, 457-462, 745, 754-759, 782), and `db verify` never compares names. The Prisma 7 source (`packages/2-sql/2-authoring/contract-prisma7/src/`) drops every name:

- `@id(map:)` (`interpreter.ts` ~952-958) and `@@id(map:)` (`interpreter.ts` ~459 emits `{ id: { columns } }`).
- `@relation(map:)` (`relations.ts` ~179-180, `case 'map': break;`; `RelationAttribute` has no `map`).
- Implicit many-to-many junction primary key (`relations.ts` ~890) and junction foreign keys (~834-845).

Prisma 8's derived names (`default-constraint-names.ts`) match Prisma 7's only for short, unmapped, non-junction constraints. Six of the 35 Prisma 7 fixtures diverge today: `explicit-relations`, `implicit-many-to-many`, `junction-name-in-other-schema`, `junction-table-name-in-other-schema`, `relation-name-in-two-schemas`, `long-names`.

### Prisma 7's rules (observed on 7.10.0)

All cuts are to 63 UTF-8 bytes, on a character boundary, keeping the suffix whole. This is what `prisma7ConstraintName(base, suffix, maxBytes)` (`indexes.ts` ~110-120) already does.

| Constraint | Name |
|---|---|
| Primary key, `@id` or `@@id` | `map` if given, else `prisma7ConstraintName(table, '_pkey')` |
| Foreign key, `@relation` | `map` if given, else `prisma7ConstraintName(table + '_' + columns.join('_'), '_fkey')` |
| Junction primary key | `prisma7ConstraintName('_' + name, '_AB_pkey')` |
| Junction foreign keys | `prisma7ConstraintName('_' + name, '_A_fkey')`, `'_B_fkey'` |

### Chosen design

- **The source states a name only where Prisma 7's name differs from what Prisma 8 would derive.** That is: every `map:` on `@id`, `@@id` and `@relation`; every junction primary key and foreign key; and every default name Prisma 7 truncated. Constraints whose names already agree stay unnamed, so `contract print` stays free of `map:` noise and the table-rename logic (`table-rename-constraint-renames.ts`), which renames only unnamed constraints, keeps working for them.
- **Prisma 8's derivation reaches the source through the target binding.** `contract-prisma7` is target-neutral; the Postgres binding (`packages/3-targets/3-targets/postgres/src/core/prisma7-binding.ts`) passes Prisma 8's default-name functions, so the comparison never duplicates them.
- **A primary key or foreign key whose name should change is renamed.** Today the planner never diffs names, so editing `map:`, or a change in a truncated or junction name, leaves the database with the old name while the contract states the new one. A rename pass beside the index rename pass emits `ALTER TABLE ... RENAME CONSTRAINT` whenever an otherwise unchanged primary key or foreign key has a different name in the start and end contracts, stated or derived. (Amended after dispatch 2: limiting this to names both contracts state would leave a database Prisma 8 built by replay at `_PostToTag_pkey` once the contract starts stating `_PostToTag_AB_pkey`.) On a database Prisma 7 built, the rename's postcheck already holds and the runner skips it. `db verify` stays name-blind; `isEqualTo` is unchanged.
- **Prisma 8's own unnamed primary keys get the name the planner will later drop.** `CREATE TABLE` with an unnamed primary key renders a bare `PRIMARY KEY (...)`, so Postgres picks `makeObjectName`'s truncated name, while a later drop targets `"{table}_pkey"` truncated differently. For tables over 58 bytes the drop fails. Render the derived name on create (`pk.name ?? defaultPrimaryKeyName(table)`), so create and drop agree for every project, not only Prisma 7 adopters. Check foreign keys and unique constraints for the same mismatch and fix it the same way if it exists.
- **Storage hash.** Contracts from schemas with a diverging name get a new storage hash. Ship an upgrade instruction under `upgrade-instructions/pending/` for `prisma7Schema` users: a database signed before this change must be re-signed, or, after the handover, gets a migration that only renames constraints if needed. The example's committed `generated/prisma8/` and `migrations/` artifacts are regenerated.

### Tests (write them first; each must fail before the fix)

- Fixtures: regenerate the six diverging fixtures' `expected-contract.json` (`UPDATE_PRISMA7_FIXTURES=1`). Add one fixture with `@id(map:)`, `@@id(map:)`, `@relation(map:)`, a table name over 58 bytes and a long foreign key, with its `migration.sql` from Prisma 7.10.0 (the fixtures README says how; drive the engine directly if the CLI prints nothing without `DATABASE_URL` — set a dummy `DATABASE_URL`).
- The regression guard verify cannot give: extend `test/integration/test/prisma7-source/interpreter-fixtures.integration.test.ts` so that, for every fixture, the primary key and foreign key names introspected from the database Prisma 7's `migration.sql` built equal the names the planner would use for the contract (stated or derived). Fails today on the six fixtures.
- Unit: `prisma7ConstraintName` cases for primary keys, foreign keys and junction constraints, including the 59-byte, 60-byte and multibyte cases Prisma 7 produced.
- Planner: a stated name change emits one `RENAME CONSTRAINT`; an unnamed long-table primary key created then dropped succeeds on PGlite.

## Part C: the handover test hits both

Add a third edit to `examples/prisma7-adoption/test/handover.test.ts` (fixture `test/handover/edit-3.prisma`), after edit 2:

- An existing integer column with rows gains `@default(autoincrement())`. Assert the plan's operation and SQL, `db migrate`, then a Prisma 7 client insert without the field gets max + 1, and Prisma 7's `migrate diff --from-config-datasource` stays empty.
- At least one constraint whose name diverges is touched: rename the implicit relation or give the `Post.author` relation a `map:` name. Assert the plan renames the constraint, and that after `db migrate` the database's constraint name equals the contract's.

In the fresh-database replay at the end, assert by catalog query that every primary key and foreign key name in the replayed database equals the name in the database Prisma 7 and Prisma 8 built together. Before the fix this fails on `_PostToTag_AB_pkey`.

The README's phase 4 section gains one bullet for edit 3. Keep the step-by-step story intact.

## Scope

Out:
- Postgres extensions (TML-3030, needs Will's decisions).
- `@ignore` storage (TML-3467, needs Will's decision).
- `_prisma_migrations` under strict verify (TML-3453).
- Changing `db verify` to compare names.
- `ALTER COLUMN TYPE` on an autoincrement column leaving an `AS integer` sequence; identity columns.

If any part turns out to need a contract or framework change, stop and report with evidence.

## Slice Definition of Done

Inherits `drive/calibration/dod.md`. Slice-specific:

- [ ] Every test above was red before its fix and is green after.
- [ ] `pnpm --filter prisma7-adoption test` passes with all three handover edits.
- [ ] The touched packages' typecheck, lint, tests and coverage thresholds pass; `pnpm fixtures:check` passes; upgrade coverage passes against the PR base.
- [ ] TML-3466 and TML-3452 are Done with closing comments after merge.

## Dispatch plan

| # | Outcome | Hands to |
|---|---|---|
| 1 | Part A: autoincrement on an existing column plans, applies, verifies and re-plans to nothing on PGlite, with unit and integration tests red-then-green. | A green Postgres target and adapter. |
| 2 | Part B: the Prisma 7 source states diverging names, the planner renames changed stated names, and unnamed primary keys are created with the name the planner drops. Fixtures and the introspection guard red-then-green. Upgrade instruction. | A green contract-prisma7, Postgres target and integration guard. |
| 3 | Part C and docs: handover edit 3 and the replay name check, README, regenerated example artifacts, error reference, migrations skill reference; CI-equivalent checks. | Branch ready for review. |
