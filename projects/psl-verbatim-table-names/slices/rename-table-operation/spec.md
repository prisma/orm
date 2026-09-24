# Slice spec — Rename-table migration operation

**Project:** `projects/psl-verbatim-table-names/` · **Slice 2** · **Branch:** `psl-verbatim-rename-table` · **PR:** https://github.com/prisma/orm/pull/30331

## At a glance

Today a model whose table name changes plans as `DropTable` plus `CreateTable`, and the rows are gone. After this slice a user makes the rename its own schema change, runs `prisma migration new`, and writes one line in the generated migration:

```ts
this.renameTable({ table: 'userProfile', to: 'UserProfile' })
```

`migrate` then renames the table and every constraint and index named after it, and the rows survive.

## Chosen design

**A rename is stated in a hand-written migration, never inferred and never stated on the command line.** Tables have no content identity the way indexes and checks do (ADR 243), so the planner cannot tell a rename from a drop and a create. The documented long-term design is a planner hint in the contract source, `@hint(was: ...)` (Data Contract and Migration System subsystem docs, ADR 001); it is not implemented and is a follow-up outside this project. Until it exists, the way to state a rename is the one the migration system already offers for anything the planner cannot infer: a hand-written migration.

**`this.renameTable` emits every rename the table needs.** The migration facade method reads the migration's start and end contracts and emits the table rename followed by a rename for each object on that table whose name is derived from the table name: unnamed primary keys, unique constraints and foreign keys on Postgres; indexes and check constraints whose derived prefix comes from the table name; default-named indexes on SQLite, dropped and recreated because SQLite cannot rename an index. Only objects the end contract leaves otherwise unchanged are renamed; such an object takes the end contract's explicit name if it has one, otherwise the name derived from the new table name. An object the end contract also changes keeps the name the database has, so an author who writes that change by hand refers to it by that name. Amended after review: an earlier rule renamed changed constraints to the derived name, which only made sense while a planned drop followed. Explicitly named objects and foreign keys on other tables keep their names. On Postgres the method also carries the table's row-level security settings and policies to the new name where the contract refers to them by table name. If the start contract has no such table, or the end contract has no table under the new name, the method refuses with `MIGRATION.TABLE_RENAME_UNMATCHED`.

**The rename is its own schema change.** `migrate` verifies the database against the migration's end contract, so a hand-written migration that renames a table but omits other edits made in the same change fails loudly at `migrate`. The guide tells users to rename first, then make other edits and plan them.

**The operation.** `renameTable` on Postgres and SQLite: prechecks that the old table exists and the new one does not; postchecks that the new table exists and the old one is gone. Postgres qualifies by schema. SQLite folds only ASCII letters when comparing identifiers, so a rename that only changes ASCII case goes through a temporary name. Operation class `widening`. `RenameCheckConstraintCall` is generalised into `RenameConstraintCall` with a kind.

**The guard's remedies.** `MIGRATION.TABLE_NAME_CASE_CHANGED` offers three ways out: add `@@map` to keep the old table; in a project with migration history, create a migration with `prisma migration new` and call `this.renameTable(...)` in it; in a project managed with `db update`, run the statements the target supplies by hand, then `db update` again. On SQLite `db update` drops an index before creating one whose name collides only in ASCII case.

**No CLI flag.** An earlier version of this slice added `--rename <from>=<to>` to `migration plan` and `migration new`. It was removed because it is a second, undocumented way to state a rename that the documented hint design will replace. Amended 2026-09-17 on the operator's decision.

## Scope

**In:** the operation and its call for Postgres and SQLite; the facade method computing companion renames from the migration's contracts; the SQLite identifier-collision helper, index drop-before-create ordering, and rebuild postchecks; the guard's three remedies with target-supplied by-hand statements; the error reference; the upgrade fragments under `upgrade-instructions/pending/psl-verbatim-table-names/` and `upgrade-instructions/pending/rename-constraint-call/`; removal of the flag and everything reachable only through it.

**Out:** planner hints; rename inference; column renames; MongoDB collection renames (users rename by hand).

## Tests, all red before their change

- Operation, both targets: rendered SQL, prechecks, postchecks, TypeScript rendering round-trip.
- Facade, both targets: `this.renameTable` emits the table rename plus the companion renames for a table with an unnamed primary key, a unique constraint, a foreign key, an index and a check; a constraint the end contract also changes keeps its current name; an explicitly named object is left alone; an unknown table refuses.
- Guard, both targets: the three remedies and the target's by-hand statements.
- Journeys under `test/integration/test/cli-journeys/`: Postgres and SQLite, `migration new` plus a hand-written `this.renameTable` on a table with rows, a unique constraint, a foreign key and an index (and row-level security and a policy on Postgres); after `migrate` the rows and objects are present, a plan with no schema change is empty, `db verify --schema-only` is clean, and a follow-up migration removing those objects applies. The SQLite `db update` by-hand path journey stays.

## Done conditions

- Every test above is green; all repository checks pass one at a time, including `lint:framework-vocabulary` at or below main's count and the checks only CI runs.
- No `--rename` flag, `CLI.INVALID_RENAME_FLAG`, or rename-intent code reachable only through the flag remains.
- The project DoD line "a model rename in PSL keeps its rows on Postgres and SQLite" is met by the journeys.
