# Slice 8: migrations after the handover

_Parent project: `projects/prisma7-contract-source/`. Linear: TML-3457 (referential actions), TML-3458 (primary key changes), TML-3461 (Prisma 7 command redirects), TML-3262 (a verify check in a journey test that can never fail). One PR. Outcome: after Prisma 8 takes over migrations from a Prisma 7 schema (slice 5), changing a relation's `onDelete` or `onUpdate`, or moving a primary key, plans and applies; typing a Prisma 7 `migrate` command names the Prisma 8 commands; and the infer round-trip journeys check verify findings through JSON._

The decided points hold. One finding goes further than the ticket: Prisma 7 does not drop the foreign keys that reference a primary key it replaces, and its SQL then fails on Postgres (see Part B). Will's decision to drop and re-add them is what makes the change work at all.

## At a glance

Edit 5 of the handover test, on the Prisma 7 schema:

```prisma
model User {
  id    Int    @default(autoincrement()) @unique   // was @id
  email String @unique
  ...
  @@id([id, email])                                 // new
}

model Comment {
  ...
  post Post @relation(fields: [postId], references: [id], onDelete: Cascade)   // was no onDelete
}
```

Today `migration plan` fails with `MIGRATION.PLANNING_FAILED`: `foreignKeyConflict` for `Comment.post` and `indexIncompatible` for `User`'s primary key. After this slice it writes:

```sql
ALTER TABLE "public"."Comment" DROP CONSTRAINT "Comment_postId_fkey";
ALTER TABLE "public"."Post" DROP CONSTRAINT "Post_author_fk";
ALTER TABLE "public"."User" DROP CONSTRAINT "User_pkey";
ALTER TABLE "public"."User" ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id", "email");
CREATE UNIQUE INDEX "User_id_key" ON "public"."User" ("id");
ALTER TABLE "public"."Comment" ADD CONSTRAINT "Comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Post" ADD CONSTRAINT "Post_author_fk" FOREIGN KEY ("authorId") REFERENCES "public"."User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

`Post_author_fk` did not change. It is dropped and added back because it depends on the index of `User_pkey`, so Postgres refuses to drop the key while it exists.

And `prisma migrate dev` exits 2 with `CLI.COMMAND_MOVED`. Its `why` says Prisma 8 emits, plans and applies in separate steps, and to use Prisma 7's CLI while Prisma 7 still owns the migrations. Its next action is `prisma contract emit && prisma migration plan --name <name> && prisma db migrate --advance-ref db`.

The SQL above is abridged to one line per statement; the tests assert the exact rendering.

## Part A: a changed referential action (TML-3457)

### Today

- `SqlForeignKeyIR` (`packages/2-sql/1-core/schema-ir/src/ir/sql-foreign-key-ir.ts`) takes its `id` from the referencing columns and the referenced namespace, table and columns. `isEqualTo` compares only `onDelete` and `onUpdate`. So an actions-only change is one `not-equal` issue that carries both `expected` and `actual`. A change of columns or referenced table changes the `id`, so it is already a `not-found` plus a `not-expected` issue, which plan as an add and a drop.
- `mapForeignKeyNodeIssue` (`packages/3-targets/3-targets/postgres/src/core/migrations/issue-planner.ts`) returns `nodeConflict('foreignKeyConflict', …)` for `not-equal`.
- Postgres has no statement that changes a foreign key's actions. `ALTER CONSTRAINT` changes only deferrability. A drop and an add is the only way.

### Requirements

- A `not-equal` foreign key issue plans two calls: `DropConstraintCall(schema, table, actualName, 'foreignKey')` and `AddForeignKeyCall(schema, table, fkSpecFromNode(expected, table))`. `actualName` is `actual.name ?? defaultForeignKeyName(table, actual.columns)`; the add uses the expected node's name the same way. When the user also changed `map:`, the drop uses the old name and the add the new one.
- Order: the existing buckets already put every drop before every add, and `addForeignKey` last.
- `db update` gets the same plan: its start tree is the database, which states every name.
- `db init` keeps refusing, as it refuses any non-additive change: the drop is `widening` and `db init` allows only `additive` (`conflictForDisallowedCall` reports it as `foreignKeyConflict`).
- The constraint rename pass (`constraint-name-renames.ts`) does not see this foreign key, because it only renames constraints the diff finds unchanged. No change there.
- One known gap stays: `isEqualTo` reports drift only when the expected side states an action. Removing an action from a Prisma 8 PSL relation plans nothing. A Prisma 7 source always states both actions, so the handover path is not affected. Not changed here.

## Part B: a changed or removed primary key (TML-3458)

### Today

- `PrimaryKey` (`packages/2-sql/1-core/schema-ir/src/ir/primary-key.ts`) has the fixed `id` `primary-key` and compares its column list. A moved key is one `not-equal` issue with both nodes.
- `mapPrimaryKeyNodeIssue` returns `nodeConflict('indexIncompatible', …)` for `not-equal`. `not-found` adds a key and `not-expected` drops one.
- A foreign key depends on the unique index of the key or constraint it references. Postgres refuses to drop that key while such a foreign key exists. This is true for a plain `not-expected` drop today too: `@id` moved to `@unique` fails at apply time.
- Prisma 7.10.0 does not handle this. Driving its schema engine directly (the `diff` call `prisma7 migrate diff --from-schema --to-schema --script` makes) on two schemas where `Post`'s key moves from `id` to `@@id([id, slug])`, `id` gains `@unique`, and `Comment.postId` references `Post.id`, it writes only:

  ```sql
  ALTER TABLE "Post" DROP CONSTRAINT "Post_pkey",
  ADD CONSTRAINT "Post_pkey" PRIMARY KEY ("id", "slug");
  CREATE UNIQUE INDEX "Post_id_key" ON "Post"("id");
  ```

  Applied to PGlite after Prisma 7's own create script, it fails: `cannot drop constraint Post_pkey on table "Post" because other objects depend on it` (`constraint Comment_postId_fkey on table "Comment" depends on index "Post_pkey"`). For an actions-only change, Prisma 7 writes a plain drop and add of the foreign key, as Part A does.
- Drop order inside the `drop` bucket follows the issue sort, which breaks ties by path. A `not-equal` issue counts as building up, so the ordering law gives it no edge to the columns its old key was built on. When the old key's column is dropped in the same plan, the column drop can come first: Postgres then drops the key with the column (or refuses, when a foreign key depends on it), and `DROP CONSTRAINT` fails its precheck.

### Requirements

- A `not-equal` primary key issue plans `DropConstraintCall(…, actualName, 'primaryKey')` then `AddPrimaryKeyCall(…, expectedName, expected.columns)`. Names: `actual.name ?? defaultPrimaryKeyName(table)` and `expected.name ?? defaultPrimaryKeyName(table)`.
- For a `not-equal` or `not-expected` primary key issue, every foreign key in the start tree, in any namespace and any table including the same one, whose referenced table is this table and whose referenced columns as a set equal the old key's columns, is dropped before the key, unless the plan already drops it through its own issue (a `not-expected` or `not-equal` foreign key issue anywhere in the plan's full issue list). Each such foreign key that the end tree still has, with the same `id`, is added back from the end tree's node.
- A foreign key on a table the plan drops (a `not-expected` table issue) is still dropped explicitly first and not added back, so the key drop never depends on the order of a table drop.
- The plan refuses the key change with a `foreignKeyConflict` that names the key, the foreign key and its table, instead of touching that foreign key, when:
  - the control policy keeps the plan away from the foreign key's table (`external`, `observed`, `tolerated`, or the contract's `defaultControlPolicy`), by the same rule that filtered the plan's issues;
  - another contract space owns the foreign key's table; the refusal says so. Only `db update` can show it, because the start tree of `migration plan` comes from this space's start contract, which has no sibling's table;
  - the end tree leaves the foreign key out and the plan drops neither it nor its table. The refusal is chosen from the state: when the end tree keeps the table, the contract left out only the foreign key, and only a policy that allows additive changes alone (`db init`) hides that foreign key's drop; when the table is gone from the end tree, an additive-only policy hid the table's drop, or else the table is in a schema the end contract does not declare, whose tables a plan never drops. `migration plan` raises that last refusal when the start contract declared the schema; `db update` does not introspect a schema that no contract space declares, so it does not see such a foreign key and does not raise it (TML-3623).
- Each refusal's `why` is written for the commands that can show it:
  - Control policy: separate advice per command, as `table-name-case-guard.ts` does. For `migration plan`, whose start tree comes from the start contract: give the table a control policy that lets the plan change it and plan again, or write the change as its own migration with `migration new`, dropping the foreign key before the key change and adding it back after it. For `db update`: drop the foreign key by hand, run `db update`, then add it back if it is still wanted. When the contract declares that foreign key, also leave it out of the contract until then, because the runner verifies the result against the contract, and run `db update` again at the end, which moves the marker to the final contract.
  - Another contract space: change that foreign key through the contract space that owns the table, or write the change with `migration new`.
  - Left-out foreign key, under `db init`: the plan can neither drop that foreign key nor change a primary key; run `db update` instead, which plans from the same database. `migration plan` is not named: it plans from the start contract, not from the database `db init` read.
  - Undeclared table, under `db init`: the plan cannot change a primary key; run `db update` instead, which drops that table with its foreign key, or add the table to the contract first to keep it.
  - Undeclared schema: with `migration plan`, declare the table in the contract and plan again, or write the change with `migration new`; with `db update`, drop the foreign key by hand, run `db update`, then add it back if it is still wanted.
- `mapNodeIssueToCall` plans only a `not-found` primary key. A `not-equal` or `not-expected` key is planned only by the strategy; one that reaches the mapper is refused with `indexIncompatible`, so exactly one place drops a primary key.
- The constraint rename pass never renames a constraint that one of the planned `DropConstraintCall`s drops. Such a foreign key looks unchanged to the rename pass, so without this a name change would also produce a `RENAME CONSTRAINT` of a constraint the plan has already dropped.
- Inside the `drop` bucket, foreign key drops come first, then primary key and unique constraint drops, then the rest in today's order. A constraint never needs another object dropped before it, and dropping a column or table removes its constraints, so this order is always valid and does not depend on names.
- Re-added foreign keys go in the `foreignKey` bucket, after `primaryKey`, `unique` and `index`, so the new key or unique index they reference exists first. A Prisma 7 source writes `@unique` as a unique index, which Postgres accepts as the target of a foreign key.
- `db update` gets the same plan from the introspected database.

### Where the code goes

The referencing foreign keys live in other tables, possibly in other namespaces, and the decision needs every other issue of the plan. `mapNodeIssueToCall` sees one issue, and `StrategyContext.schema` holds one namespace node. So:

- `planIssues` takes, as required inputs, the whole start tree and the whole end tree (`PostgresDatabaseSchemaNode`s) from `planner.ts`, where `buildPostgresPlanDiff` already returns both, and a `foreignKeyDropAuthority(ddlSchemaName, tableName, foreignKey)` question built in `planner.ts`. It answers `allowed`, `controlPolicy` or `otherSpace`: `planner.ts` asks the ownership oracle whether another contract space owns the table, and runs the control-policy partition on a drop issue it builds next to the filter that defines the issue path layout. `StrategyContext` carries the trees, this question and `allIssues`, the plan's full issue list.
- A strategy, `primaryKeyChangeStrategy` in `primary-key-change.ts` beside `planner-strategies.ts`, consumes `not-equal` and `not-expected` primary key issues and returns the calls above, not as a recipe, so the calls are bucketed. A strategy result may carry `conflicts`; this one returns its refusals there.
- `plannedConstraintNameRenames` takes the planned calls and skips every constraint a `DropConstraintCall` drops.
- Postgres only. SQLite has its own planner (Part E), and no shared code branches on target.

## Part C: operation classes and the destructive-change policy

- `DropConstraintCall` is `widening` for every kind; `AddForeignKeyCall` and `AddPrimaryKeyCall` are `additive`.
- `migration plan` and `db migrate` allow every class; `db update` allows `additive`, `widening` and `destructive`.
- The plan questions of the migration statements project ask about data loss and access changes only. `postgresCallSubjects` (`operation-subjects.ts`) gives data loss only to `destructive` calls and access changes only to RLS calls. So a drop paired with an add asks nothing, needs no `--delete`, and is not refused. No class or hint changes.
- **Decision: keep two existing calls, not a new single operation.** Each keeps its precheck and postcheck: the drop checks the constraint exists and then is gone; the add checks it is absent and then exists with the planned columns, target and actions. The runner skips an operation whose postcheck already holds, one operation at a time, and the whole `db migrate` run is one transaction on Postgres, so the database never commits a state without the constraint. Prisma 7 writes the same pair. A single `replaceForeignKey` operation would need a new operation kind, a new `migration.ts` call and new renderers, and would add nothing that the transaction does not give already.
- A new primary key or a re-added foreign key can fail on existing rows (duplicate or null key values, an orphaned reference after `onDelete` was not enforced). Postgres raises the error, the runner rolls the run back, and the database is unchanged. That is the right result; no precheck is added.

## Part D: `NOT VALID` for the re-added foreign key

**Decision: plain `ADD CONSTRAINT … FOREIGN KEY`, as `addForeignKey` writes today and as Prisma 7 wrote.**

- `ADD … NOT VALID` then `VALIDATE CONSTRAINT` helps only when the two run in separate transactions: `VALIDATE` takes a weaker lock that lets writes continue during the scan. The Postgres runner runs a whole `db migrate` in one transaction, and the `DROP CONSTRAINT` before it takes an `ACCESS EXCLUSIVE` lock on the table that it holds until commit. So the split changes nothing for the user and adds a second step to every plan.
- Revisit if the runner ever commits operations separately.

## Part E: SQLite

- SQLite cannot alter a constraint in place. `recreateTableStrategy` (`packages/3-targets/3-targets/sqlite/src/core/migrations/planner-strategies.ts`) classes primary key, foreign key and unique issues of any outcome as `widening` and rebuilds the table. So SQLite already plans both changes; it has no refusal to remove.
- This PR does not change SQLite. One unit case pins that a foreign key whose actions change is absorbed into a rebuild (`planner-strategies.test.ts` lists a changed primary key and a dropped foreign key, not this case).

## Part F: Prisma 7 command redirects (TML-3461)

### Today

- `redirects` in `packages/1-framework/3-tooling/cli/src/orm/family.ts` is a list of `RedirectSpec` from `@prisma/cli-engine`: `from`, an optional `flag`, one `replacement` (a command line that may contain `{bin}`), and a short `reason`. The engine answers a matched invocation with exit code 2, `CLI.COMMAND_MOVED`, `why` from the reason, and one `run-command` next action.
- Matching is exact by path, longest match first, and ignores flags. A redirect may not name a mounted command or command group. Nothing mounts `migrate`, so `migrate dev` and the others are free. The in-repo shell test `createOrmCli … constructs without a collision` covers this repository; the real host in the prisma-cli repo builds the same table and runs the same construction check, so a collision there would show in its tests, not at a user's prompt.
- Prisma 8 has no `db reset`, `db diff` or `migrate resolve`. Its commands: `contract emit`, `migration plan`, `db migrate`, `migration status`, `db update --dry-run`, `db verify`, `db sign [<contract>]`.

### Mapping

| Prisma 7 | Replacement | Reason |
|---|---|---|
| `migrate dev` | `{bin} contract emit` | Prisma 8 emits the contract, plans the migration and applies it in separate steps: run `contract emit`, then `migration plan --name <name>` (for `--create-only`, stop here), then `db migrate --advance-ref db`; while Prisma 7 still owns this project's migrations, run `migrate dev` with Prisma 7's CLI instead. |
| `migrate deploy` | `{bin} db migrate` | `db migrate` applies the planned migrations; while Prisma 7 still owns this project's migrations, run `migrate deploy` with Prisma 7's CLI instead. |
| `migrate status` | `{bin} migration status` | Same pattern as above. |
| `migrate diff` | `{bin} db update --dry-run` | `db update --dry-run` prints the changes between the contract and a live database without applying them; to write the changes between two contracts as a migration package use `migration plan`, and to report drift use `db verify`. |
| `migrate reset` | `{bin} db migrate` | Prisma 8 never drops a database: drop and recreate it with your database's own tools, then `db migrate` applies every migration; while Prisma 7 still owns this project's migrations, run `migrate reset` with Prisma 7's CLI instead. |
| `migrate resolve` | `{bin} db sign <migration>` | `db sign <migration>` checks that the database already has that migration's schema and moves the database marker to that migration's contract, so `db migrate` continues after it; `migration status` does not list the migration as applied. Use it where you would run `migrate resolve --applied` after applying a migration's changes by hand. While Prisma 7 still owns this project's migrations, run `migrate resolve` with Prisma 7's CLI instead. |

Decisions:

- **The replacement is one command, never a shell chain; a value in angle brackets, such as `<migration>` in `db sign <migration>`, is a placeholder the user fills in.** The CLI engine turns it into a `run-command` next action whose `command` is a single invocation (`RedirectSpec.replacement` in `@prisma/cli-engine`), and it should do what the Prisma 7 command did or less.
- **`migrate dev` names its first step, `contract emit`, and the reason names the other two.** `contract emit` comes first because `migration plan` reads the emitted contract and does not emit it. `--advance-ref db` is in the reason because the next plan starts from the `db` ref.
- **`migrate diff` maps to `db update --dry-run`.** Both only print. `migration plan` writes a migration package, so it is in the reason, not the command.
- **`migrate reset` has no equivalent and says so.** Prisma 8 never drops a database (see `docs/design/10-domains/migration/README.md`). The replacement is the command that rebuilds an empty database from `migrations/`.
- **`migrate resolve` maps to `db sign <migration>`.** `migrate resolve --applied <migration>` says "this migration's changes are already in the database". `db sign` with a migration directory name verifies that the schema matches that migration's contract, then moves the database marker there, so `db migrate` continues after it. It writes no ledger entry, so `migration status` does not list that migration as applied; the reason says so. `db migrate --to <migration>` was considered: it would record the migration, because the runner skips an operation whose postcheck already holds, but it also applies whatever part of the migration the database lacks, which `migrate resolve` never does, so it breaks the rule that a replacement does what the Prisma 7 command did or less. `--rolled-back` has no counterpart. The reason does not claim that a failed migration rolls back whole, because that holds only on targets that run a migration in one transaction.
- **The `migrate dev`, `migrate deploy`, `migrate status`, `migrate reset` and `migrate resolve` reasons say to use Prisma 7's CLI while Prisma 7 owns the migrations.** The `migrate diff` reason does not: its replacement only reads. During the side-by-side period, `prisma` is Prisma 8's binary and Prisma 7 runs under another name (`prisma7` in the example). Before the handover, the Prisma 8 commands are the wrong answer.

## Part G: the verify check that can never fail (TML-3262)

- `expectVerifiesCleanAfterPull` in `test/integration/test/cli-journeys/infer-roundtrip-fidelity/harness.ts` ran `db verify --schema-only`, asserted exit 0, then asserted the output did not match `/✖ (?:missing|extra):/`. The engine prints neither that glyph nor that layout, so the second check always passed.
- Lenient mode cannot catch a left-out column either: `computeSqlDiffVerdict` (`packages/2-sql/9-family/src/core/diff/schema-verify.ts`) drops a relational extra before grading it, and warnings come only from an `observed` control policy. So the helper runs strict mode.
- **Built:** the helper is now `expectStrictVerifyIssues(ctx, subject, expectedIssues = [])` in `test/integration/test/utils/journey-test-helpers.ts`, next to `runDbVerify`. It runs `db verify --schema-only --strict --json`, reads the result document, and asserts `ok`, `meta.strict` (which must be true), the issue list as `{ path, nodeKind, outcome }`, and an empty warning list. `ok` must be true exactly when the expected list is empty. `SESSIONS_CROSS_SCHEMA_FOREIGN_KEY` stays in the fidelity harness, because it belongs to that journey's seed.
- **One expected issue:** the seed of the main fidelity journey has `sessions.owner_ref REFERENCES secure.owners(id)`. `contract infer` reads one schema and deliberately leaves that foreign key out as dangling, keeping the scalar column and writing a comment (`resolveForeignKeys` in `packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-foreign-keys.ts`). Strict verify reports the live constraint as extra. The three callers in `infer-roundtrip-fidelity.e2e.test.ts` pass `SESSIONS_CROSS_SCHEMA_FOREIGN_KEY`, which matches it on path, node kind and outcome.
- `sql-expression-literals.e2e.test.ts` checked `db verify --schema-only` by exit code only; it now uses the same helper.
- Sweep result: no other journey asserts on a verify glyph. The other negative output checks in `test/integration/test/cli-journeys` and `examples/*/test` assert on PSL or migration text that the command really prints.
- Proof that the helper can fail: removing `email` from the inferred PSL in the PascalCase journey makes it fail with an issue at `column:email`; the edit was then reverted.

## Tests (write them first; each must fail before its fix)

Unit, `packages/3-targets/3-targets/postgres/test/migrations/`:
- `node-issue-planner.test.ts`: a `not-equal` foreign key plans a drop then an add with the new actions; with a changed stated name, the drop uses the old name and the add the new one.
- New `primary-key-change.test.ts`: a moved key plans drop then add; a composite key whose referencing foreign key lists the columns in another order; the refusal for an `external`, `observed` and `tolerated` table, for a `defaultControlPolicy` of `observed`, for a table another contract space owns, and, under an additive-only policy, for a table the contract does not declare and for a kept table whose foreign key the contract leaves out, for a table in a schema the end contract does not declare, each with its whole failure and advice; the plain `db update` advice when the contract does not declare the foreign key; a missing `tolerated` table that references the moved key is still created; a contract default of `external` plans nothing; a foreign key an earlier strategy already planned is not dropped twice; referencing foreign keys in the same table, another table and another namespace are dropped and re-added; a referencing foreign key with its own `not-equal` issue is not duplicated; one on a dropped table is dropped and not re-added; a `not-expected` key drops its referencing foreign keys; a foreign key that references a unique constraint on the same table, not the key, is left alone.
- The drop sub-order: a key drop and a drop of its old column come out key first whatever the column's name (`id` and `uuid`).
- `node-issue-planner.test.ts`: without the strategy, a moved or removed key is refused and a missing key is added.
- `constraint-name-rename-planner.test.ts`: replace `leaves a primary key whose columns change to the conflict it reports today` with the planned replacement; add a re-added foreign key whose name also changes, which gets no `RENAME CONSTRAINT`.

PGlite, `packages/3-targets/6-adapters/postgres/test/migrations/` (beside `planner.stated-constraint-names.integration.test.ts`):
- New `planner.referential-action-change.integration.test.ts`: plan and apply an actions change on a table with rows; `pg_constraint` shows the new `confdeltype`/`confupdtype`; re-planning plans nothing.
- New `planner.primary-key-change.integration.test.ts`: the at-a-glance change with rows and a referencing foreign key in another schema; a key moved off a column that the same plan drops; apply both through `migration plan` (start tree from a contract) and through `db update` (start tree from introspection); re-plan plans nothing; `db verify` has zero findings. The `db update` case uses the at-a-glance edit and asserts the planned operation ids; the `db init` case asserts each refusal and its `widening` class; a `db update` with a referencing foreign key on a table the contract marks `external` is refused with the exact conflict, and following its `db update` advice then succeeds and leaves the marker at the final contract.

SQLite, `packages/3-targets/3-targets/sqlite/test/migrations/planner-strategies.test.ts`: add "a foreign key whose actions change" to the rebuild cases.

Planner goldens, `test/integration/test/planner-golden/`: they plan every committed contract from an empty database, so they contain no drops and should not change. Run them anyway; if one changes, explain why in the PR.

Handover, `examples/prisma7-adoption/test/handover.test.ts`: add `test/handover/edit-5.prisma` after the edit-3 restore and before the fresh-database replay. Assert the operation ids and classes, the rendered SQL above, `db migrate`, `db verify --strict` with nothing unclaimed, an empty Prisma 7 `migrate diff --from-config-datasource`, and a Prisma 7 client delete of a post that removes its comments (`v7-after-edit-5.ts`). The replay then also proves a fresh database built from `migrations/` gets the same constraint names.

CLI, `packages/1-framework/3-tooling/cli/test/orm/cli.test.ts`: extend the redirect table assertion with the six entries; add one run of `migrate dev --name x --json` asserting the `CLI.COMMAND_MOVED` envelope and its replacement with the binary name substituted; `createOrmCli` still constructs.

Journeys: the `expectStrictVerifyIssues` change makes its seven callers stricter. Prove the new helper can fail: run one journey once with a contract edit that leaves an extra column, see it fail, then revert. Run journey files with `--project integration`: without it, `pnpm test <file>` also runs the file in the `packaging` project, where `contract infer` fails with `CONFIG.EVALUATION_FAILED`. Run the touched journey files one at a time with `pnpm test <file>` inside `test/integration`; never the full suites.

## Docs to update

- `docs/architecture docs/subsystems/7. Migration System.md`: beside the constraint rename paragraph, describe how a changed foreign key action and a changed or removed primary key plan, and the drop order. Add the six rows to "Removed-verb redirects".
- `skills/prisma-8/references/migrations.md`: one line under Key Concepts or Common Pitfalls that actions and primary key changes plan as drop and add, with the referencing foreign keys; one line mapping the Prisma 7 `migrate` commands.
- `examples/prisma7-adoption/README.md`: one bullet for `edit-5.prisma` in the phase 4 list, and in "What a Prisma 7 user meets along the way" one line that Prisma 7's own plan for a moved key fails when a foreign key references it, and Prisma 8's does not.
- `packages/2-sql/2-authoring/contract-prisma7/README.md`: no change; it describes the reader, not the planner.
- `docs/reference/error-reference.md`: no entry names the two removed refusals, so nothing to remove. `CLI.COMMAND_MOVED` is the CLI engine's code, not this repository's, so it gets no entry.
- `projects/prisma7-contract-source/slices/05-migration-ownership-handover/spec.md` listed `onDelete`/`onUpdate` and primary key changes as out of scope "by design today"; this slice is the follow-up, so no edit there.

## Acceptance criteria

- The at-a-glance edit plans exactly the seven statements, in a valid order, on `migration plan` and on `db update`, and applies on Postgres with rows in every table.
- No plan with a key replacement asks a data-loss question or needs a statement flag.
- `db init` still refuses an actions change and a moved key.
- Every redirect in the table answers with exit 2, `CLI.COMMAND_MOVED`, its reason and its replacement.
- `expectStrictVerifyIssues` fails on a live column the contract leaves out.
- `pnpm --filter prisma7-adoption test` passes with five handover edits.

## Non-goals

- A changed unique constraint (`mapUniqueNodeIssue` still refuses `not-equal`) and a changed index (`mapIndexNodeIssue`). Foreign keys that reference a dropped unique constraint have the same dependency problem; not on the handover path.
- Removing an action from a Prisma 8 PSL relation (the `isEqualTo` gap in Part A).
- `NOT VALID` foreign keys and splitting the runner's transaction.
- SQLite changes.
- Redirects for `db push`, `db pull`, `db seed` and `db execute`.
- Changing the public upgrade guide in prisma/web.

## Slice Definition of Done

Inherits `drive/calibration/dod.md`. Slice-specific:

- [ ] Every test above was red before its fix and is green after.
- [ ] `pnpm --filter prisma7-adoption test` passes with all five handover edits.
- [ ] The touched packages' typecheck, lint, tests and coverage thresholds (`pnpm test --coverage`) pass; `pnpm lint:deps` passes; `pnpm check:upgrade-coverage --mode pr --prev <base> --head HEAD` passes (no consumer-facing change is expected; declare that if it asks).
- [ ] TML-3457, TML-3458, TML-3461 and TML-3262 are Done with closing comments after merge.

## Dispatch plan

| # | Outcome | Hands to |
|---|---|---|
| 1 | Parts A, C, D: a changed foreign key action plans drop and add on Postgres, with unit and PGlite tests red then green. | A green Postgres target and adapter. |
| 2 | Part B: primary key replacement with referencing foreign keys, the drop sub-order and the rename-pass skip; unit and PGlite tests; the SQLite pin (Part E). | A green Postgres and SQLite target. |
| 3 | Part F: the six redirects and their tests. Part G: the JSON verify helper and the `sql-expression-literals` journey, each journey run on its own. | A green CLI and integration journeys. |
| 4 | Handover edit 5, README bullets, Migration System doc, migrations skill reference; CI-equivalent checks. | Branch ready for review. |
