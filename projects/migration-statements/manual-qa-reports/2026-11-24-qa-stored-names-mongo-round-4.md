# Manual QA — stored-name renames on MongoDB, round 4

Date: 2026-11-24. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `4f78b88f62`. Script: `projects/migration-statements/slices/stored-name-renames/manual-qa-pr2.md`. Earlier rounds: `-round-1.md`, `-round-2.md`, `-round-3.md` in this folder.

Status: done. No document was lost, duplicated or put under the wrong model in any run. Round 3 finding 9 is fixed: the text no longer says to remove a create, and the unedited `migration.ts` applies on a fresh database and on one with documents. New blocker: when the target collection already exists, the advice says to put the move at the start of the operations, and the apply then always fails (finding 11). Two wording warnings (findings 12, 13). A time-series contract cannot be applied at all on MongoDB 8.2.6 (finding 14, probably not from this branch).

## Setup

- `git status --short` clean. `mise exec -- pnpm build` passed (105 tasks, cached).
- MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 1–3 helpers in `wip/qa-mongo/` (`setup.sh`, `c.sh`, `p.sh`, `q.sh`, `edit-move.mjs`). Round 4 projects are `wip/qa-mongo/r4a`–`r4l`; new contracts `ctr/sx0`, `sx1`, `mv0`–`mv2`, `mx0`–`mx2`, `cv1`, `s1b`, `sw0`, `sw1`.
- To stop an apply inside the move, I inserted a document with a wrong type, bypassing validation (`name: 42` or `body: 7`), so the `$merge` into the new collection is rejected.
- `origin/main` was not run.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1a | `--rename` on a shared collection, new target collection | `r4a`, `r4b`, `r4c` | ✅ |
| 1b | Same, target collection already exists | `r4d` | 🛑 finding 11 |
| 1c | Variant route beside a model that moves out, new target | `r4e` | ✅ |
| 1d | Same, target collection already exists | `r4f` | 🛑 finding 11 |
| 2 | Plain create with a validator, stopped later, run again | `r4g` | ✅ |
| 3 | Collection made by hand with no validator | `r4h`, `r4i` | ✅ stops; ⚠️ finding 12 |
| 4 | Time-series rename text | `r4j` | ⚠️ finding 13; 🛑 finding 14 |
| 5 | Regression: scenarios 1, 6, 8 | `r4k`, `r4ku`, `r4l`, and item 1 | ✅ |

### 1a. Shared collection, new target

`User` (`name`) and `Admin` (`level`) share `users`; documents U1, U2, one `Admin`. `User` becomes `Member @@map("members")`.

```text
$ prisma migration plan --name move --rename User:Member
  why: Cannot rename model "User" to "Member": collection "users" also stores model "Admin"
→ … With migration plan, keep the documents by moving them in the migration that plan writes: plan the change without this statement, and in the operations of the migration.ts it writes, right after the creation of collection "members" and before any other operation on collection "users", add a dataTransform … and a deleteDocuments(…); then run that migration.ts to emit its ops.json, and apply it with db migrate. … If the apply stops, fix what stopped it and run db migrate again.
```

Planned without the statement (`Create collection members`, `Update validator on users`), added the move with filter `{ name: { $exists: true } }` right after the create, ran the file. Inserted a bad `User` document. `db migrate` stopped in the move:

```text
✘ [MIGRATION.EXECUTION_FAILED] Operation data_transform.move User documents to members failed: MongoDB error 121 (DocumentValidationFailure): Document failed validation
```

State: `members` held U1, U2; `users` held all four. I set the bad `name` to `"Bad"` and ran `db migrate` again, with no edit to `migration.ts`:

```text
✔ Applied 1 migration(s) (3 of 4 operation(s); the other 1 had nothing to do, since their postchecks already held) across 1 contract space(s)
```

End: `users` `[{a@x.com, level 3}]`; `members` U1, U2, Bad once each, with its validator. Next plan "No changes detected".

The same `migrations/` folder on a fresh database (`r4b`): all migrations applied, `members` has its validator. On a database at the first migration with documents P1 and an `Admin` (`r4c`): `Applied 1 migration(s) (4 operation(s))`, `members` holds P1 with its validator, `users` holds the `Admin`. Round 3 finding 9 is fixed. ✅

### 1b. Shared collection, target already exists

Same, plus model `Guest` (`nick`) already in `members`, with document G1. The text changes to say where to put the move, and warns about `Guest`:

```text
$ prisma migration plan --name move --rename User:Member
→ … model "Member" reads the documents of model "Guest" already stored in its collection, since no discriminator tells them apart. … plan the change without this statement, and at the start of the operations of the migration.ts it writes, before any other operation on collection "users", add a dataTransform … and a deleteDocuments(…) …
```

Plan without the statement: `Update validator on members (added: email, name)`, then `Update validator on users`. I put the move at the start, as the text says. `db migrate` fails on the first document, with no bad document present (finding 11). Nothing changed. With the move after the `members` validator update instead, a stop, a fix and a re-run work: `users` keeps the `Admin`, `members` holds U1, U2, G1, Bad once each; next plan empty. 🛑

### 1c. Variant route, new target

`Task` (discriminator `type`, variants `Bug`, `Feature`) and root model `Note` (`body`, `type String?`) in `tasks`. Change: `Note @@map("notes")`, `Feature` removed. The text now names the collection: "First move model "Note" to collection "notes", keep variant "Feature" as it is, and plan that with migration plan: … right after the creation of collection "notes" …".

Plan 1 (`Create collection notes`, `Update validator on tasks`), move of `{ body: { $exists: true } }` after the create, a bad `Note` document: stopped in the move with `notes` holding two notes. Fixed it, ran `db migrate` again: applied. Plan 2 asked `--delete Feature`, then deleted `type: "feature"` documents of `tasks`. End: `tasks` holds the bug only; `notes` holds `note one`, `note two` (with `type: "feature"`), `note three` once each. Next plan empty. ✅

### 1d. Variant route, target already exists

Same, plus model `Jot` (`text`) in `notes`. The text says "at the start of the operations". Plan 1 is `Update validator on notes`, then `Update validator on tasks`. With the move at the start, `db migrate` fails at once (finding 11). With the move after the `notes` validator update: stop, fix, re-run and plan 2 all work; `notes` ends with `note one`, `note two`, `jot`, `note three`; `tasks` with the bug. 🛑

### 2. Plain create, stopped later

`User` gains `age Int?`, new model `Post` in `posts`. One `User` document has `age: "old"`. `migration plan` planned `Create collection posts`, `Update validator on users`. `db migrate` stopped at the `users` precheck after `posts` was created with its validator. I fixed the document and ran it again:

```text
✔ Applied 1 migration(s) (1 of 2 operation(s); the other 1 had nothing to do, since their postchecks already held) across 1 contract space(s)
```

`posts` has its validator, `migration status` says "Up to date", next plan empty. ✅

### 3. Collection made by hand, no validator

Same plan as item 2. Before `db migrate`, I created `posts` by hand with one document.

```text
$ prisma db migrate
✘ [MIGRATION.PRECHECK_FAILED] Operation collection.posts.create failed during precheck: collection posts does not exist
  why: Before operation collection.posts.create runs, it checks: collection posts does not exist. That check failed: the database already has collection "posts". The failed apply changed nothing.
→ The database has drifted from its migration history: it is not in the state the migrations before this one leave. See how it differs from the contract with `prisma db verify`, change the database or the migration so they agree, and run `prisma db migrate` again
```

It stops before the create and changes nothing. The cause is clear. Following the advice is not (finding 12). Two fixes work: giving `posts` the contract's validator by hand with `collMod` (the create is then skipped, the document kept); or dropping `posts` (`r4i`), after which the create runs with the validator. ✅ for the behaviour, ⚠️ for the advice.

### 4. Time-series rename text

PSL has no time-series syntax, so `r4j` uses a TypeScript contract: model `Reading` in `readings`, `timeseries: { timeField: 'ts', granularity: 'hours' }`. Read with `migration plan --from <init hash>`.

Collection changes, model name kept:

```text
  why: Cannot rename collection "readings" to "sensor_readings": collection "readings" is a time-series collection
→ The collection of model "Reading" changes from "readings" to "sensor_readings", and MongoDB cannot rename a time-series collection. Keep the collection's name: store the models in "readings" (with @@map("readings") in PSL), then run this command again. To start the collection under its new name without its documents, remove the model in one change and add it back in a second.
```

Clear. ✅

`--rename Reading:Sample` with the new collection:

```text
  why: Cannot rename model "Reading" to "Sample": collection "readings" is a time-series collection
→ MongoDB cannot rename a time-series collection. Leave out this statement. To keep the documents, first create collection "sensor_readings" yourself with exactly the options the contract gives it, its validator included, and copy them into it; the plan then drops "readings" once --delete names the model. A migration that migration plan writes creates collection "sensor_readings" itself, and stops at that creation when the collection you made has other options.
```

Not clear enough (finding 13). ⚠️ Following it is not possible on MongoDB 8.2.6, because a time-series collection cannot have a validator (finding 14).

### 5. Regression

- Scenario 1 (`r4k`, `r4ku`): `@@map("users")` → `@@map("app_users")`. `migration plan` planned only `Rename collection users to app_users`; `db update` applied the same single rename. Both: `["app_users"]`, two documents, indexes `_id_` and `email_1`; next plan empty. ✅
- Scenario 6 (`r4l`): `User` and `Account` swap `users` and `accounts`. Refused with the `prisma_swap_users` / `prisma_swap_accounts` route; followed both plans: `users` holds the `Account` document, `accounts` the `User` document; next plan empty. ✅
- Scenario 8: covered by item 1a. Planned without the statement, the plan removed `User` and asked nothing, as the text says. ✅

## Findings

Round 3 finding 9 is fixed. Round 3 finding 10 (the wording of a list of two models) was not rechecked.

### 11. 🛑 When the target collection already exists, "at the start of the operations" makes every apply fail

Projects `r4d` (shared collection) and `r4f` (variant route). The target collection already stores another model, so its current validator accepts only that model's documents. The plan's first operation widens it (`Update validator on members (added: email, name)`). The text says to put the move before that:

```text
$ prisma migration plan --name move --rename User:Member
→ … at the start of the operations of the migration.ts it writes, before any other operation on collection "users", add a dataTransform …
```

With the move first, on a database with no bad documents:

```text
$ prisma db migrate
✘ [MIGRATION.EXECUTION_FAILED] Operation data_transform.move User documents to members failed: MongoDB error 121 (DocumentValidationFailure): Document failed validation
  why: Documents the update changed before the error stay changed. … Fix what MongoDB names; when it comes from the update, change the update in the migration's migration.ts …
```

This happens on every database, and the error does not point to the order. Nothing is lost. What works: put the move right after the update of the target collection's validator and before any operation on the source collection. Suggest the text says that ("right after the validator update of collection "members"") instead of "at the start".

### 12. ⚠️ The advice for a collection made by hand leads to a command that does not show the problem

Project `r4h`. The precheck message says to "See how it differs from the contract with `prisma db verify`". That command prints only:

```text
$ prisma db verify
✘ [CONTRACT.MARKER_MISMATCH] Hash mismatch
  why: Contract storageHash does not match database marker
→ Migrate database or re-sign if intentional
```

`db verify --schema-only` shows `missing: posts/validator` and suggests `prisma db update`, which is not what a `migration plan` user should run. Suggest the message names the two fixes that work: drop the collection if it holds nothing you need, or give it the options the contract sets (the create is then skipped).

### 13. ⚠️ The time-series `--rename` text mixes two commands and does not say where to find the options

Project `r4j`, the `--rename Reading:Sample` text in item 4. Problems for a reader:

- "the plan then drops "readings" once --delete names the model" does not say which command. The last sentence is about `migration plan`; the rest reads as `db update`.
- "exactly the options the contract gives it" does not say where to see them. They appear only in a plan's operation preview or `migration.ts`.
- For `migration plan`, the documents have to be copied by hand on every database. The shared collection route instead adds the copy to `migration.ts`, which works everywhere. Suggest the same here: plan with `--delete Reading`, and add the copy after the create, before the drop.

### 14. 🛑 A time-series collection with a validator cannot be created on MongoDB 8.2.6

Project `r4j`, first migration of a contract with one time-series model:

```text
$ prisma db migrate --verbose
✘ [CLI.UNEXPECTED] Unexpected error
  why: Unexpected error during migrate: r4j.readings: 'timeseries' is not allowed with 'validator'
```

The planned `createCollection('readings', { timeseries: …, validator: … })` is rejected. Adding the validator afterwards fails too: `collMod` gives "option not supported on a time-series collection: validator". So the advice in finding 13 to create the collection "its validator included" cannot be followed on this server. This is probably not from this branch (the create predates it), but I did not run `origin/main`. It is also reported as an unexpected error, not a structured one.

## Cleanup

MongoDB is stopped. Scratch projects and contracts stay under `wip/qa-mongo/` (gitignored); the "move at the start" version of the `r4d` migration is `wip/qa-mongo/r4d-move-start.ts`.
