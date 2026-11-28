# Manual QA — stored-name renames on MongoDB, round 5

Date: 2026-11-25. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `2f7169e2a0`. Script: `projects/migration-statements/slices/stored-name-renames/manual-qa-pr2.md`. Earlier round: `2026-11-24-qa-stored-names-mongo-round-4.md` in this folder.

Status: done. No document was lost, duplicated or put under the wrong model in any run. Round 4 finding 11 is fixed: with the target collection already there, the printed move (now with `bypassDocumentValidation: true`) applies, and a stop and re-run finish it. Round 4 findings 12 and 13 are fixed. Round 4 finding 14 still reproduces and is recorded in `deferred.md`. Four new wording warnings (findings 15–18), no blockers.

## Setup

- Tree already built at the tip; no build run. MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 1–4 helpers in `wip/qa-mongo/`. New helper `ins-move.mjs` pastes the printed move into `migration.ts` at the place the text names (the start, or after a named operation). Round 5 projects are `wip/qa-mongo/r5a`–`r5o`; contracts `ctr/r5*.prisma`.
- Each move was typed from the printed example: filter `{ name: { $exists: true } }` (or `body`), the printed `$set`/`$unset` stages, and the printed options.
- To stop an apply, I inserted a document with a wrong type, bypassing validation.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1 | Round 4 finding 11: target exists with a validator, the model that stays renames a field; stops and re-runs | `r5a`, `r5b`, `r5c`, `r5n` | ✅; ⚠️ finding 16 |
| 2a | Target created by the plan, moving model changes a stored name | `r5d`, `r5e` | ✅; ⚠️ finding 15 |
| 2b | Another collection renamed to the target's name (`guests` → `members`) | `r5f`, `r5g` | ✅ |
| 2c | Moving model becomes a variant in the target | `r5h` | ✅ |
| 3 | A rewrite on the target that would reach the moved documents | `r5i`, `r5o` | ✅; ⚠️ finding 18 |
| 4 | Variant route to the end, target exists and target new | `r5j`, `r5k` | ✅; ⚠️ finding 17 |
| 5 | Round 4 findings 12, 13 (and 14) | `r5l`, `r5m` | ✅ 12, ✅ 13; 🛑 14 unchanged, deferred |

### 1. Target exists with a validator (round 4 finding 11)

`User` (`email`, `name`) and `Admin` (`level`) share `users`; `Guest` (`nick`) is in `members`. Change: `User` becomes `Member @@map("members")`, and `Admin.level` gets `@map("rank")`. Documents U1, U2, one `Admin`, G1.

```text
$ prisma migration plan --name move --rename User:Member
→ … at the start of the operations of the migration.ts it writes, before any other operation on collection "users", add a dataTransform … such as rawAggregate("users", [{ $match: <…> }, { $merge: { into: "members" } }], { bypassDocumentValidation: true }), and a deleteDocuments(…) … The copy skips document validation because collection "members" still has its old validator; the later validator update on "members" checks the moved documents. If that check stops the apply, the moved documents are in collection "members": fix them there and run db migrate again. …
```

Planned without the statement: `Rename field level to rank in collection users`, `Update validator on members (added: email, name)`, `Update validator on users`. Put the move at the start, as printed, and ran the file.

- Stop at the target's validator (`r5a`, a `User` with `name: 42`): `validator.members.update stopped: 1 document in collection members does not fit the new validator`. State: `members` held U1, U2, G1 and the bad one; `users` held only the `Admin`, already as `rank: 3`. I fixed it with the printed mongosh `update … bypassDocumentValidation: true` command and ran `db migrate` again: `Applied 1 migration(s) (3 of 5 operation(s); the other 2 had nothing to do …)`. End: `users` `[{a@x, rank 3}]`; `members` U1, U2, G1, Bad once each, validator with both models. Next plan "Up to date"; status applied.
- Stop at the source's validator (`r5b`, same migrations, an `Admin` with `level: "x"`): stopped at `validator.users.update` after the move and delete had run. I fixed it and also added a new `User` document to `users` before the re-run. Re-run applied; the late document was moved too. End: `users` two admins, `members` U1, G1, Late. Next plan "No changes detected".
- Fresh empty database (`r5c`): `Applied 2 migration(s)`, `members` has the two-model validator.
- Copy without the printed option (`r5n`): fails with error 121 at the move, nothing lost (finding 16). ✅

### 2a. Target created, moving model changes a stored name

`r5d`: `Member.name @map("full_name")`, `members` new. The text says "right after the creation of collection "members"" and prints the stages `{"$set":{"full_name":"$name"}}, {"$unset":["name"]}`, with no bypass. Plan: `Create collection members`, `Update validator on users (removed: name)`. A bad `User` (`name: 7`) stopped the move with U1, U2 already in `members` as `full_name`. Fixed it in `users`, re-ran: applied. End: `members` U1, U2, Bad with `full_name` only; validator `_id, email, full_name`; `users` the `Admin`. Next plan empty. ✅

`r5e`: `Member.fullName`, stated as `--rename User:Member --rename Member.name:Member.fullName`. The route prints `{"$set":{"fullName":"$name"}}, {"$unset":["name"]}`. Correct, but see finding 15.

### 2b. Another collection renamed to the target's name

`r5f`: `Guest` was in `guests`, now `@@map("members")`. Text: "right after the rename of collection "guests" to "members"", with bypass. Plan: `Rename collection guests to members`, `Update validator on members`, `Update validator on users`. Move pasted after the rename: `Applied 1 migration(s) (5 operation(s))`. End: `members` U1, U2, G1; `users` the `Admin`. Next plan empty.

`r5g`: same migrations on a database with a bad `User`. Stopped at `validator.members.update` after the rename and the move; fixed in `members`, re-ran: `3 of 5 operation(s)`. End correct, nothing duplicated. ✅

### 2c. Moving model becomes a variant in the target

`r5h`: `members` holds root `Person` (discriminator `kind`) with variant `Guest`; `User` becomes `Member @@base(Person, "member")`. The text prints `{"$set":{"kind":{"$literal":"member"}}}` and the bypass, and says "model "Member" starts with no documents". Followed it: `Applied 1 migration(s) (4 operation(s))`. End: `members` U1, U2 with `kind: "member"`, G1 with `kind: "guest"`; `users` the `Admin`. Next plan empty. ✅

### 3. A rewrite on the target that reaches the moved documents

`r5i`: `Guest` also has `email`, and its stored name becomes `mail`.

```text
$ prisma migration plan --name move --rename User:Member
  why: Cannot rename model "User" to "Member": collection "users" also stores model "Admin"
       Cannot rename field "email" to "mail" in collection "members": model "Member" stores field "email" in the same collection, "members"
→ … Planned without this statement, the change is refused for another reason as well, which that refusal names.
→ The stored name of field "Guest.email" changes from "email" to "mail". … renaming the field would rename it in the documents of "Member" too. To change it, move the models to separate collections, or keep the stored name "email" in the contract.
```

No move is offered, and the reason is clear. A type change of `Guest.email` to `Int` is refused the same way ("Cannot cast field "email" of model "Guest" …"). A rewrite that cannot reach the moved documents (`Guest.nick @map("nickname")`) stays in the same plan with the move at the start; applied, `members` holds U1 and G1 with `nickname`, next plan empty. ✅ See finding 18.

### 4. Variant route to the end

`r5j` (target exists): `Task` (discriminator `type`, variants `Bug`, `Feature`) and root model `Note` share `tasks`; `Jot` is in `notes`. Change: `Note @@map("notes")`, `Feature` removed. The text says "at the start of the operations", with bypass. Plan 1 (contract with `Feature` kept): `Update validator on notes`, `Update validator on tasks`. A bad `Note` (`body: 7`) stopped it at `validator.notes.update`; fixed in `notes`, re-ran: `3 of 4 operation(s)`. Plan 2 asked for `--delete Feature`, then deleted the `type: "feature"` documents of `tasks`. End: `tasks` the bug only; `notes` `note one`, `note two` (with `type: "feature"`), `jot`, `note three` once each. Next plan empty. Round 4's failure here is fixed.

`r5k` (target new): "right after the creation of collection "notes"", no bypass. Both plans applied; `tasks` the bug, `notes` `note one`. ✅

### 5. Round 4 findings 12–14

Finding 12 (`r5l`, `posts` made by hand without a validator):

```text
✘ [MIGRATION.PRECHECK_FAILED] Operation collection.posts.create stopped: collection posts already exists without the options this migration creates it with
  why: If posts holds nothing you need, drop it, then run the command again. Otherwise give it the options the createCollection call of this migration's migration.ts sets, its validator among them, and run the command again: the creation is then skipped. The failed apply changed nothing.
```

I copied the options from `migration.ts` into a `collMod` and re-ran: `1 of 2 operation(s)`, the hand-made document kept. Fixed. ✅

Finding 13 (`r5m`, time-series `--rename Reading:Sample`):

```text
→ MongoDB cannot rename a time-series collection. Leave out this statement. With db update, first create collection "sensor_readings" yourself with the time-series options of collection "readings", which db.getCollectionInfos({ name: "readings" }) shows in mongosh, copy the documents into it, and run db update again with --delete naming the model, which drops "readings". With migration plan, plan with --delete naming the model; the migration.ts it writes creates collection "sensor_readings", and there add a dataTransform that copies the documents right after that creation and before the drop of collection "readings".
```

Each command has its own steps, and it says where the options are. Fixed. ✅

Finding 14 still reproduces: the first `db migrate` of a time-series contract fails with `CLI.UNEXPECTED` "'timeseries' is not allowed with 'validator'". It is on `main` too and is recorded in `deferred.md`. 🛑 (not this branch)

## Findings

Round 4 findings 11, 12 and 13 are fixed. Round 4 finding 14 is unchanged and deferred.

### 15. ⚠️ "Leave out this statement" does not say to leave out the field rename too

Project `r5e`. With `--rename User:Member --rename Member.name:Member.fullName`, the refusal says "Leave out this statement". Leaving out only the model statement gives:

```text
✘ [MIGRATION.STATEMENT_UNRESOLVED] Cannot resolve statement "--rename Member.name:Member.fullName"
  why: The destination model "Member" has no counterpart in the origin contract …
```

Planning with neither statement works, and the printed copy already writes `fullName`. Suggest the text says to leave out both, naming the field statement.

### 16. ⚠️ A failed copy is described as "the update", with no hint about validation

Projects `r5d`, `r5n`. When the move's `$merge` is rejected, the message says "Documents the update changed before the error stay changed … change the update in the migration's migration.ts". The move is a copy, not an update, and the message does not name the document or the collection whose validator rejected it. If a user leaves out the printed `bypassDocumentValidation: true` (as round 4's text had it), nothing points them to it. Also, the validator-check stop says "operations that already ran are skipped"; the move has no checks and runs again. That re-run did no harm in any run here, but the sentence is not true for it.

### 17. ⚠️ Route text is hard to read in places

- The variant route says "This assumes that first plan makes every change to collection "notes" that this plan makes." A reader cannot tell what to check.
- The stages are printed as JSON (`{"$set":{"full_name":"$name"}}`) inside otherwise JavaScript-style code (`{ $match: … }`, `{ $merge: { into: "members" } }`).
- The whole route is one paragraph of about 250 words. Numbered steps would be easier to follow.

### 18. ⚠️ The target-rewrite refusal leaves out the easy way

Project `r5o`. Section 3's refusal suggests separate collections or keeping the stored name. Renaming `Guest.email` to `mail` in a migration before the move works: plan 1 renames the field while `members` holds only `Guest`, plan 2 moves the documents. Both applied; `members` ended with U1 (`email`) and G1 (`mail`). Suggest the text offers that order.

## Cleanup

MongoDB is stopped. Scratch projects and contracts stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
