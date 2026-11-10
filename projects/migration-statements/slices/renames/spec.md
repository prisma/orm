# Slice spec — Statements on the command line, and renames of models and fields on Postgres and SQLite

**Project:** [`projects/migration-statements/`](../../spec.md) · **Slice 1** · **Linear:** [TML-3475](https://linear.app/prisma-company/issue/TML-3475) · **Branch:** `tml-3475-statement-renames` (stacked on `tml-3474-migration-statements`; retarget to `main` once prisma/orm#30604 merges)

## At a glance

```text
$ prisma migration plan --name tidy-users --rename Profile:User --rename User.name:User.fullName
✔ Planned 4 operation(s)
  Rename table "Profile" to "User"                            widening
  Rename constraint "Profile_pkey" to "User_pkey"             widening
  Rename column "User"."name" to "fullName"                   widening
  Rename constraint "User_name_key" to "User_fullName_key"    widening

Statements applied
  rename model "Profile" to "User"
  rename field "User.name" to "User.fullName"
```

The written `migration.ts` contains `...this.renameTable({ table: 'Profile', to: 'User' })` and `...this.renameColumn({ table: 'User', column: 'name', to: 'fullName' })`, and re-running it writes the same `ops.json`. `prisma db update` with the same two statements does the same against a live database, with no consent prompt, and running it a second time with the same statements fails because `Profile` is no longer in the origin. A statement that names something the contracts do not have fails before anything is planned. Drops of indexes, constraints, checks, policies, defaults and native enum types no longer count as destructive anywhere.

## Chosen design

### Grammar

- Both commands take `--rename <old>:<new>`, declared with the engine's `flag.repeated`, so it may appear any number of times. Statements are processed in the order given. The command hands the control API one ordered list of statements, each with its verb and text (`{ verb: 'rename', text }`), and the parser and resolver take that list, so a later verb joins the same list. The engine's repeated flags keep the order within one flag, not across flags; when a second verb arrives, its statements follow all `--rename` statements unless the engine keeps the order across flags by then.
- Each side is a coordinate: `Model`, `namespace.Model`, `Model.field` or `namespace.Model.field`. Segments are separated by `.`; the sides by one `:`. A side with no `:`, more than one `:`, an empty segment, or more than three segments is `MIGRATION.STATEMENT_INVALID`, and the message quotes the statement and shows the four accepted forms.
- Both sides must have the same depth: model to model, or field to field. A model on one side and a field on the other is `MIGRATION.STATEMENT_INVALID`.
- A two-segment side is read as `namespace.Model` and as `Model.field`. Resolution decides: exactly one reading resolving is that reading; both resolving is `MIGRATION.STATEMENT_UNRESOLVED` naming both readings; neither is `MIGRATION.STATEMENT_UNRESOLVED` naming both attempts.
- A side with no namespace resolves when exactly one namespace of the contract declares the model; when several do, `MIGRATION.STATEMENT_UNRESOLVED` lists the qualified candidates. The default namespace is not special.
- Names are matched exactly, including case.

### Resolution

Resolution happens in the framework CLI package, before any family code runs, against the origin contract and the destination contract. Both sides resolve to domain coordinates: namespace id, model name, and field name when present. Storage never appears in resolution.

- **Model rename `A:B`.** `A` must be a model of the origin contract; `B` must be a model of the destination contract; `B` must not be a model of the origin contract; `A` must not be a model of the destination contract. Each failure is `MIGRATION.STATEMENT_UNRESOLVED` with a message naming the contract searched and the names found there. `A` and `B` may differ in namespace, in name, or both.
- **Field rename `M.a:N.b`.** `M` and `N` must resolve to the same destination model (so `M` is spelled as the destination contract spells it); a field rename that names two different models is `MIGRATION.STATEMENT_INVALID` saying a field cannot move between models. The origin counterpart of that model is the origin model an earlier `--rename` statement renamed to it, or the model of the same coordinate in the origin contract when none did. `a` must be a field of the origin counterpart; `b` must be a field of the destination model; `b` must not be a field of the origin counterpart; `a` must not be a field of the destination model.
- **Value objects, variants, relations.** A model coordinate may name a variant; it resolves like any model. A coordinate naming a value object, or a field of one, is `MIGRATION.STATEMENT_UNRESOLVED` saying value object renames are not supported in this release. A field coordinate naming a relation field resolves; its storage effect is nothing (see below).
- **Extension contract spaces.** Statements resolve against the application space only. A name that resolves only in an extension space is unresolved.
- **Origin contract absent.** When the command has at least one statement and no origin contract (see § Origin contract for `db update`), the command fails with `MIGRATION.STATEMENT_ORIGIN_UNKNOWN` naming the hash it looked for and the directory it looked in, before anything is planned.

Resolved statements are ordered as given and carry: kind `rename`, entity `model` or `field`, the origin domain coordinate and the destination domain coordinate.

### Planner input and the storage effect

- The framework planner input (the options object of `MigrationPlanner.plan` in `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts`, and the SQL family's `SqlMigrationPlannerPlanOptions`) gains `statements: readonly ResolvedMigrationStatement[]`, required, empty when none. Both the `migration plan` path and the `db update` path pass it.
- The SQL family maps each resolved statement to its storage effect by reading the storage bridge of the two models: a model rename compares the origin model's table coordinate with the destination model's; a field rename compares the origin field's column with the destination field's. Equal means no storage change and the statement is applied with no operations. Different means a table rename, a schema move, both, or a column rename.
- Each storage effect is applied in order to a working copy of the origin schema (the `createWorkingSchema` mechanism from prisma/orm#30570, on Postgres and SQLite), producing the rename call and its companion calls computed against the working copy as earlier statements leave it. The diff then runs on the adjusted origin.
- A rename whose target table's effective control policy is not `managed` fails planning with a planner conflict `statementRefused` whose summary names the table and the policy; the CLI surfaces it under `MIGRATION.PLANNING_FAILED`. Nothing is skipped silently.
- The planner's success result (not `MigrationPlan`, which hand-written migrations also implement) carries `appliedStatements`, one per statement in order, each with the resolved statement and the positions, in the plan's operations, of the operations it accounts for (operation ids are not unique within a plan, so statements do not refer to them); `migration plan` and `db update` print them under `Statements applied` in human output and as `appliedStatements` in JSON, after the operation list. One framework function, `describeMigrationStatement`, describes each one in the form `rename model "Profile" to "User"` and `rename field "User.name" to "User.fullName"`, using domain names; the CLI adds that description to each entry it reports.

### Operations

- **Table rename.** As on `main` and prisma/orm#30570: the table is renamed, foreign keys pointing at it are retargeted, policies follow, and each primary key, unique and foreign key is paired with the destination constraint of the same kind on the same columns and renamed to the destination's explicit name, else the name derived from the new table name, when that differs from the database's name. Indexes and checks pair by content hash. A model statement whose two sides are in different namespaces resolves (the grammar allows it) but the planner refuses it with a `statementRefused` conflict saying that moving a model to another namespace is not supported in this release; the move (`alter table set schema` on Postgres, with the working-schema step and companion names after the move) ships with the namespace renames in slice 3. SQLite has one namespace, so the case cannot arise there.
- **Column rename.** A new `renameColumn` facade method and planner call on Postgres and SQLite, in the style of `renameTable`: precheck that the old column exists and the new does not, postcheck the reverse. Companions: each unique and foreign key on the column is renamed to the destination's explicit name, else the default name derived from the table and the new column name; each index whose content includes the column is renamed to the destination's wire name, since the wire name hashes the column names (ADR 243). Checks referencing the column are recreated by the existing check path. On SQLite the rename uses `ALTER TABLE ... RENAME COLUMN` and indexes are rebuilt by the existing index-replacement path.
- **Rendering.** `renameTable` and `renameColumn` calls render into `migration.ts` as the facade calls a user would write, and the facade shares the working schema so that re-running the file reproduces `ops.json` byte for byte.
- **Classification.** Dropping an index, a unique or foreign-key constraint, a check, a row-level-security policy, a default or a native enum type, and disabling row-level security, are `widening` on Postgres and SQLite. `db update` no longer asks consent for them and `migration plan`'s baseline consent no longer counts them. The upgrade fragment records this.

### Origin contract for `db update`

- `db update` reads the marker rows already (`readAllMarkers` in `packages/1-framework/3-tooling/cli/src/control-api/operations/db-run.ts`). For the application space, it takes the marker's `storageHash` and reads the snapshot with `readContractSnapshotJsonTolerant` from the project's snapshot store. A found snapshot is deserialized through the family's contract serializer and passed as `fromContract` into `planFromDiff` instead of `null`.
- When the marker is absent or the snapshot is not found, `fromContract` stays `null`, and the command fails with `MIGRATION.STATEMENT_ORIGIN_UNKNOWN` only if statements were given. Without statements, behaviour is unchanged.
- `db init` accepts no statements; the flag is not declared on it.

### Refusal and consent

Unchanged in this slice. `db update` keeps `--confirm`; `migration plan` keeps its baseline-only consent. A rename statement simply removes the drop and create from the plan, so consent is not asked for them.

## Coherence rationale

One reviewer can hold this because every piece is the chain one outcome needs: a `--rename` flag produces a statement, the framework resolves it against two contracts, the family turns it into a storage rename applied to the working copy, the planner emits the rename and its companions ahead of the diff, and the command reports it. The widening reclassification is in the slice because a SQLite rename rebuilds indexes and would otherwise ask for consent, which breaks the outcome. The column rename operation is in the slice because a project that can rename a model but not a field has not delivered the feature.

## Scope

**In:** the grammar and resolver in the framework CLI package; the `statements` planner input; the SQL family mapping and working-copy application on Postgres and SQLite; the `renameColumn` operation and its companions on both targets; the substrate salvaged from prisma/orm#30570 (working schema, destination-driven companion names, foreign-key pairing, `toOps`, widening reclassification); `--rename` on `migration plan` and `db update`; the origin contract for `db update`; the `Statements applied` output; the three error codes in the error reference; the CLI README's `migration plan` and `db update` sections; the Migration System subsystem doc; an upgrade fragment; journeys on both targets.

**Out:** `--delete`, the refusal, `--confirm` removal (slice 2); `--convert`, `--backfill`, namespace and value renames, value object field renames, and a model move across namespaces (slice 3); Mongo (slice 4); the contract `hints` section, `@@hint`, any contract or snapshot change; any interactive prompt.

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| Statement names a table the control policy will not alter | Planner conflict, surfaced as `MIGRATION.PLANNING_FAILED`; nothing skipped. |
| Rename onto a name the origin still has (`A:B` with `B` present), including a swap | `MIGRATION.STATEMENT_UNRESOLVED`; the message says the new name already exists in the origin. |
| Same statements run twice against `db update` | The second run fails: the old name is not in the origin. |
| `@@map` keeps the table name across a model rename | Statement applied with zero operations; reported. |
| Relation field renamed | Applied with zero operations; reported. |
| Variant under single-table storage renamed | Zero operations unless the storage table changed; the discriminator value is slice 3. |
| Case-only table rename on Postgres (`user:User`) | Planned as a rename; the existing case guard never fires. |
| `migration plan --to <snapshot>` or `--from <hash>` | Statements resolve against whatever the two contracts are; nothing special. |
| `migration plan --from @empty` or an auto-baseline | There is no origin model to rename; any statement is unresolved. |
| `db update` with no marker or no snapshot for the marker hash | `MIGRATION.STATEMENT_ORIGIN_UNKNOWN` when statements are given; unchanged otherwise. |
| A foreign key from another table to the renamed one | Retargeted and renamed to the destination name, as prisma/orm#30570 does. |
| Two statements renaming A to B and C to A in that order | Refused: the first statement's `B` resolves, the second's `A` is a new name that exists in the working origin until the first applies; resolution runs on contracts, not the working copy, so `A` exists in the origin and the statement is unresolved. Documented as the swap rule. |

## Slice done conditions

- The project DoD journey restricted to renames: on Postgres and SQLite, `migration plan` with a model and a field statement then `migrate` on a table with rows, a unique, a foreign key from another table, a secondary index, a check and (Postgres) a policy; rows and objects present under the new names; a further plan empty; `db verify --schema-only` clean; the same through `db update` with no prompt; a second `db update` with the same statements fails with `MIGRATION.STATEMENT_UNRESOLVED`.
- Re-running the planned `migration.ts` writes identical `ops.json` and `migration.json`.
- `pnpm fixtures:check` passes with no artifact churn.
- `pnpm lint:framework-vocabulary` count unchanged.

## Open questions

None. The spelling choices above are final for this slice.

## References

- [`../../spec.md`](../../spec.md), [`../../design-notes.md`](../../design-notes.md)
- prisma/orm#30570, branch `tml-3422-intent-hints-model-rename`: `working-schema.ts`, `table-rename-calls.ts`, `table-rename-constraint-renames.ts`, `index-and-check-renames.ts`, `rename-rls-references.ts`, `schema-tables.ts` on both targets, and `resolve-table-rename.ts` in the family. Copy the mechanism; drop every reference to hints, `ConsumedHint`, the contract section and `resolveHints`.
- prisma/orm#30331 (merged): `renameTable`, `apply-table-rename.ts`, the journeys `test/integration/test/cli-journeys/rename-table-migration*.e2e.test.ts`.
- [ADR 243](../../../../docs/architecture%20docs/adrs/ADR%20243%20-%20Name-identified%20indexes%20and%20exact-name%20adoption.md) for index wire names; [ADR 009](../../../../docs/architecture%20docs/adrs/ADR%20009%20-%20Deterministic%20Naming%20Scheme.md) for derived constraint names.
