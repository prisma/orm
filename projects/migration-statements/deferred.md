# Deferred — Migration statements

Items found during delivery that are out of the current slice's scope. Each names where it came from and what would resolve it. Transient; migrated or dropped at close-out.

## A model that keeps its name but changes its table (`@@map`) has no statement

**Found:** slice 1, dispatch 4 review (2026-10-06).

A user keeps `model User` and changes `@@map("users")` to `@@map("app_users")`. The diff shows a dropped table and a created one, exactly like a rename, but there is no model rename to state: `--rename User:User` is unresolved because the new name already exists in the origin. In `migration plan` the user can write `this.renameTable({ table: 'users', to: 'app_users' })` by hand; in `db update` there is no way to avoid the drop and create. Slice 1 refuses a field statement on such a model with `statementRejected` (D4-1) so it never plans a column rename on a table the diff then drops.

**Options:** let a same-coordinate model statement (`--rename User:User`) mean "this model's storage was renamed"; or add a storage-level statement; or accept the hand-written route for this case. Decide with the operator before slice 2 writes the refusal text, because the refusal will otherwise suggest a `--rename` that cannot resolve.

**Decided 2026-10-07 by Will:** no statement for this case in this project. Slice 2's refusal keeps slice 1's manual steps for both commands. A statement that can name storage objects rather than models and fields is wanted later; Will floated `--rename table/users:app_users` as an illustration only, and the syntax needs a critical design discussion and a survey of established prior art before anything is chosen.

**What depends on it:** `MigrationDataLoss.keepDataAdvice` (framework components, `control/migration-statements.ts`) exists only because this statement is missing. The SQL family (`keepTableAdvice` in `operation-subjects.ts`) and the MongoDB target (`keepCollectionByHandAdvice`, reached from `collectionDrops` in `mongo-planner.ts`) use it to print manual steps for this one case. When the statement lands, the planner answers this case with it, and both advice texts go, with the field if nothing else uses it. Slice 3a (PR #30695) adds `label` to the same type, `MigrationDataLoss`; whichever of the two PRs merges second combines the two changes.

## A model move across namespaces (`auth.User:public.User`)

**Found:** slice 1, dispatch 3 (2026-10-06). Resolves but is refused with `statementRejected`; needs a `set schema` operation with its working-schema step and companion names. Scheduled for slice 3 with the namespace renames (recorded in `plan.md`).

## A codec's `onFieldEvent` hook never sees the prior contract under `db update`

**Found:** slice 1, dispatch 5 review (2026-10-06). Settled by slice 2, dispatch 4 (2026-10-08).

Since slice 2, `db update` reads the origin contract on every run with a snapshot, but the planners give field-event planning the prior contract only when the plan has an origin. `db init` and `db update` plan with `origin: null`, so the hook reports every column as added on every run, with or without a snapshot, as before slice 1, and a plain `db update` plans the same operations whether or not the snapshot exists. No codec in the repository implements `onFieldEvent` today. If a codec needs real `added`, `dropped` and `altered` events under `db update`, the plan's operations would then depend on the snapshot, and that needs a decision.

## Which field name a MongoDB statement uses

**Found:** slice 1, dispatch 7 review (2026-10-07). For slice 4.

On SQL a statement names the model's field (`User.fullName`), and the storage bridge maps it to a column. On MongoDB every authoring surface keys a model's `fields` by the stored name (`@map("_id")` gives `fields._id`), so a statement resolved today against a Mongo contract names the stored field (`User._id`). Slice 4 must decide whether Mongo statements name the model's field or the stored field, and make the resolver agree on both families.

## A SQLite column rename followed by a table rebuild builds the replacement index twice

**Found:** slice 1, whole-slice code review (2026-10-07), finding F04.

When one plan renames a column on SQLite and a later step rebuilds the same table, the column rename's companion index replacement (drop and create) runs, then the rebuild creates the index again. Rows are kept; one index build is wasted. Removing the companion would need the planner to rewrite statement calls after the diff, and then re-running `migration.ts` (whose `renameColumn` cannot see the later rebuild) would no longer reproduce `ops.json`. Fixing it properly needs operations that carry dependency information, which the design notes already name as a direction.

## `--delete <namespace>` consenting for every model in the namespace

**Found:** slice 2, whole-slice architect review (2026-10-08). For slice 3.

Project decision 6 lets a namespace delete cover everything in the namespace while the refusal lists each model. The engine answers a question only by a value equal to its subject or starting with it, so a namespace-wide answer has to be expanded by the ORM before the questions are asked. Slice 3 adds the namespace noun to `rename` and `delete` together and does that expansion there. Until then every `delete` names one model, field or storage object.

## A MongoDB validator that requires a new field leaves existing documents unwritable

**Found:** slice 2 manual QA (2026-10-08), F9. For slice 4.

Adding a required field to a populated collection, or making an optional field required, updates the collection's validator with no question and no warning; it is `widening`, since the validator applies only to later writes. Every existing document that lacks the field then fails any update with `Document failed validation`. Nothing is lost, but nothing tells the user that existing documents need the field. A backfill statement would let the user say how to fill them.

## The Postgres runner's NOT NULL failure gives advice about drift

**Found:** slice 2 manual QA (2026-10-08), F10. Pre-existing text.

`db update` making a column NOT NULL on a table with a NULL fails at the precheck (`ensure no NULL values in "note"`) with nothing lost, but the next action says to reconcile schema drift, and the `why` says only "Migration runner failed". The advice should say how many rows hold NULL and how to fix them, or keep the field optional.

## The refusal's next actions are one line per flag, not grouped by subject

**Found:** slice 2 manual QA (2026-10-08), F11. Engine side.

`CLI.CONSENT_REQUIRED` lists one `user-choice` next action per flag form ("Run the command again with --delete Legacy", another for the rename form), not grouped by subject and not a complete runnable command, and its summary says "N subjects need a statement", which is project vocabulary. Grouping the forms per subject and printing a full command would need the engine to know the invocation; raise it on prisma/prisma-cli once the statement prompt has shipped.

## SQL variants stored in their own tables

**Found:** slice 4a design (2026-10-09). Will: SQL will need to handle multi-table storage of variants in the future.

On MongoDB a variant's field rename touches only that variant's documents. On SQL today a variant's field is a column in the shared table, and a rename applies to every row. When SQL supports variants stored in their own tables, a variant's field statements must act on that variant's table only.

## MongoDB `@map` accepts field names MongoDB cannot validate

**Found:** slice 4a review of dispatch 3 (2026-10-09). For the MongoDB authoring owners, not this project.

`@map("o.d")` or `@map("$x")` is accepted in a MongoDB schema. MongoDB reads such a name as a path or an operator, and an insert of `{ "o.d": ... }` already fails the validator Prisma writes. Slice 4a skips such fields when planning statements. The fix belongs in authoring: reject the name with a diagnostic. When it lands, remove the framework resolver's fallback that reads `User.o.d` as field `o.d` (added in slice 4a), and the planner's silent skip of such fields.

## A repeated run reports outdated statements one at a time

**Found:** slice 4a manual QA (2026-10-09), F3. Applies to every family.

Running the same `db update` again after it applied fails on the first outdated `--rename` or `--delete`, so a user with three outdated flags needs three runs to learn about all of them. The resolver could report every statement that no longer resolves in one error.

## A collection name MongoDB rejects reaches the runner

**Found:** slice 4a manual QA (2026-10-09), F9. For the MongoDB authoring owners.

`@@map("system.x")` is accepted in a MongoDB schema. A rename onto it is refused with a reason, but a plan that creates or drops such a collection fails at apply with `CLI.UNEXPECTED`. Authoring should reject collection names MongoDB rejects.

## `db migrate` of a migration with an unfilled placeholder gives advice that does not mention the slot

**Found:** slice 3a review (2026-10-12). Older than this project's slices.

A migration written with a placeholder has `ops.json` as `[]`. Running `db migrate` before filling the slot applies nothing and then fails at the destination check with general advice. It should say that the migration still has an unfilled slot, name the slot, and say to fill it and run `node migration.ts`.

## `db migrate` applies an `ops.json` older than its `migration.ts`

**Found:** slice 4a review (2026-10-12). Older than this project.

The Migration System doc lists emit-drift detection (re-emit `migration.ts` in memory and compare with `ops.json` before applying) as architecturally required and not yet implemented. Without it, a user who edits `migration.ts` and forgets to run it applies the old operations; in slice 4a's review that turned a wrong advice text into a dropped collection. Worth a ticket when this project closes, if none exists.

## `migration status --json` prints `{bin}` unreplaced

**Found:** slice 3a review (2026-10-12). Outside this project. The summary text in the JSON output contains a raw `{bin}` placeholder.

## A Postgres `dataTransform` whose `run` returns the wrong shape fails with an unclear error

**Found:** slice 3a review (2026-10-12). Outside this project.

When `run` returns an array of plans or a SQL string, `node migration.ts` fails with "Cannot read properties of undefined (reading 'storageHash')". It should say what `run` must return.

## A data-loss question can offer one flag value per verb

**Found:** slice 4a review, dispatch 3 (2026-10-09). Engine side.

The statement prompt writes one flag value per verb, so a question about a field whose model the destination names differently cannot print the two statements that keep its values (the model rename, then the field rename). The question offers only `--delete` and says to pass the model rename first, after which the next question offers the field rename. Printing both statements at once would need the engine to accept several flag values for one verb.

## The SQLite `recreateTable` call in `migration.ts` is hard to read

**Found:** slice 3a manual QA (2026-10-12), F11. Older than this project's slices.

A SQLite table rebuild renders as a 40-line `recreateTable` call full of internal fields, so a `--convert` slot sits at its end where it is easy to miss. A shorter rendering, or one built from the contract the way `alterColumnType` is on Postgres, would make the slot easy to find.

## Printed commands in other commands' outputs still leave out `--config` and `--db`

**Found:** slice 3a review round 2 (2026-10-13), S07. Tracked as TML-3575.

`db migrate`, `db update` and `migration plan` print every command through `cliCommand` in `packages/1-framework/3-tooling/cli/src/utils/printed-command.ts`. About 100 other `{bin} …` literals do not: `migration status`, `db init` failures (`db-init-failure.ts`), `db sign` beyond its re-run command, `contract emit`, `prepare.ts`, `cli-errors.ts` (for example `MIGRATION.PLAN_ORIGIN_UNKNOWN`), and `reemitHint` in the migration package. Followed from another directory, they load a different config or none.

The re-run advice has a second gap of the same kind, found in the slice 3b PR 1 second system-design review (2026-10-22), S05. `CliInvocation.rerunArgs` holds one command's arguments (`db update`'s `--to`, `--advance-ref` and statements, and `db migrate`'s `--to` and `--advance-ref`) on the invocation that every printed command uses, and only the advice after a blocked drop reads it (`blockingObjectsFix` through `db-update-failure.ts` and `migrateFix`). The other re-run advice of the same failures still prints the command without them. Name it as the command that ran, for example `CliInvocation.command: { name, args }`, with a `rerunCommand(invocation)` helper that every "re-run the same command" advice uses.

## The shared-collection reach check reads the discriminator value back out of a filter

**Found:** slice 4p review, PR 2 rounds 4 and 5 (2026-10-19).

`otherModelsReached` in `packages/3-mongo-target/1-mongo-target/src/core/migrations/mongo-statement-planning.ts` learns which variant a field removal selects by reading the discriminator value back out of the removal call's MongoDB filter (`discriminatorValueOf`). It is safe today, because a filter it cannot read is treated as reaching every model. Carry the selection as a typed value, the discriminator field and value, on `FieldRemoval` and on the statement outcome, and write the filter from it at the end. Do it with the next PR, which changes the discriminator to a stored key, so the filter changes shape anyway.

## The enum refusal walks the models a second time

**Found:** slice 4p review, PR 2 round 5 (2026-10-19).

`validatedEnumNames` in `packages/2-mongo-family/1-foundation/mongo-contract/src/contract-refusals.ts` works out which enums a managed collection's validator lists by walking root models, variants, embedded models and value objects. `deriveCollectionValidators` already walks the same types, and is the authority on what a validator lists, for example below the entry point of a recursive group. Have the derivation report the enums it listed, for example by returning `{ validators, listedEnums }` from one internal walk, and refuse from that, so the two walks cannot drift apart.

## A planner-written row rewrite holds its locks for its whole run

**Found:** slice 3b spec discussion with Will (2026-10-21).

Slice 3b plans each row rewrite as one plain operation: an `UPDATE` for an enum value rename, a discriminator conversion or a value object key rename, and a `DELETE` for a removed variant's rows. A migration runs in one transaction, so on a large production table the rewrite blocks writes to every row it touches until it commits, and next to DDL such as a check rebuild it blocks the whole table. Nothing batches it or runs it in the background. 3a's `--backfill` and type conversions have the same cost. Will ruled that 3b's goal is that the planner sees these changes; making the rewrites cheap is a later optimization.

## Derived checks are added with a full table read under lock

**Found:** whole-branch review of the value object storage PR (2026-10-23).

The planner adds each derived check, value object shape checks included, with a plain `ALTER TABLE … ADD CONSTRAINT … CHECK (…)`. Postgres holds a lock on the table while it reads every row. The check's name holds a hash of its expression, so any change to a value object drops the check and adds it again, and the rows are read again. Adding the check `NOT VALID` and then running `VALIDATE CONSTRAINT` takes a weaker lock while the rows are read. It changes how every derived check is planned, enum checks included, so it belongs with the row rewrite cost above.

## `--delete billing` is not offered as a next action, and the CLI copies the engine's unused-flag error

**Found:** slice 3b PR 1 system-design review (2026-10-21), S04.

When a removed namespace has questions, the `CLI.CONSENT_REQUIRED` refusal's `nextActions` list one `--delete` per model; `--delete billing` appears only in the question text. And because the CLI engine answers a question only with a flag equal to its subject, `db update` and `migration plan` take the `--delete` values from the engine themselves and raise `CLI.CONSENT_UNUSED` through their own `errorConsentUnused` in `packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts`, a copy of the engine's error. Resolve it in the CLI engine (prisma/prisma-cli): let a question name extra flag values that answer it, such as its namespace, so the engine matches `--delete billing`, lists it in `nextActions`, and raises its own error for an unused flag. Then delete the copy and the command-side matching.

Everything the prompt adapter (`packages/1-framework/3-tooling/cli/src/orm/plan-question-prompt.ts`) does to work around the engine goes with it (slice 3b PR 1 second system-design review, 2026-10-22, S06):

- `namespaceDeletes`, which takes the `--delete` values from the engine when one names a removed namespace and matches them itself through `matchConsents`, raising `errorConsentUnused`.
- The one-question-at-a-time mode (`askOneAtATime`), used when a question is about a removed namespace, so a typed `delete billing` answers the rest of the namespace and a typed `rename billing:finance` leaves them open for the next round.
- `isConsentRequired`, which catches the engine's `CLI.CONSENT_REQUIRED` for one question and asks the engine again with every open question, so its refusal names them all.
- The `undefined` answer that `AnswerPlanQuestions` may return beside a `rename` or `convert` answer, and the `InternalError` in `checkAnswers` that guards it.

## `SchemaTables` is asked about namespace ids of the origin contract

**Found:** slice 3b PR 1 system-design review (2026-10-21), S07.

`SchemaTables` in `packages/2-sql/9-family/src/core/migrations/schema-tables.ts` says it is addressed by the contract's namespace ids, meaning the destination's. A namespace rename asks `hasNamespace(rename.from)` and a move asks `hasTable` of its source, both origin ids. Postgres's `postgresSchemaTables` resolves them through the destination contract's storage and falls back to the id, which works only because a named Postgres schema's name is its id. Either document that ids of either contract are accepted, or have the family pass a name resolved through the right contract.

## A model move of a table that another contract space's table references by foreign key

**Found:** slice 3b PR 1 code review (2026-10-21).

`--rename billing.Invoice:finance.Invoice` moves the table with `ALTER TABLE … SET SCHEMA`. Postgres keeps a foreign key from another contract space's table pointing at it, and the app's plan is right, but the other space's contract still names the old schema, so that space's next plan sees drift. A table rename has the same gap on main. It needs a cross-space design: either refuse a move or rename of a table another space references, or tell the other space's plan about it.

## One model with two access questions needs `--allow` twice

**Found:** slice 3b PR 1 manual QA (2026-10-21), F5. Older than this PR: on main an `--allow` answers one operation.

Reproduction: remove `@@rls` and the policy from a model `Invoice`, then run `db update --no-interactive`. It refuses with two questions about `"Invoice"`, one for dropping the policy and one for disabling row-level security, each answered by `--allow Invoice`. `db update --allow Invoice` still refuses, with "Run the command again with --allow Invoice"; only `--allow Invoice --allow Invoice` applies. To resolve it, either let one `--allow <model>` answer every access question about the model (the control API's `givenFor` and the dry run's `answeredByFlags` match all of them, and the CLI engine needs to accept one flag for several questions with the same subject, as `--delete <namespace>` works around today), or give each access question its own subject, such as the policy name.

## A planner warning about the unbound namespace on every multi-namespace run

**Found:** slice 3b PR 1 manual QA (2026-10-21), F9; referred by the system-design review. Older than this PR: main prints it too.

Reproduction: emit a PSL contract with a `namespace public` block and a `namespace billing` block (for example `test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/contract-namespace-statements-from.prisma`) and run `db update --json`, then `db update --dry-run --json`. Both carry the warning `control policy suppressed: namespace "__unbound__" — namespace '__unbound__' has effective control 'external' but declared 'external'`, checked on origin/main at `1e98c69e1b` and on this branch. Something plans a namespace-level call or issue for the unbound namespace, whose control policy is `external`, and `partitionCallsByControlPolicy` or `partitionIssuesByControlPolicy` in `packages/2-sql/9-family/src/core/migrations/control-policy.ts` records it as a suppression. Find what plans it and stop planning it, or record no suppression for the unbound namespace, which has no fixed place in the database.

## A dry run with unanswered questions suggests an apply command that is refused

**Found:** slice 3b PR 1 manual QA (2026-10-21), F12. Older than this PR.

`db update --dry-run` ends with `→ Apply the planned operations: prisma db update`, repeating the statements it was given. When the plan has questions that no given statement answers, running that command non-interactively fails with `CLI.CONSENT_REQUIRED`. The next action in `migrationResultNextActions` (`packages/1-framework/3-tooling/cli/src/orm/db/migration-blocks.ts`) could say to answer the questions listed above, or point at them, when any is unanswered.

## `--delete <namespace>` with no snapshot says only that it answers no question

**Found:** second whole-PR review of the namespace statements, fix round (2026-10-22).

`db update --delete billing` against a database whose marker hash has no local snapshot fails with `CLI.CONSENT_UNUSED`: the planner has no origin contract, so it reports no removed namespace, and the namespace's tables stay. Nothing is lost, which is the right outcome, but the message does not say why. `--rename` in the same situation fails with `MIGRATION.STATEMENT_ORIGIN_UNKNOWN`, which names the hash and the snapshot directory. A namespace `--delete` that matches no question should say the same when the origin contract is unknown.

## Enum value renames are statements the statement planner does not plan

**Found:** slice 3b PR 2 system-design review (2026-10-22), S04.

`StatementPlanner.plan` returns `ok([])` for an enum value rename (`packages/2-sql-family/9-family/src/core/migrations/statement-planning.ts`). The rewrite is planned again in `planEnumValueRewrites` (`enum-value-planning.ts`), ordered with the diff because on Postgres it must run between the old check's drop and the new check's creation, and `withEnumValueOperations` patches its operation indexes onto the applied statements afterwards. Nothing in the types says so. To resolve it, give the statement planner's result an outcome for "planned with the diff", which the target fills, instead of an empty operation list. Settle this before PR 4, whose JSON rewrites have the same ordering need.

## Stored value code is copied in both SQL targets, and the runners read the counted value from the check's parameters

**Found:** slice 3b PR 2 system-design review (2026-10-22), S05.

`stored-value-calls.ts` in `packages/3-targets/postgres/1-target` and `packages/3-targets/sqlite/1-target` are nearly the same (`storedValueSubjects`, `storedValueOperationIndexes`, `keepRowsEdit`), and each runner builds the `rowsHoldingValue` summary and report itself, counting the value it reads from `step.params[0]`, which ties it to the parameter order of the check SQL. To resolve it, add `rowsHoldingValueFailure({ mark, operationIndex, count })` in the SQL family beside `rowsWithoutValueFailure`, let the check's marker carry the encoded value to count, and share the subject and index helpers in the family with the call classes passed in.

## `rowsHoldingValue` reports one column where its sibling reports a list

**Found:** slice 3b PR 2 system-design review (2026-10-22), S06.

`MigrationRunnerFailureMeta.rowsHoldingValue` is one fact for the failing column, while `rowsWithoutValue` lists the failing field first and then every other field of the same migration that lacks values. An enum can type required columns in several tables, so a user who changes the data in one table re-runs and fails on the next. To resolve it, make it a list with a field per entry, counted for each marked removal of the same migration, as `rowsWithoutValueFailure` does.

## `StoredValueRewrite.namespaceId` reads as the enum's namespace

**Found:** slice 3b PR 2 system-design review (2026-10-22), S07.

In `enum-value-planning.ts`, `namespaceId` is the table's namespace while `enumValue.namespaceId` is the enum's. Rename it, for example to `tableNamespaceId`. The other field the review named, `keptName`, became `keepData` in the manual QA fixes.

## Older debt the enum value work follows

**Found:** slice 3b PR 2 system-design review (2026-10-22), S08.

- `keepTableAdvice` (`packages/2-sql-family/9-family/src/core/migrations/operation-subjects.ts`) builds a `keepDataAdvice` string with `prisma migration plan` and `prisma db migrate` written in, so it ignores how the CLI was invoked. Enum values now pass a typed `keepDataEdit` that the CLI words; the table advice could move to the same shape.
- `RowsWithoutValue` and `RowsHoldingValue` are framework types named after rows, with a `rows` count, and the older `rowsWithoutValue` advice in `packages/1-framework/3-tooling/cli/src/utils/runner-failure-advice.ts` says "rows". Rename both to family-neutral names in one pass, for example `MissingValues` and `HeldValues` with `count`.
- `ENTITY_WORDS` (`packages/1-framework/3-tooling/cli/src/control-api/statements/statement-text.ts`) is keyed by a hand-written union; key it by `MigrationSubject['kind']` so a new subject kind must add its word. Its doc says it covers what a statement can name, but it has no `namespace`.

## Members that trade stored values while the list of stored values stays the same are not asked about

**Found:** fixing PR 2's manual QA (enum values), 2026-10-23; corrected after the verification review the same day.

An enum `A = "a", B = "b"` becomes `B = "a", A = "b"`: each member keeps its name and takes the other's stored value, and the list of stored values in storage is still `a, b`. The storage hash does not change, so `migration plan` prints "No changes detected" and `db update` plans nothing, on Postgres and SQLite. The rows still hold `a`, which now reads as member `B`. This is a change to the domain part only (which member names which stored value), so it is the same class as TML-3720 (the snapshot and the planner see nothing when only the domain changes). When the same plan also changes something else, the planner does ask, and on Postgres the printed edit, which swaps through a temporary value, can fail against the kept check without changing anything. A single `UPDATE … SET c = CASE c WHEN 'a' THEN 'b' WHEN 'b' THEN 'a' END` would need no temporary value. Resolve together with TML-3720, and consider it in PR 3, which makes more domain facts part of storage.

## Column value-set references are not checked against storage

A column's `valueSet: { plane: 'storage', entityKind: 'valueSet', entityName }` is not checked to name an existing `storage.namespaces.<ns>.entries.valueSet` entry, in either family. A hand-edited or corrupt `contract.json` with a dangling reference passes validation and fails later. PR 3 of the remaining-nouns slice adds the check for value object members only, in `validateStorageValueObjects` (`@internal/contract/validate-storage`), where the column check belongs too. Found in the review of that PR, 2026-10-23.

## Composite types are not namespaced in SQL PSL

SQL PSL resolves a composite type by its bare name across all namespaces and writes every value object to the default storage namespace. Two composite types with the same name in different PSL namespaces are refused with `PSL_DUPLICATE_DECLARATION` (before PR 3 of the remaining-nouns slice they silently overwrote each other). Letting each namespace declare its own needs namespace-qualified type references in PSL and writing each value object to its namespace's storage. When that changes, `generate-contract-dts.ts` must also emit one `<Name>Output` alias per storage namespace; today it emits one per name, from the first namespace. Found in the review of that PR, 2026-10-23.

## The SQL ORM cannot write some value object members

Found in the review of the value object storage PR, 2026-10-23. Both limits are older than that PR.

- A `BigInt` member of a value object cannot be written: the `pg/jsonb@1` codec throws "Do not know how to serialize a BigInt". The same holds for a `pg/interval@1` member, whose value holds a `bigint`. Their codecs declare the JSON type their value would have: `pg/int8@1` and `pg/unboundedint@1` declare `number`, and `pg/interval@1` declares `object`.
- A `Bytes` member is written as an object of byte indexes, such as `{"0":1,"1":2}`, not as bytes. Its codec declares `object`, the type it is written as today.

## The SQL TypeScript builder has no value objects

`defineContract` in `@internal/postgres/contract-builder` cannot declare a value object, so a SQL contract written in TypeScript cannot have one. The main SQL ORM test contract (`test/integration/test/sql-orm-client/fixtures/contract.ts`) used to patch a value object into its built contract; it now stores `User.address` as a plain `jsonb` column, and the value object type tests read a PSL fixture (`fixtures/value-objects`). That contract cannot move to PSL, because PSL cannot write its to-one relation without a foreign key (`Article.reviewer`).
