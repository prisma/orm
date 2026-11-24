# Deferred — Migration statements

Items found during delivery that are out of the current slice's scope. Each names where it came from and what would resolve it. Transient; migrated or dropped at close-out.

## ~~A model that keeps its name but changes its table (`@@map`) has no statement~~

**Resolved 2026-11-18 by Will:** a model, field or enum member with the same name in both contracts is the same object, and the planner renames its storage with no statement ([`storage-naming.md`](./storage-naming.md), ADR 324). Built on PostgreSQL and SQLite on branch `tml-3839-stored-name-renames`; MongoDB follows. The field refusal on such a model is gone on SQL. `keepTableAdvice` stays for the cases where no rename is planned (storage not `managed` on both sides, a split or merge, MySQL). The text below is the record of the earlier decision.

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

`CLI.CONSENT_REQUIRED` lists one `user-choice` next action per flag form ("Run the command again with --delete Legacy", another for the rename form), not grouped by subject and not a complete runnable command. Grouping the forms per subject and printing a full command would need the engine to know the invocation; raise it on prisma/prisma-cli once the statement prompt has shipped.

Manual QA on 2026-11-23 met the cost: with two models removed, the error prints four "Run the command again with …" lines as if any one were enough. The user needs one choice per model, and following one line refuses again for the other model.

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
- `ledByKeepDataWays`, which removes the ways to keep the data from the question text in the refusal's `why`, because it gives them first in the next actions. It goes once the engine's question has its own field for ways to keep the data, which the engine shows in the prompt and turns into next actions when it refuses.

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

## `StoredValueRewrite.namespaceId` reads as the enum's namespace

**Found:** slice 3b PR 2 system-design review (2026-10-22), S07.

In `enum-value-planning.ts`, `namespaceId` is the table's namespace while `enumValue.namespaceId` is the enum's. Rename it, for example to `tableNamespaceId`. The other field the review named, `keptName`, became `keepData` in the manual QA fixes.

## Older debt the enum value work follows

**Found:** slice 3b PR 2 system-design review (2026-10-22), S08.

- `keepTableAdvice` (`packages/2-sql-family/9-family/src/core/migrations/operation-subjects.ts`) builds a `keepDataAdvice` string with `prisma migration plan` and `prisma db migrate` written in, so it ignores how the CLI was invoked. MongoDB enum values pass a typed `keepDataEdit` that the CLI words (the SQL family no longer produces one); the table advice could move to the same shape. It is now reached only where no rename is planned for a model that keeps its name: storage not `managed` on both sides, a split or merge, and MySQL.
- `RowsWithoutValue` and `RowsHoldingValue` are framework types named after rows, with a `rows` count, and the older `rowsWithoutValue` advice in `packages/1-framework/3-tooling/cli/src/utils/runner-failure-advice.ts` says "rows". Rename both to family-neutral names in one pass, for example `MissingValues` and `HeldValues` with `count`.
- `ENTITY_WORDS` (`packages/1-framework/3-tooling/cli/src/control-api/statements/statement-text.ts`) is keyed by a hand-written union; key it by `MigrationSubject['kind']` so a new subject kind must add its word. Its doc says it covers what a statement can name, but it has no `namespace`.

## Members that trade stored values while the list of stored values stays the same are not asked about

**Found:** fixing PR 2's manual QA (enum values), 2026-10-23; corrected after the verification review the same day.

An enum `A = "a", B = "b"` becomes `B = "a", A = "b"`: each member keeps its name and takes the other's stored value, and the list of stored values in storage is still `a, b`. The storage hash does not change, so `migration plan` prints "No changes detected" and `db update` plans nothing, on Postgres and SQLite. The rows still hold `a`, which now reads as member `B`. This is a change to the domain part only (which member names which stored value), so it is the same class as TML-3720 (the snapshot and the planner see nothing when only the domain changes). When the same plan also changes something else, the planner now refuses the swap as a cycle and gives two plans through a value no member stores (updated 2026-11-18, stored-name renames). A single `UPDATE … SET c = CASE c WHEN 'a' THEN 'b' WHEN 'b' THEN 'a' END` would need no temporary value, and would let the planner make the swap in one plan. Resolve together with TML-3720, and consider it in PR 3, which makes more domain facts part of storage.

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

## A value object rename (`--rename Address:Location`) stays refused

**Found:** slice 3b PR 4, dispatch 24 (2026-10-30).

The resolver refuses a statement that names a value object as a whole. The planner compares a value object of the origin only with the value object of the same name in the destination, so a value object renamed in the contract source is a value object removed and one added: no key is rewritten, and on Postgres the new shape check of each column that holds it is added over the old data. The JSON of a column does not name its value object, so a rename that keeps the fields changes no data; one that also renames fields would need the field comparison to follow the rename. The project design table lists a value object rename as reported as applied; the 3b spec does not list it.

## A type change of a value object field is not a statement

**Found:** slice 3b PR 4, dispatch 24 (2026-10-30).

A field of a value object that changes type, such as `String` to `Int`, plans no rewrite. On Postgres the new shape check rejects every row whose JSON still holds the old type, so the apply fails at the check; on SQLite the rows keep the old type silently. A `--convert GeoPoint.lat` would need a placeholder for the conversion at every path, as `--convert Model.field` writes one for a column.

## Question for Will: the variant lookup stays in each family

**Found:** slice 3b PR 4, dispatch 28 (2026-10-30).

The 3b spec's implementation notes ask to move MongoDB's variant lookup into the framework, so SQL and MongoDB share it. MongoDB's lookup is `selectedVariantOf` and `variantFilter` in `packages/2-mongo-family/1-foundation/mongo-contract/src/model-documents.ts`, and `destinationOf` and `destinationDiscriminator` in `packages/3-targets/mongo/1-target/src/core/migrations/mongo-variant-planning.ts`, which find where each variant went and its discriminator as the destination stores it. PR 4 does not do this, because the repo rule `.agents/rules/never-change-the-framework-domain.mdc` forbids adding to the framework domain. SQL has its own lookup in `packages/2-sql-family/9-family/src/core/migrations/variant-planning.ts`: `originVariants`, `variantValue`, `baseOf`, `discriminatorColumn` and `destinationOf` find each variant, its discriminator value and where it went, and `planVariantRowRewrites` turns them into rewrites and deletions. The two read the same domain types twice. Will to decide whether the lookup should stay in each family, move to a shared package outside the framework domain, or justify an exception to the rule.

## A value object field has no default, so `--backfill` has none to respect

**Found:** slice 3b PR 4, dispatch 28 (2026-10-30).

A field of a value object cannot declare a default in this release. So when a value object field becomes required, the planner has no default to fill existing objects with: `migration plan` needs `--backfill`, and `db update` uses a temporary value. A column field with a default is filled from its default instead. When value object fields can carry defaults, the fill should take the default first, as a column does, and `--backfill` should then be refused for a defaulted field, as it is for a column (`backfillOfDefaultedField`).

## Question for Will: both families keep a model's empty `fields` in their own canonicalization hook

**Found:** slice 3b PR 4 review, dispatch 29 (2026-10-30).

A variant with no fields of its own has an empty `fields` object, which canonicalization would drop. So both `packages/2-sql-family/1-core/contract/src/canonicalization-hooks.ts` and `packages/2-mongo-family/1-foundation/mongo-contract/src/canonicalization-hooks.ts` keep the pattern `domain.namespaces.*.models.*.fields`. That path is in a framework type, `ContractModelBase.fields`, and the framework canonicalizer already keeps its siblings `relations` and `storage` itself (`DOMAIN_MODEL_RELATIONS_PATTERN` and `DOMAIN_MODEL_STORAGE_PATTERN` in `packages/1-framework/0-foundation/contract/src/canonicalization.ts`). Moving the pattern beside them would keep it once, but it changes the framework, which `.agents/rules/never-change-the-framework-domain.mdc` forbids without Will's approval. The second pattern, `models.*.storage.fields`, is family storage and stays in each family. Will to decide whether to move the first pattern into the framework canonicalizer.

## On SQLite, a foreign key that cascades to a deleted row from a table other than the variant's own still fails the apply

**Found:** slice 3b PR 4 review round 2, dispatch 30 (2026-10-30).

The SQLite runner turns foreign keys off, so no declared cascade runs. The plan deletes the rows of a variant's own table before the base rows, as that table's cascade would. A table whose foreign key to the variant's table cascades (for example `bug_attachment` to `bug`), or another table whose foreign key to the base table cascades, is not handled: the apply fails at `PRAGMA foreign_key_check` with `MIGRATION.FOREIGN_KEY_VIOLATION`, naming the referencing tables, and the database is left as it was. A general fix belongs to the SQLite runner's foreign key handling, not to the statements.

## The dictionary refusal could plan `.*` paths now

**Found:** slice 3b PR 4 review round 2, dispatch 30 (2026-10-30).

The refusals for a column that holds a value object through a dictionary say the planner cannot list the paths in such a column. Since the wildcard selects the member values of an object, a path such as `$.byCountry.*.lat` reaches every object in a dictionary on both targets. No SQL authoring surface writes a dictionary of value objects today, so the refusal stays. When one does, plan the dictionary with `.*` instead of copying the refusal and its reason forward.

## A hand-written migration with only data rewrites is refused as a no-op self-edge

**Found:** slice 3b PR 4 manual QA (F19), dispatch 30 (2026-10-30).

`prisma migration new` from the current contract, with only a `renameStoredKey` in its `migration.ts`, is refused by `db migrate` with `MIGRATION.CONTRACT_SPACE_VIOLATION` (source equal to target with no data invariant). Every operation of the statements can be called by hand, but for a `Json` column there is no contract change to attach a data rewrite to. The user has to make an unrelated contract change to carry it.

## `db update` gives no query for a removed enum value inside a list when it does not know the database's contract

**Found:** slice 3b PR 4 manual QA (F9), dispatch 30 (2026-10-30).

When rows hold an enum value `db update` removes from a member that takes no null, and no migration on disk ends at the database's contract, the advice says to change the stored value in the database by hand, with no query. Inside a list this needs `jsonb_agg` over `jsonb_array_elements` on Postgres, or `json_group_array` over `json_each` on SQLite. The by-hand route through `migration plan --from <hash>`, which writes `replaceStoredValue` with a path, needs that contract. The advice to add a new member and `--rename` to it works inside lists too.

## Question for Will: a migration package does not record unfilled placeholders

**Found:** slice 3b PR 4 review round 3, dispatch 31 (2026-10-30).

`migration plan` knows when a migration it writes has unfilled placeholders, but it writes `ops.json` as `[]`, the same as a migration with no operations. So `db migrate` must read the code of `migration.ts` to find a call of `placeholder`, and it cannot find one made from a helper file that `migration.ts` imports. Recording the unfilled state in the package needs a new field on `MigrationMetadata` (`packages/1-framework/3-tooling/migration`), which changes the on-disk format and the migration hash, so this PR does not do it. `migration new` has the same gap: its `ops.json` is `[]` until the user runs `node migration.ts`, so a migration the user forgot to emit is applied as zero operations. Recommendation: add the field in its own change, so both commands write it and `db migrate` refuses on it instead of reading `migration.ts`.

## The MongoDB JSONPath parser is a copy of SQL's

**Found:** slice 4b PR 2 review of dispatch 1 (2026-11-11).

`packages/3-targets/mongo/1-target/src/core/migrations/stored-key-path.ts` copies the JSONPath parser in `packages/2-sql-family/9-family/src/core/migrations/json-path.ts` (`parseJsonPath`, `writtenPrefix`, `jsonPathText`). What is missing is one shared parser. It was copied because the layering rules stop the MongoDB target from importing the SQL family, and the framework domain may not take it. Two copies of one grammar can drift apart. Move the parser to a shared package outside the framework domain that both families may import, once such a package is agreed. One difference is intended: the MongoDB walk reads a wildcard as the elements of a list only, never as an object's member values.

## The question about a removed field of an embedded model says nothing of the model's new required fields

**Found:** slice 4b PR 2 review of dispatch 3 (2026-11-14).

When a value object loses a field and gains a required one, the question about the removal says whether the new field gets a temporary value or still needs `--backfill` (`newRequiredFieldNote` in `packages/1-framework/3-tooling/cli/src/control-api/statements/plan-questions.ts`). A MongoDB embedded model that loses `Line.sku` and gains a required `Line.code` gets no such note, because its fields are `field` subjects, and the note reads only `valueObjectField` subjects. Giving `field` subjects the note would also give it to every root model's removed field beside a new required one, on SQL too, whose plans word that case through their own refusals. Telling an embedded model apart in the CLI needs the domain's owner relation, which no other part of the question reads. What is missing is only that note. The plan itself is right: `--delete Line.sku` plans the removal, and the new field is filled with a temporary value or left to the document check, whose advice names `--backfill Line.code`.

## A boolean enum value held by a required MongoDB field gets no rename advice when its removal stops

**Found:** slice 4b PR 2 review of dispatch 4 (2026-11-17).

When `removeStoredValue` stops because a required field holds the value, the MongoDB runner writes the framework's `rowsHoldingValue` fact, and the CLI then advises renaming the enum value. The fact's `value` is typed `string | number` (`RowsHoldingValue` in `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts`), so for an enum whose stored values are booleans the runner leaves the fact out. What is missing is the CLI's `--rename` advice for that case. The failure's own text still counts the documents, names one `_id` and says to rename the value or change the documents. Widening the fact's type to `boolean` is a framework change, so it waits for a ruling.

## Ask before refusing

**Found:** slice 4b PR 2, manual QA round 3, new problem 1 (2026-11-17). Updated after the round 5 reviews and QA round 4 (2026-11-18).

The MongoDB planner cannot know which removals the user answered with `--delete`, because `MigrationPlanner.plan()` receives only resolved statements and the CLI keeps delete answers. So a plan-wide refusal that involves unanswered changes names them and the statements that keep their data, instead of asking. Passing delete answers to `plan()` (a framework interface change) would let the planner ask first and judge the plan the answers produce. That change should delete `packages/3-targets/mongo/1-target/src/core/migrations/mongo-unanswered-changes.ts`, not leave it next to a working question.

What the two plan-wide refusals print, when a removal in the plan could keep its data (a field the destination model gains, a variant it keeps, or the one new variant of its base):

- The overlap refusal (an operation writes what another empties): "The plan holds changes that no --rename or --convert statement carries: field "User.a", which the plan removes. To keep their data, run the command again with: --rename User.a:User.c." Then its reason (MongoDB applies operations one at a time, without a transaction). Then "If every answer is --delete, the plan stays as it is: make the change as two changes to the contract, and apply the first, by a migration or by db update, before you make the second: …", with the route for that overlap.
- The filter-order refusal (an operation's filter reads what another changes): the same lead, then "One of these operations finds its documents by what another changes, and the order the plan needs runs it on the wrong side of that change." Then "If every answer is --delete, the plan stays as it is: make the change as two changes to the contract, and apply the first, by a migration or by db update, before you make the second: first make only the part of the change that "<operation>" carries out; then the rest."

A refusal whose removals can only be deleted prints only its reason and its two-migration route. A user who answers `--delete` gets the same refusal again, because the planner cannot see the answer; the last sentence of each refusal is the route for that user.

A discriminator renamed without its statement no longer reaches these refusals. A new required discriminator is never filled with a temporary value, since a temporary value names no variant: the plan is refused with "Cannot plan the migration: new discriminator field "Task.kind" has no value in the documents of collection tasks", and the reason offers "add --rename Task.type:Task.kind to keep it, and run the command again". That refusal is only for documents that hold their variants in an old discriminator the destination no longer has. A model's first discriminator, or a new one beside an old discriminator kept as a field, is left to the validator change's document check, as on `main`: it applies on an empty collection, and a document without the field stops it with `--backfill Task.type` named for `migration plan`. The refusal holds whatever the other answers are, including `--delete Task.type --convert Bug` and `--delete Task.type --delete Bug`, under `migration plan` and `db update`. A variant `--convert` whose discriminator field the plan does not rename (for example one the plan backfills) is refused with the same rename; a variant delete no statement asked for is refused the same way, as "Cannot plan the migration: the documents of variant "Bug" hold their discriminator value in field "type", which the plan does not rename to "kind"", so a user who said nothing about `Bug` is not told that its documents cannot be deleted.

What `mongo-unanswered-changes.ts` copies from the CLI, because the target cannot import it:

- `newModelFields` and `onlyNewModelField` from `packages/1-framework/3-tooling/cli/src/control-api/statements/plan-questions.ts`, as `newModelFields`: the fields of the destination model that the origin model does not have and no rename names.
- `onlyNewMember` from the same file, as `newMembers`: the members of the destination enum that the origin enum does not have and no rename names.
- `newValueObjectFields` and `onlyNewValueObjectField` from the same file, as `newValueObjectFields`.
- `newVariantsOfBase` from `packages/1-framework/3-tooling/cli/src/control-api/statements/variants.ts`, as `newVariants`, and the model case of `renameForm` from `plan-questions.ts`: a removed variant is offered `--rename Bug:Defect` when its base has exactly one new variant.
- `renameForm` from `plan-questions.ts`, as `answerOf`: the single candidate, else `<new name>`.
- The field case of `subjectText` from `plan-questions.ts`, as `subjectText`: a field of a model a rename statement renames is named through the model's new name (`Job.type`, not `Task.type`), because the statement resolver reads the old side of a field rename through the destination model. `discriminatorRenameOf` in `mongo-discriminator-renames.ts` names both sides of the discriminator rename statement the same way; where its refusal says which field the documents hold their variant in, it names the origin field (`Task.type`). A field of a model the destination does not have is left out of the list, since no field statement can keep its data and no question offers one.
- `shellQuoted` from `packages/1-framework/3-tooling/cli/src/control-api/statements/statement-flag.ts`, as `statementFlag` in `packages/3-targets/mongo/1-target/src/core/migrations/mongo-statement-flags.ts`, which `takenValueAdvice` in `mongo-enum-value-planning.ts` and the discriminator refusals also use.

The copies leave out namespace renames, which MongoDB contracts do not have.

In the other direction, the CLI's `sharesValueWithKeptMember` in `plan-questions.ts` decides that a MongoDB enum question's `keepDataAdvice` is the two-migration route by repeating the planner's overlap rule (`overlappingChanges` in `mongo-enum-value-planning.ts`): a member that takes the stored value of a member the destination still has, or gives its own to one. Under `db update` it then leaves that advice out, since the command gives its own two-run route. A structured reason on `MigrationDataLoss` saying which route the advice is would replace this inference; that is a framework interface change.

Where it lives: the refusal is built by `overlapRefusal` in `packages/3-targets/mongo/1-target/src/core/migrations/mongo-rewrite-overlaps.ts`, which takes its lead from `unansweredChangesAdvice` in `mongo-unanswered-changes.ts`. `packages/3-targets/mongo/1-target/src/core/migrations/mongo-planner.ts` marks which operations no statement carries. The discriminator refusals are in `mongo-field-fills.ts` and `mongo-variant-planning.ts`, with the rename from `mongo-discriminator-renames.ts`. The interface is `MigrationPlanner.plan()` in `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts`; the delete answers stay in `packages/1-framework/3-tooling/cli/src/control-api/statements/plan-questions.ts`.

## `--delete` of a variant still asks about the variant's own fields

When a MongoDB contract removes a variant (`Bug`) and its fields, the CLI asks about `Bug`'s removed fields as well as about `Bug`. Answering `--delete Bug` deletes the variant's documents, so the plan's removal of those fields then has nothing to do. No data is lost, but the user answers questions that do not matter.

What is missing: `--delete Bug` should also answer the questions about the fields of `Bug`, as `--delete` of a namespace answers the questions about what it holds. That needs matching, unused-flag and next-action handling in the CLI's statement resolution and questions (`packages/1-framework/3-tooling/cli/src/control-api/statements/`), like the namespace delete has. It is family-blind CLI work, not small enough to ride along in the MongoDB nested-statements PR.

## A base that loses its discriminator and variants stops at the document check

When a MongoDB contract removes a base's discriminator and all its variants (`Task` loses `type`, `Bug` and `Epic`), the plan keeps every document and asks no question; `--delete Bug` is "given but nothing asked". The apply then stops at the validator change's document check, because documents still hold fields only the removed variants had (`severity`), which the new validator does not name. Nothing is lost: the stop changes nothing and gives the by-hand routes (an update in `mongosh`, or `checkDocuments: false` under `db migrate`).

What is missing: a question about the fields only the removed variants had, so `--delete` can remove them in the plan. That needs a decision on how a question names a field of a model the destination no longer has. Files: the variant planning in `packages/3-targets/mongo/1-target/src/core/migrations/mongo-variant-planning.ts`, the field removals in `mongo-planner.ts`, the document check in `mongo-runner.ts` (`documentsFailingValidatorRefusal`), and the CLI questions in `packages/1-framework/3-tooling/cli/src/control-api/statements/plan-questions.ts`.

## Statement errors say "rows" on MongoDB

The CLI's statement errors say "rows" on every database: "A new model has no existing rows to backfill" and "the field ... is optional in the destination contract, so no existing row needs a value" and "... is already required in the origin contract, so every existing row has a value", in `packages/1-framework/3-tooling/cli/src/control-api/statements/resolve-statements.ts`. On MongoDB these are documents. The advice in `packages/1-framework/3-tooling/cli/src/utils/runner-failure-advice.ts` ("Set a value in those 3 rows", "the existing rows have no value") says "rows" too, as does the framework fact `RowsWithoutValue`. Changing only the statement errors would leave the CLI using two words; the CLI needs one family-blind word for them, chosen for all its texts at once.

## A plain field that becomes the discriminator, with a new variant's required field, has only by-hand routes

When a MongoDB contract makes an existing plain field the discriminator (`Task.type`) and adds a variant with a required field (`Bug.severity`), the documents that already hold `type: "bug"` become `Bug` documents with no `severity`. The apply stops at the validator change's document check. The stop gives only by-hand routes: an update in `mongosh`, or `checkDocuments: false` under `db migrate`. Nothing is lost.

What is missing: a statement route. `--backfill Bug.severity` is the natural one, but the CLI refuses it, because `Bug` has no counterpart in the origin contract and a new model is taken to have no existing rows. That holds for a new model, not for a new variant whose documents already exist under a field that becomes its discriminator. The CLI would need to accept `--backfill` for such a variant's field, and the MongoDB planner and runner would need to plan and advise it. Files: the refusal in `packages/1-framework/3-tooling/cli/src/control-api/statements/resolve-statements.ts` ("A new model has no existing rows to backfill"), the variant planning in `packages/3-targets/mongo/1-target/src/core/migrations/mongo-variant-planning.ts`, and the stop in `packages/3-targets/mongo/1-target/src/core/migrations/mongo-runner.ts` (`newVariantFieldsAdvice`, `fieldsTouched`).

## A discriminator backfill that set only the discriminator cannot be planned again to set the variant's field

On MongoDB, when a model gets its first discriminator (`Task.type`) and a new variant has a required field (`Bug.severity`), the stop says the update written for `--backfill Task.type` can also set `severity`. If the user's update sets only `type`, the backfill fills `type`, and the document check then stops on `severity`. Planning the migration again with an update that sets both fields does not help: the backfill's check and run select only the documents that lack `type`, so it finds none and is skipped. The stop's `mongosh` fix works, so nothing is lost.

What is missing: a way to fill the variant's field after the discriminator is filled, without going by hand. That is the statement route of the entry above (`--backfill Bug.severity` for a variant whose documents exist), or a backfill whose selection the user can widen. Files: `backfillTransform` in `packages/3-targets/mongo/1-target/src/core/migrations/mongo-data-transforms.ts`, which builds the check and run of a backfill, and `newVariantFieldsAdvice` in `packages/3-targets/mongo/1-target/src/core/migrations/mongo-runner.ts`.

## A MongoDB validator names no root model, so roots are matched by position

A collection that stores several root models gets a validator with one `anyOf` branch per root model, in name order, and no branch names its model. Code that compares two validators of the collection without the contracts matches roots by position: planning without an origin contract (type changes, the validator update's label) and the runner's advice after a failed document check (`fieldsTouched`). Roots of validators with different numbers of roots are no longer matched, so adding or removing a root model no longer compares one model's fields with another's. A change that keeps the number of roots can still pair the wrong roots: a root model renamed so that the name order changes (`Zebra` to `Aardvark` in a collection that also stores `Mole`), with or without `--rename`, or one root model removed and another added in the same plan. The rename is the more likely case, and with an origin contract it reaches the runner's advice. Nothing is lost: the validator change's document check runs before the validator is replaced.

What is missing: an identity for each root in the validator, such as a `title` naming the model on each `anyOf` branch. That changes the validator, and so the storage hash, of every contract with such a collection, which needs a migration and upgrade instructions. Files: `deriveCollectionValidators` in `packages/2-mongo-family/1-foundation/mongo-contract/src/derive-collection-validators.ts` and `validatorDocumentShapesOf` in `packages/2-mongo-family/1-foundation/mongo-contract/src/validator-shapes.ts`.

## The refusal that lists unanswered MongoDB changes pairs models by a narrower rule

`mongo-unanswered-changes.ts` has its own private `destinationModelOf`: a rename statement, else the same name. The planner's shared `destinationModelOf` in `mongo-statement-planning.ts` also pairs a model renamed without a statement with the only new model stored the same way. The private rule only chooses which renames a refusal offers, so the effect is small: a field removed from a model paired by storage gets no rename offer. Nothing is lost.

What is missing: the private function should call the shared one, or take another name. File: `packages/3-targets/mongo/1-target/src/core/migrations/mongo-unanswered-changes.ts`.

## A new member or model takes the storage of one the same change removes, with no question

On the SQL targets, origin `A = "a"`, `X = "x"` and destination `A = "b"`, `N = "x"`: the rows of `X` become rows of `N`, and nothing is asked. `valueChanges` in `packages/2-sql-family/9-family/src/core/migrations/enum-value-planning.ts` (lines 450–473) keeps a removed member when the destination still stores its value under another name (line 468), so no removal is planned for `X` and its rows stay as they are. The same holds for tables: when `Account` is removed and a new `Person` is stored in table `accounts`, no rename is planned (models are paired only by the same coordinate or a statement, `modelRenamesOf` in `packages/2-sql-family/9-family/src/core/migrations/storage-renames.ts`, line 110), and the storage diff keeps table `accounts` because both contracts name it, so the rows of `Account` become rows of `Person`.

This is a rename with no statement, paired by storage, which the design note and the spec's rule forbid; the spec already refuses the case where a model that keeps its name takes the storage of a removed one. It needs a decision: ask about `X` (or `Account`) as removed, so the new member or model starts empty unless a `--rename` says otherwise, or refuse it as a takeover. Either changes plans that today succeed with no question, so it needs an upgrade note.

**Decided (Will, 2026-11-19):** ask. The removed model or member is asked about as removed: `--delete` lets its rows go, and `--rename` to the new model or member keeps them. Not built yet; it is its own change with an upgrade note.

On MongoDB a removed root model and a new root model stored the same way are paired by storage (the rule of prisma/orm#31061). Such a pair gives no rename with no statement, but fills and type changes still match its fields by name. So when a field keeps its name and changes its stored name (`User { nick @map("n") }` to `Member { nick @map("nn") }`, both required by their validators), the plan removes `n` and asks about `User.nick`, plans no fill of `nn`, and the validator change's document check then stops the apply after `--delete User.nick` (round 4 probe Q1; with a field of another name stored as `nn`, a fill is planned). Asking about the removed model, as decided above, removes this case too.


## A rename statement for an enum value is refused where the same change without a statement is planned

`stillStoredRefusal` (`packages/2-sql-family/9-family/src/core/migrations/enum-value-planning.ts`, line 278, called at lines 590–593) refuses `--rename Role.A:Role.V` when the destination enum still stores the old value of `A` under another member. When that member is new, the rows that hold the old value belong to `A`, which the statement renames, so the refusal is not needed: origin `A = "a"`, destination `V = "v"` and a new `N = "a"` is refused, while origin `A = "a"`, destination `A = "v"` and a new `N = "a"` (the member keeps its name, no statement) is planned, with the rows rewritten to `"v"` and `N` starting with no rows. Statements are stricter than the contract change they describe. The check should skip a holder the origin enum does not have, as the freed-and-reused case of the stored-name spec does.

## Planning swaps, chains, takeovers and merges of tables and columns

**Found:** stored-name renames spec, 2026-11-18.

A table or column rename that no statement asks for is refused when it swaps or chains with another rename, takes a name the start schema has, or meets a statement that moves something into its old name (`storageRenameConflict` in `packages/2-sql-family/9-family/src/core/migrations/storage-renames.ts`). The meaning is settled; only the order is missing. SQL applies a migration in one transaction, so a chain could be ordered last name first and a swap could go through a temporary name, as enum value chains already are. Two models that move into one new table are planned as a drop and a create with questions. This is a gap, not a principle.

## A swap of identically shaped tables or columns plans nothing on `migration plan`

**Found:** stored-name renames, dispatch 5 (2026-11-18).

`migration plan` returns `noOp` when the origin and destination storage hashes are equal (`packages/1-framework/3-tooling/cli/src/control-api/operations/migration-plan.ts`, around line 754). Two models that swap tables of the same shape, or two fields that swap columns of the same type, leave the storage section unchanged, so `migration plan` writes nothing and the rows read as the other model's. `db update` refuses the same swap. MongoDB behaves the same way: two models that swap collections of the same shape, or two fields that swap stored names of the same type, keep the storage hash, so `migration plan` writes nothing, and a later `db update` refuses the swap, because the snapshot stored for that hash is the origin contract. The MongoDB refusal journeys (`test/integration/test/cli-journeys/stored-name-refusals.mongo.e2e.test.ts`) give the swapped models and fields different shapes for this reason. The same class as the enum entry above ("Members that trade stored values while the list of stored values stays the same"): a change to the domain part only. Fixing it is a framework CLI change.

**Direction (Will, 2026-11-19):** do not remove the shortcut. When the storage is identical, the change has two readings the contracts cannot tell apart: the rows should trade places, or the user is correcting two mappings that were the wrong way round, where "No changes detected" is right. The cause is that the contract cannot express which one the user means, and the expressivity of PSL is the means to solve it. Not scheduled. Until then the acceptable result is to ask the user what they meant; today `db update` refuses and `migration plan` plans nothing. Note the earlier decision this touches: stating a change in the contract source (`@@hint(was: ...)`) was shelved, because the statement has to survive until every environment has consumed it (`design-notes.md`, "Why not the contract source"). A design here has to answer that. A CLI command that edits the contract source and then plans was considered and not wanted: `--rename` already states the change, and editing the source belongs to the editor.

## After `--rename Bug:Defect` is refused for shared storage, the next question offers it again

**Found:** stored-name renames, dispatch 5 (2026-11-18).

A variant stored in its base's table that gets a table of its own under a new name: `--rename Bug:Defect` is refused, since it would move the whole table, and the advice says to leave it out. The plan without it asks about `Bug` and offers `--rename Bug:Defect` first again, which is refused again. The question should not offer a rename the planner refuses. Files: the question offers in `packages/1-framework/3-tooling/cli/src/control-api/statements/plan-questions.ts`.

## The statement planner's names say "statement" for renames no statement asks for

**Found:** stored-name renames, final system design review (2026-11-18).

`planStatements`, `PlannedStatements`, `StatementPlanner` and `StatementPlanningTarget` in `packages/2-sql-family/9-family/src/core/migrations/statement-planning.ts`, and their test files `statement-planning*.test.ts`, now also plan the table and column renames of models and fields that keep their names, which no statement asks for. Their names still say "statement", so a reader looking for the code that renames a table when only `@@map` changes will not look there. Renaming them is a wide change to names that exist on `main`, called by both SQL target planners, and needs names chosen by the operator.

## A statement that names storage

**Found:** stored-name renames decision, 2026-11-18. Recorded in [`storage-naming.md`](./storage-naming.md).

Still needed for a plan with no origin contract and for storage the contract does not model. If built, use a `storage/` prefix, as in `--rename storage/users.name:users.full_name`.

## MySQL rename operations

**Found:** stored-name renames spec, 2026-11-18.

The MySQL target has no rename operation and refuses every statement, so a changed `@@map` or `@map` there is a drop and a create with by-hand advice. It belongs to the MySQL proof of concept. When MySQL calls the family's rename planning, it gets the rule with no further work.

## Renaming a PostgreSQL native enum type and a sequence owned by a renamed table

**Found:** stored-name renames spec, 2026-11-18.

No operation renames a native enum type, so a native enum type whose `@@map` changes is planned as before (ADR 286). A sequence owned by a renamed table keeps its old name.

## A stored-name change on storage that is not `managed`

**Found:** stored-name renames design review, 2026-11-18.

No pair is made when the control policy is not `managed` on both sides, so the plan is what the storage diff makes of the change under that policy, with `keepTableAdvice` on a drop. What it should plan for each policy (`external`, `observed`, a change of policy between the contracts) is not decided.

## `KeepDataEdit.swapsValues` and the transitional case check

**Found:** stored-name renames spec, 2026-11-18.

- `KeepDataEdit.swapsValues` (`packages/1-framework/1-core/framework-components/src/control/migration-statements.ts`, line 196) is a framework type that nothing sets now. The CLI code that read it (`twoRuns` in `packages/1-framework/3-tooling/cli/src/utils/keep-data-edit-advice.ts`, `sharesValueWithKeptMember` and the kept-member branch of `keepsDataByCommand` in `packages/1-framework/3-tooling/cli/src/control-api/statements/plan-questions.ts`) was removed with the MongoDB stored-name renames, because no target asks about an enum member the destination keeps. Removing the field is a framework interface change.
- Reading the callers for that removal found more that no target reaches. `MigrationDataLoss.keepDataEdit` (same file, line 188) is set by no planner: the only `KeepDataEdit` values come from the runners' apply-time `RowsHoldingValue.keepDataEdit`, which `runner-failure-advice.ts` prints and which never reaches the plan questions. So in `plan-questions.ts` the edits are always empty, `keepsDataByCommand` is always false, and `migrationPlanKeepDataEditAdvice` and `dbUpdateKeepDataEditAdvice` (`keep-data-edit-advice.ts`), with `keptSubjects` and `KeepDataEditAdvice`, are never called. Removing them together with `MigrationDataLoss.keepDataEdit` is a framework interface change; keeping them is right only if a planner is expected to give such edits again.
- `MIGRATION.TABLE_NAME_CASE_CHANGED` (`packages/2-sql-family/9-family/src/core/migrations/table-name-case-guard.ts`) is in practice reached only without an origin contract now. Remove it once no supported upgrade path reaches the lowering rule.

## SQLite operation labels do not quote names

**Found:** stored-name renames manual QA, 2026-11-18.

PostgreSQL labels a table rename `Rename table "Shop Front" to "Store Front"`, and SQLite labels the same rename `Rename table Shop Front to Store Front`; column renames are `Rename column "users"."x" to "y"` against `Rename column x on users to y`. A name with a space or punctuation is hard to read in the SQLite label, and docs that quote a label have to name the target. The same holds inside questions: manual QA on 2026-11-23 met "Recreate table user would lose the values of field "User.name".", while a dropped table is quoted (`Drop table "comment"`). The SQLite labels are set in `packages/3-targets/sqlite/1-target/src/core/migrations/op-factory-call.ts` (`RenameTableCall`, `RenameColumnCall` and the other calls) and predate the stored-name renames. Quoting them changes the expected labels in about twenty test and journey files across the SQLite target and adapter packages and `test/integration`, so it was left out of that pull request. Quote every SQLite label as PostgreSQL does, in one pass over all calls.

## Three texts the stored-name renames QA found outside its scope

**Found:** stored-name renames manual QA, 2026-11-18.

- **`CLI.CONSENT_UNUSED` for a statement a stored-name change no longer needs.** `prisma migration plan --name move --from <latest> --delete Shop`, where only `@@map` of `Shop` changed, prints `✘ [CLI.CONSENT_UNUSED] --delete Shop was given but nothing in this run asked about Shop.` and `→ Remove the flag, or spell the subject the way the command names it.` The second half points the user at how the subject is written, which is not the cause: the model keeps its name, so the plan renames its table and asks nothing. The text should say that nothing asked about the subject and to remove the flag, and leave out the advice about how it is written when the subject is a model or field of the contract. Manual QA on 2026-11-23 met the same text for a mistyped `--delete Nope.field`, where the advice about how the subject is written does fit; that the typo is reported only after planning is recorded under "A mistyped `--delete` subject is reported only after planning, as a flag that answers no question".
- **Model names carry `public.` in refusals.** On PostgreSQL, refusals name models with their namespace, as in `The table of model "public.Cat" changes from "cats" to "dogs", and the schema being planned from already has table "dogs", the table of model "public.Dog"`, while the statements a user types name the model as `Cat`. The namespace prefix of the default namespace should be left out, as statements leave it out.
- **The DDL preview leaves out value rewrites.** `prisma migration plan` for a change of an enum's stored value prints the operations `Drop check constraint "task_level_check_bc15f0e6" on "task"`, `Replace value 1 with 2 in column "level" of "task"` and `Add check constraint "task_level_check_1d419f4a" on "task"`, but its `DDL preview` lists only the two `ALTER TABLE … DROP CONSTRAINT` and `ADD CONSTRAINT` statements, not the `UPDATE` that rewrites the value. Manual QA on 2026-11-23 met the same fault on SQLite: the preview of a table rebuild shows `CREATE TABLE "_prisma_new_user"`, `DROP TABLE "user"` and the rename, but not the `INSERT … SELECT` that copies the rows, so it reads as if every row is dropped, though the data is kept. The preview should show every statement the migration runs, or say that it shows only DDL.

## No planner sets `leaveOut` any more

**Found:** stored-name renames, fixing the manual QA, 2026-11-18.

The SQL refusal for enum rename statements that move stored values in a cycle was the only conflict that set `leaveOut` (`MigrationPlannerConflict.leaveOut` in `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts`). Its route, a plan without the renames with the rewrites written by hand into its `migration.ts`, fails on PostgreSQL, where the check constraint that lists the enum's values rejects the value the rewrite goes through, so the refusal no longer offers it. The field, its JSON form in `packages/1-framework/1-core/errors/src/control.ts`, the next action that `planningRefusedError` (`packages/1-framework/3-tooling/cli/src/utils/planning-refused-error.ts`) builds from it, and the copy in `packages/2-sql-family/9-family/src/core/migrations/plan-helpers.ts` are now unused. Remove them, which changes the framework domain, or keep them for a target whose hand-written route does work. Two docs describe the field and change with it: `docs/architecture docs/subsystems/7. Migration System.md`, in the section "Rename statements", in the MongoDB entry on the check over ordered rewrites ("It carries no `leaveOut`"), and `docs/reference/error-reference.md`, in the entry for `MIGRATION.PLANNING_FAILED` ("it has no `leaveOut`, since one hand-written migration would meet the same re-run"). Both say that MongoDB sets none.

## An enum change inside a union, dictionary or self-containing value object has no route

**Found:** stored-name renames, final tip review, 2026-11-18.

On PostgreSQL and SQLite, removing an enum value, renaming it, or changing its stored value is refused when a column holds a value object whose member the enum types inside a union, a dictionary or a value object that contains itself, because the plan cannot list every path to the member. The refusal (`unlistedRefusal` in `packages/2-sql-family/9-family/src/core/migrations/enum-value-planning.ts`) now reads, for example: `Cannot remove enum value "Status.ARCHIVED": column "meta" of "ticket" holds a union of value objects`, with the reason `The plan rewrites an enum value inside JSON only in a column that holds a value object or a list of them. This change cannot be planned yet. Until it can, keep the members and stored values of enum "Status" as the origin contract has them, and plan again.`

On `main` this refusal said to write the change as a hand-written migration. That route is gone: on PostgreSQL the hand-written migration would also have to drop and add the check constraint of every scalar column the enum types, and the refusal cannot give their names. So a user now has no way to make this change at all.

A fix needs one of: a planner that rewrites the value at every JSON path a union, dictionary or self-containing value object can hold (for example with a recursive JSON rewrite in the target), or a refusal that gives a route the user can follow to the end, which on PostgreSQL means naming the check constraints the hand-written migration must replace and the names the destination contract expects for them. When the enum types only value object members and no scalar column, no check constraint is involved and the hand-written route may work as it did; the refusal would need to tell the two cases apart.

## On SQLite, db update drops and creates a table whose live name differs from the contract only in case

**Found:** stored-name renames, review of a reviewer's comment, 2026-11-19.

A SQLite database has table `USERS`, and both the origin and the destination contract store `User` in `users`. With no change at all, `db update` plans `Create table users` and `Drop table "USERS"`, and asks about `USERS` as storage. SQLite takes the two names for one, so the create fails at apply. The storage diff compares table names exactly, while SQLite's `SchemaTables` folds case. A column rename of a field of `User` on that table is not planned either, because `columnsNamed` reads the table by its exact name, but that changes nothing: the diff drops and creates the table anyway. The fix belongs in the SQLite storage diff, which should match a live table to the contract's as SQLite compares names, and then the column lookup should use the matched name. Not caused by the stored-name renames; seen on the branch, not checked on `main`.

## An enum stored-value change rewrites a column that a field of another enum also reads

**Found:** automated review of the stored-name renames pull request (2026-11-19). Not proven with a test.

`Bug` and `Feature` are variants stored in one table and both map a field to column `status`. `Bug.status` is typed by enum `Status` and `Feature.status` by enum `LegacyStatus`; both store `A = "a"`. The change gives `Status.A` the stored value `"b"`. `planEnumValueRewrites` (`packages/2-sql-family/9-family/src/core/migrations/enum-value-planning.ts`) finds column `status` through `Bug.status` and rewrites `"a"` to `"b"` in every row, including the rows of `Feature`, which then hold a value `LegacyStatus` does not list. A `--rename` of the member did the same before this slice; since this slice it also happens with no statement and no question. The contract is already inconsistent here: the column has one check constraint, built from one enum, and the PSL interpreter accepts a second variant field on the same column with no diagnostic.

It needs a decision: reject a column that fields of different enums share when the contract is written, refuse a stored-value change on such a column, or limit the rewrite to the variant's rows by its discriminator.

## On PostgreSQL a table rename fails when a table the plan drops holds the renamed constraint's new name

**Found:** automated review of the stored-name renames pull request (2026-11-20). Proven with a probe against PGlite, not kept as a test.

The origin stores `User` in `users` with primary key `users_pkey`; the destination stores it in `app_users`. The database also has a table the contract lacks, `stale`, with an index named `app_users_pkey`. The plan is: rename table `users` to `app_users`, rename `users_pkey` to `app_users_pkey`, drop table `stale`. The apply fails with `relation "app_users_pkey" already exists`, because the drop that frees the name runs last. Nothing is lost: the migration is rolled back. A `--rename` statement gave the same plan before this slice.

The constraint rename is a companion inside the `renameTable` call, and running `migration.ts` again rebuilds the companions inside `this.renameTable(...)`, so it cannot simply move later in the plan. Two fixes: run a drop of a table no rename touches before the renames, or write that companion as its own call after the drop. This is a second case of the limit recorded under "A SQLite column rename followed by a table rebuild builds the replacement index twice": operations carry no dependency information. Until then the user drops the stale table first.

## A rename and a backfill of the same value object field are rightly refused, with a misleading message

**Found:** manual QA on SQLite, 2026-11-23, run as a user who knows their models and fields. The run used `@prisma/cli-engine` 0.10.1; the problem holds with 0.10.2.

A value object field is renamed from `GeoPoint.lat` to `GeoPoint.latitude`, through `migration plan`. The first error offers both flags as alternatives: "If it is a field renamed, add --rename GeoPoint.lat:GeoPoint.latitude. Otherwise add --backfill …". Giving both fails with "The field "GeoPoint.latitude" is already required in the origin contract, so every existing value has it".

Refusing is right. `resolve-statements.ts` maps `latitude` back to `lat` through the rename, finds `lat` required in the origin contract, and refuses the backfill. After the rename every existing value has `latitude`, carrying the value of `lat`, so there is nothing to backfill. Only the wording is wrong: it names `GeoPoint.latitude` as if the origin contract had it and does not mention the rename. That wording falls short of the spec's requirement that such an error names "what was searched and what was found", because the origin contract has no `GeoPoint.latitude`. It should say that `--rename GeoPoint.lat:GeoPoint.latitude` keeps every value, so `--backfill GeoPoint.latitude` is not needed. Do not make the command accept both flags. "Statement errors say "rows" on MongoDB" quotes the same message, but only for its wording.

## The first error for a new required value object field differs by command

**Found:** manual QA on SQLite, 2026-11-23, run as a user who knows their models and fields. The run used `@prisma/cli-engine` 0.10.1; the problem holds with 0.10.2.

For a value object field renamed from `GeoPoint.lat` to `GeoPoint.latitude`, `migration plan` first fails with "Migration planning failed" about the new required field, while `db update`, and `migration plan` on a model field, ask the question at once. So the same change gives a different first error depending on the command and on whether the field is in a model or a value object. Why `migration plan` needs `--backfill` here is explained under "A value object field has no default, so `--backfill` has none to respect"; the different first error is the new problem.

## A rename with nothing to rename to is offered with `<new name>`

**Found:** manual QA on SQLite, 2026-11-23, run as a user who knows their models and fields. The run used `@prisma/cli-engine` 0.10.1; the problem holds with 0.10.2.

A removed model or value object field with nothing in the new contract to rename to is offered `--rename 'Comment:<new name>'` or `--rename 'GeoPoint.lng:GeoPoint.<new name>'`. The line cannot be run as printed, and run literally it fails with "has no field "<new name>"". No name the user fills in can work either, because the new contract has nothing new to rename to.

This breaks requirement 4 of the spec: "When a flag needs a new name that the user must choose, such as the new name of a renamed field, the error says so. The user copies a flag from the error, fills in any new name, and runs the command again." When nothing new exists, no new name the user fills in makes the printed rename run.

## The error suggests a rename target, while the spec says the command never guesses

**Found:** second-round review of the move to `@prisma/cli-engine` 0.10.2, 2026-11-23. This is an open question for Will, not a known defect.

When exactly one new field, enum value or value object field could be the target, the refusal and the question fill it into the rename flag, for example `--rename GeoPoint.lat:GeoPoint.latitude`. For a model this happens only when the removed model is a variant and its base gained exactly one new variant; an ordinary model always gets `<new name>`. In every other case they print `<new name>`. The code is `renameForm` in `packages/1-framework/3-tooling/cli/src/control-api/statements/plan-questions.ts`; the Migration System subsystem doc describes it too.

The spec says otherwise in four places. Its purpose says "The command never guesses what the user intended". Requirement 1 says "The planner never infers a rename, never asks whether a drop is one, and never reads intent from the contract." The second decision settled on 2026-10-05 says "There is no prompt that guesses whether a drop is a rename, and no detection of candidate pairs", and that "the rule is that nothing is guessed". The first non-goal says "no rename detection from matching columns or any other heuristic". Picking the only new field is a simple way to find a candidate pair.

On the other side: nothing is renamed or dropped unless the user gives the flag or answers the question. The suggestion only fills in text the user would otherwise type, and the command acts on it only when the user runs it.

Whether a suggestion printed in the error counts as guessing is undecided, and it is Will's to decide. If it does not, the spec's decision and non-goal need a dated amendment that says so. If it does, `renameForm` should always print `<new name>`.

## A question the run cannot ask still says "If you answer delete"

**Found:** manual QA on SQLite, 2026-11-23, run as a user who knows their models and fields. The run used `@prisma/cli-engine` 0.10.1; the problem holds with 0.10.2.

When the run cannot ask, the question still says "If you answer delete, the existing objects get a temporary value …". There is nothing to answer; it should say "If you choose --delete GeoPoint.lat, …". The text comes from `plan-questions.ts`.

## Value object locations are written as JSON paths and table names

**Found:** manual QA on SQLite, 2026-11-23, run as a user who knows their models and fields. The run used `@prisma/cli-engine` 0.10.1; the problem holds with 0.10.2.

Value object locations are written as JSON paths and table names, such as `at path "$[*]" in column "history" of "site"`, where the user knows `Site.history`; "of "site"" does not even say it is a table. The planning failure lists the same places in a different order from the question.

## A mistyped `--delete` subject is reported only after planning, as a flag that answers no question

**Found:** manual QA on SQLite, 2026-11-23, run as a user who knows their models and fields. The run used `@prisma/cli-engine` 0.10.1, whose first error said "--delete Nope.field does not name User.name."; the text quoted below is what 0.10.2 prints.

A mistyped `--delete Nope.field` is reported only as "--delete Nope.field answers no question; the questions are about User.name.". After the user adds the right flag and keeps the typo, a second error says "Remove the flag, or spell the subject the way the command names it." A mistyped `--rename` target, by contrast, is rejected at once with a clear reason. The wording of the second error is covered under "Three texts the stored-name renames QA found outside its scope".

The project's documents disagree about when this should be reported, and which one changes is undecided.

- Requirement 5 of the spec says a typo like this fails before planning: "A coordinate that does not resolve in the contract it must resolve in, a rename whose new name already exists in the origin, a statement the control policy forbids, or a rename and convert statement with no origin contract: each fails before anything is planned, naming what was searched and what was found." `Nope.field` resolves in neither contract.
- The Migration System subsystem doc (`docs/architecture docs/subsystems/7. Migration System.md`, the paragraphs "The questions." and "Questions before an apply.") and the error reference (`docs/reference/error-reference.md`, `CLI.CONSENT_UNUSED`) describe the current order as the design. The planner asks one question per thing the plan would lose, and "a `--delete` or `--allow` that answers no question fails with `CLI.CONSENT_UNUSED`; both happen before anything is written or applied", that is, after planning. The error reference gives "a mistyped name" as an example.
- The reason for that order: a `--delete` value can name a table no model stores, such as `--delete billing.audit_log`. Such a table is known only once the plan has found it, so `--delete` values cannot all be resolved before planning. Resolving every `--delete` value up front would break those deletes. A second reason is in the doc comment on `resolveStatements`: `--delete` must work when there is no origin contract, which the spec also decides, and then there is nothing to resolve a model or field name against before planning.

One way to reconcile them is to narrow the requirement so that `--delete` and `--allow` values are matched after planning. Another is to keep it and resolve before planning only `--delete` values written as a model or field name, leaving table names to be matched after planning, and only when an origin contract exists; then the subsystem doc and error reference need changing. Either way the first error should name the typo more clearly.

## On SQLite a removed field's question names the table rebuild, not the user's change

**Found:** manual QA on SQLite, 2026-11-23, run as a user who knows their models and fields. The run used `@prisma/cli-engine` 0.10.1; the problem holds with 0.10.2.

On SQLite a removed field's question starts "Recreate table user would lose the values of field "User.name".". Recreating the table is how SQLite makes the change, not what the user did; the question should name the user's change, the removed field. The missing quotes around `user` are covered under "SQLite operation labels do not quote names".

## Messages use project terms a user does not know

**Found:** manual QA on SQLite, 2026-11-23, run as a user who knows their models and fields. The run used `@prisma/cli-engine` 0.10.1; the problem holds with 0.10.2.

Messages use project terms a user does not know: "origin contract", "destination contract", "destination value object", "statement" (as in `Cannot resolve statement "--rename …"`), "postchecks already held", "contract space(s)", "self-emit", "attest the package". A user thinks of the old schema, the new schema and the `--rename` flag. The pass over the statement errors' wording asked for under "Statement errors say "rows" on MongoDB" should cover these terms too.

## After a SQLite table rebuild, the applied summary is ungrammatical and counts a step that does nothing

**Found:** manual QA on SQLite, 2026-11-23, run as a user who knows their models and fields. The run used `@prisma/cli-engine` 0.10.1; the problem holds with 0.10.2.

After `--delete User.name` on SQLite, both commands say "Applied 1 of 2 operation(s) …; the other 1 had nothing to do, since their postchecks already held". "the other 1 … their" is ungrammatical. The user is also shown a `Drop column "name" from "user"` step that does nothing, because the table recreate already removed the column; the DDL preview shows the same extra `DROP COLUMN "name"`. The text is in `applied-summary.ts`. "A SQLite column rename followed by a table rebuild builds the replacement index twice" is a similar extra step after a rebuild.

## After `db update`, the temporary-value warning says "instead" and names a hash

**Found:** manual QA on SQLite, 2026-11-23, run as a user who knows their models and fields. The run used `@prisma/cli-engine` 0.10.1; the problem holds with 0.10.2.

After `db update --delete User.name`, the warning about the temporary value says "To choose the value, plan a migration with prisma migration plan --from 33a42cee… --backfill User.displayName instead.". The update has already run, so "instead" comes too late, and the user does not know or easily check a 64-character hash. The text is in `migration-blocks.ts`.

## Whether to keep `--yes` when running the printed line again is not said

**Found:** manual QA on SQLite, 2026-11-23, run as a user who knows their models and fields. The run used `@prisma/cli-engine` 0.10.1, whose refusal under `--yes` said "You have to choose what happens, and --yes does not choose for you."; the problem holds with 0.10.2.

Under `--yes` the refusal now says "This command requires explicit consent for which --yes is not sufficient.", which is clear. A user may wonder whether to keep `--yes` when running the printed line again; keeping it works. Minor.

## In a terminal, `db update` prints each progress step twice

**Found:** manual QA on SQLite, 2026-11-23, run as a user who knows their models and fields. The run used `@prisma/cli-engine` 0.10.1; the problem holds with 0.10.2.

In a terminal, `db update` prints each progress step twice, as a `▸` line and then a `✔` line, so four lines come before the error. `migration plan` prints none.

## MongoDB: a variant that gains its own collection leaves its documents in the base's collection

**Found:** review of the MongoDB stored-name renames, step 1, 2026-11-24. This predates that work.

When a variant gains its own `@@map` (its storage is split from its base's collection), the plan creates the new collection and moves nothing. The variant's documents stay in the base's collection and are read as the other models' documents there, and no question is asked, because the variant's discriminator value does not change (`packages/3-targets/mongo/1-target/src/core/migrations/mongo-variant-planning.ts:198`, `if (to === from) return undefined`) and the collection diff (`mongo-planner.ts:366`, `planCollectionDiff`) only creates the new collection. A plan that drops no collection has no question to attach advice to. Moving them is a data migration; the plan should at least ask about the documents left behind. The PSL interpreter refuses a variant whose `@@map` differs from its base's (`PSL_MONGO_VARIANT_SEPARATE_COLLECTION`), so a PSL contract does not reach this; whether a TypeScript contract does was not checked.

## SQL has no "Add --rename A:B" hint for a field statement whose model's name and table both change

**Found:** review of the MongoDB stored-name renames, step 1, 2026-11-24.

On MongoDB, a field rename statement on a model whose name and collection both change, with no model statement, is refused with "Add --rename A:B before this statement, so the collection is renamed with its documents." (`packages/3-targets/mongo/1-target/src/core/migrations/mongo-statement-planning.ts`, `unrenamedCollectionWhy`). The SQL family gives the same-model text in that case, which says the plan does not rename the table and to leave out the statement, though adding the model statement is the fix. Give SQL the same hint.

## SQL: a dropped table shared by several models asks about one of them

**Found:** review of the MongoDB stored-name renames, step 2, 2026-11-24.

When a table that several models store their rows in is dropped (for example single-table variants of different bases, or a variant moving out while the base is removed), the SQL family names one model in the question: the root model if there is one, else the first model in declaration order (`packages/2-sql-family/9-family/src/core/migrations/operation-subjects.ts`, the `models.find(({ isRoot }) => isRoot) ?? models[0]` lookup in the subject of a dropped table). `--delete` on that model then drops rows of models never named. MongoDB now asks about every root model stored in a dropped collection. SQL should do the same where several root models share a table.

## MongoDB: `--rename` of a model that shares its collection has only a hand-written route

**Found:** MongoDB stored-name renames, journeys, 2026-11-24.

`--rename User:Member`, where `User` shares collection `users` with another root model and `Member` gets a collection of its own, is refused: a collection rename moves every document of the collection, and no discriminator tells the documents of the two models apart (`sharedCollectionRefusal` in `packages/3-targets/mongo/1-target/src/core/migrations/mongo-statement-planning.ts`, line 611). The advice is to leave out the statement, or to write the move as a hand-written migration. Before this work the rename moved the other model's documents too. Nothing is lost now, but there is no statement that moves one model's documents out of a shared collection; that is a data migration, which a plan does not write.

## MongoDB `db update` after a collection renamed by hand lists a field statement before a `@map` rename

**Found:** MongoDB stored-name renames, journeys, 2026-11-24.

After a collection is renamed by hand, `db update --rename User.name:User.fullName` together with a changed `@map` on `User.email` lists `Rename field name to fullName` before `Rename field email to mail`. The order is the order in which the field renames are collected in `planStatements` (`fieldRenameCalls` in `packages/3-targets/mongo/1-target/src/core/migrations/mongo-statement-planning.ts`, line 272): statements first, then stored-name changes. The two renames touch different keys, so both apply and nothing is lost; the order only differs from the order of the contract's fields. Seen in `test/integration/test/cli-journeys/stored-name-shared-collections.mongo.e2e.test.ts`, C3.

## The route and refusal text of stored-name renames is copied between the SQL family and the MongoDB target

**Found:** system design review of the MongoDB stored-name renames, 2026-11-24.

The refusals of swaps, chains, takeovers and shared storage, and their two-plan routes, are written twice, nearly word for word: in `packages/2-sql-family/9-family/src/core/migrations/storage-renames.ts`, `statement-planning.ts` and `enum-value-planning.ts`, and in `packages/3-targets/mongo/1-target/src/core/migrations/mongo-rename-conflicts.ts`, `mongo-statement-planning.ts` and `mongo-enum-value-planning.ts`. The copied pieces are `linkedChanges`, `temporaryNamesRoute`, `freeName`, `unused`, the `ORDER` sentence, the "both tables" / "both collections" text, `leaveOutShared` and the two-plan value route (`movesTwoPlans` on MongoDB). They cannot be shared: the only layer both may import is the framework domain (`@internal/utils` is in `packages/1-framework/0-foundation`, and `packages/0-shared` maps to the framework domain in `architecture.config.json`), which this work may not change. The cost is that the copies drift unless a change to one is made to both, and no test compares the two families' messages.

## `renameRefused` builds refusals that are not renames

**Found:** system design review of the MongoDB stored-name renames, 2026-11-24.

`renameRefused` builds a refusal with the statement that asked for it, or as a contract change the plan cannot make when none did. Both families also use it for refusals that are not renames: on MongoDB the discriminator `--convert` refusals (`refusedChange` in `mongo-variant-planning.ts`), the overlap refusals (`mongo-rewrite-overlaps.ts`) and the key and value rewrite refusals (`refusalOf` in `mongo-rewrite-refusals.ts`); on SQL the `--backfill` refusals. A name such as `planRefusal` would say what it does. Rename it in both families in one change, so they stay alike.

## MongoDB `FieldChange` is one rename, where SQL's `ColumnChange` groups renames

**Found:** system design review of the MongoDB stored-name renames, 2026-11-24.

When several root models of a shared collection rename one field to the same new name, MongoDB plans one `$rename` by merging equal calls (`sameFieldRename` in `mongo-statement-planning.ts`), and each model's `FieldChange` is checked on its own. SQL groups them in one `ColumnChange` with `renames`. The result is the same today; grouping would make the type say it.

## A boolean enum with a `false` member cannot be emitted

**Found:** MongoDB stored-name renames, round 2 fixes, 2026-11-24.

`enumType('Flag', type.Boolean(), member('YES', true), member('NO', false))` in a MongoDB TypeScript contract fails `contract emit` with `CONTRACT.VALIDATION_FAILED`: "domain.namespaces.__unbound__.enum.Flag.members[1].value must be … (was missing)". The contract canonicalization omits default values, and it treats every `false` as one (`isDefaultValue` in `packages/1-framework/0-foundation/contract/src/canonicalization.ts`, around line 83), so the member's `value: false` is dropped. PSL cannot write a boolean enum at all. So no user contract reaches the boolean enum refusals today, and no CLI journey can show them; planner tests cover them. Fixing it is a framework change: keep `false` under enum members.

## MongoDB renames are passed as several values, where SQL passes one `StorageRenames`

**Found:** system design reviews of the MongoDB stored-name renames, rounds 1 and 2, 2026-11-24.

The SQL family builds one `StorageRenames` (models, fields, table changes, column changes) and every later step reads it. The MongoDB planner threads the same facts as several values: `statements`, `models`, `collections` (`CollectionRenames`), `fieldRenames`, `fieldRenameCalls` and `renamedCollections` (`planStatements` in `packages/3-targets/mongo/1-target/src/core/migrations/mongo-statement-planning.ts`, and `mongo-planner.ts`). Model pairing now has one function (`modelPairOf`, which says whether a statement, the same coordinate or the same storage paired a model, and `givesRenamesWithNoStatement`, which says whether that pair gives renames no statement asks for), so the planner does not disagree with itself. It lives in `mongo-statement-planning.ts`, while `modelRenamesOf` and `CollectionRenames` are in `mongo-storage-renames.ts`; SQL keeps all of its pairing in `storage-renames.ts`. Moving it there is part of the larger change. Two related left-overs:

- `planStatements` builds one `ModelMatchInput`, `pairing`, with `fieldRenames: []`, and four steps read it: `embedRelationRefusals`, `unstatedFieldRenamesOf`, the `sharesCollection` check of field renames and the `removes` check of takeover routes. They run before the field renames they would hold exist. Removing the placeholder needs a model-pairing input without field renames, which is part of the larger change above.
- `plannedCollectionChanges` (`mongo-rename-conflicts.ts`) both decides which collection renames are planned and refuses the ones that cannot be, where SQL separates `plannedStorageRenames` from `storageRenameConflict`. The result is the same; the split would make each easier to read.

Neither was done in the stored-name renames pull request, since each touches most of the MongoDB planner's steps.

## A MongoDB root model that moves out of a shared collection starts empty, with no question

**Found:** MongoDB stored-name renames, review rounds 1 to 3, 2026-11-24. This predates that work.

`Admin` and `User` share collection `people`, and no discriminator tells their documents apart. When the destination stores `User` in a collection of its own (a changed `@@map`, or a rename statement left out), the plan creates the new collection and changes the validator of `people`, and asks nothing about the documents: `collectionDrops` in `packages/3-targets/mongo/1-target/src/core/migrations/mongo-planner.ts` asks only about collections the plan drops, and on `origin/main` the same. `User`'s documents stay in `people`, where `Admin` still reads them, and `User` starts with none. If `Admin`'s validator does not accept them, the validator change's document check stops the apply. When the moving model also changes a field's `@map`, the plan removes that key from the documents of `people` and asks about it (`Remove field user from collection people`), and when `Admin` holds the same key it refuses with "move the models to separate collections", which is what the change already does (round 3 probes Q3 and Q3b). A design for this case should cover both. The model that stays is planned as if the leaving model were gone: a `@map` change or an enum stored-value change of the staying model renames the key or replaces the value over every document of `people`, including those the leaving model left behind (round 5 probes R1 to R3), since only the models the destination stores in a collection count as sharing its documents. Removals, casts and fills of the staying model reach them the same way: with `Admin.status` removed while `User` moves out, the plan unsets `status` in `User`'s documents too, asked about only as `Admin.status` (round 7 probe P3; the same on `origin/main`). The stored-name renames spec defers this as a data migration ("a model leaving a shared collection"). Two attempts to ask about it were built and removed: a question needs an operation to attach to, which some plans do not have, and the framework has no kind of loss for data a plan leaves in place, so the question had to be answered with `--delete` although nothing was deleted. A fix needs a design, and may need a framework loss kind.

## The CLI engine's `CLI.CONSENT_UNUSED` text does not say why nothing asked

**Found:** manual QA of the MongoDB stored-name renames, round 1, 2026-11-24.

A script that passed `--delete User` for a `@@map` change, as it had to before, now gets `--delete User was given but nothing in this run asked about User.` with the hint "Remove the flag, or spell the subject the way the command names it." The second hint suggests a typo; the cause is that the change is now planned with no question. The text that reaches users is written by the CLI engine (repository prisma/prisma-cli); the ORM's own copy (`errorConsentUnused` in `packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts`) is used only for values the engine no longer holds, so changing it alone would make the two disagree. Change both together: say that the plan has no question about the subject, for example because the change is now planned with no question, before the spelling hint.

## MongoDB chain routes move every member through a temporary name

**Found:** manual QA of the MongoDB stored-name renames, round 1, 2026-11-24.

For a chain of collection renames (`users` to `accounts` while `accounts` moves to `members`), the two-plan route gives every collection in the chain a temporary name, though only the one that takes the name another frees needs one (`collectionRoute` and `fieldRoute` in `packages/3-targets/mongo/1-target/src/core/migrations/mongo-rename-conflicts.ts`, through `temporaryNamesRoute`). The route works; it is one step longer than needed. The SQL family's route (`storage-renames.ts`) does the same, so change both together. Enum chains already move only the member that needs a temporary value.

## A MongoDB time-series collection cannot be created from a contract

**Found:** manual QA of the MongoDB stored-name renames, round 4 (finding 14), 2026-11-24. It is on `main` too: the planner's `createCollection` options for a collection come from `schemaCollectionToCreateCollectionOptions` (`packages/3-targets/mongo/1-target/src/core/migrations/op-factory-call.ts`), which on `main` and on this branch gives a time-series collection both `timeseries` and the contract's validator.

On MongoDB 8.2.6 the first migration of a contract with a time-series model fails with `CLI.UNEXPECTED` and "'timeseries' is not allowed with 'validator'". Adding the validator afterwards fails too: `collMod` answers "option not supported on a time-series collection: validator". So no time-series collection can be created from a contract, and the time-series rename route, which creates the new collection, cannot be followed on that server. What is missing: the contract or the planner leaves the validator out for a time-series collection (and the verifier expects none), and the server's refusal is reported as a structured error, not `CLI.UNEXPECTED`.

## The time-series rename route has no tested copy under migration plan

**Found:** MongoDB stored-name renames, whole-branch review round 9 and manual QA round 4, 2026-11-24. The route predates that work.

MongoDB cannot rename a time-series collection, so a rename statement for one is refused. Under `db update` the route is: create the new collection with the old one's time-series options, copy the documents, and run again with `--delete`. Under `migration plan` it is: plan with `--delete` and add a `dataTransform` that copies the documents right after the creation and before the drop. `$merge` cannot write into a time-series collection, so that copy cannot be the shared document-move steps, and no test follows it. It also cannot be followed on MongoDB 8.2.6 until a time-series collection can be created from a contract (the entry above).

