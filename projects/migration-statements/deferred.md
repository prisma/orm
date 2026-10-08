# Deferred — Migration statements

Items found during delivery that are out of the current slice's scope. Each names where it came from and what would resolve it. Transient; migrated or dropped at close-out.

## A model that keeps its name but changes its table (`@@map`) has no statement

**Found:** slice 1, dispatch 4 review (2026-10-06).

A user keeps `model User` and changes `@@map("users")` to `@@map("app_users")`. The diff shows a dropped table and a created one, exactly like a rename, but there is no model rename to state: `--rename User:User` is unresolved because the new name already exists in the origin. In `migration plan` the user can write `this.renameTable({ table: 'users', to: 'app_users' })` by hand; in `db update` there is no way to avoid the drop and create. Slice 1 refuses a field statement on such a model with `statementRejected` (D4-1) so it never plans a column rename on a table the diff then drops.

**Options:** let a same-coordinate model statement (`--rename User:User`) mean "this model's storage was renamed"; or add a storage-level statement; or accept the hand-written route for this case. Decide with the operator before slice 2 writes the refusal text, because the refusal will otherwise suggest a `--rename` that cannot resolve.

**Decided 2026-10-07 by Will:** no statement for this case in this project. Slice 2's refusal keeps slice 1's manual steps for both commands. A statement that can name storage objects rather than models and fields is wanted later; Will floated `--rename table/users:app_users` as an illustration only, and the syntax needs a critical design discussion and a survey of established prior art before anything is chosen.

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

## SQLite `db update` cannot add a required field to a table that has rows

**Found:** slice 2, dispatch 5 (2026-10-08). Pre-existing, not caused by the refusal.

The Postgres planner has a temporary-default recipe for a required column added to a populated table under `db update`; SQLite has none, so the runner fails with `MIGRATION.RUNNER_FAILED` ("Cannot add a NOT NULL column with default value NULL"). The slice 2 SQLite journey adds the field to an empty table and says so. Resolving it means a SQLite temporary-default recipe or a table rebuild with a backfill; `--backfill` (slice 3) covers `migration plan`, not `db update`.

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

