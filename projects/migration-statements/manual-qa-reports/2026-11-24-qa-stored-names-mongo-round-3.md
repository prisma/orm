# Manual QA — stored-name renames on MongoDB, round 3

Date: 2026-11-24. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `ca597b3c2d19018e943e3abe6e23f63b1619b182`. Script: `projects/migration-statements/slices/stored-name-renames/manual-qa-pr2.md`. Earlier rounds: `2026-11-24-qa-stored-names-mongo-round-1.md`, `-round-2.md`.

Status: done. No document was lost, duplicated or moved to the wrong model. Round 2 finding 8 is fixed. Round 2 finding 7 is fixed on the database where the apply stopped, but the advice leaves a `migration.ts` that fails on every other database (finding 9, blocker). One small wording warning (finding 10). Scenarios 1, 3, 6, 9 and 10 show no regression.

## Setup

- `git status --short` was clean. `mise exec -- pnpm build` passed (105 tasks, all cached).
- MongoDB one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 1 and 2 helpers in `wip/qa-mongo/`, plus `edit-move.mjs` (adds the document move after the first `createCollection` in a `migration.ts`). Round 3 projects are `wip/qa-mongo/t*` and `wip/qa-mongo/q*`; new contracts `ctr/sh0`–`sh2`, `ctr/m0`–`m2`.
- `origin/main` was not run.

## Scenarios

| # | Scenario | Projects | Verdict |
| - | -------- | -------- | ------- |
| 8 | `--rename` on a shared collection, stop after the create (round 2 finding 7) | `t7`, `t7b`, `t7c` | 🛑 finding 9 |
| 8 | Same route with a field `@map` change and `--delete` of a field of the staying model | `t8` | ✅ |
| new | Variant delete while another root model moves out (round 2 finding 8) | `t11`, `t11u`, `t12` | ✅ fixed; ⚠️ finding 10 |
| 1 | `@@map` change, both commands | `q1`, `q1u` | ✅ |
| 3 | Enum stored value change | `q3` | ✅ |
| 6 | Collection swap and enum swap | `q6a`, `q6d` | ✅ |
| 9 | Hand rename, then `db update` with a field `@map` change | `q9` | ✅ |
| 10 | Both collections present, both fixes | `q10`, `q10b` | ✅ |

### 8. `--rename` on a shared collection, stopped after the create

`User` (`name`) and `Admin` (`level`) share `users`; documents U1, U2 and an `Admin`. `User` becomes `Member @@map("members")`.

```text
$ prisma migration plan --name move --rename User:Member
  why: Cannot rename model "User" to "Member": collection "users" also stores model "Admin"
→ … in the operations of the migration.ts it writes, right after the creation of collection "members" and before any other operation on collection "users", add a dataTransform whose run copies the documents of model "User" into collection "members", such as rawAggregate("users", [{ $match: <a filter that selects only those documents> }, { $merge: { into: "members" } }]), and a deleteDocuments({ collection: "users", filter: <the same filter> }); … If the apply stops after collection "members" is created, do not drop it, since it holds the moved documents: remove its creation from that migration.ts, run the file again, fix what stopped the apply, and run db migrate again.
```

Followed it (`t7`): planned without the statement (`Create collection members`, `Update validator on users`), added the move and delete with filter `{ name: { $exists: true } }` right after the create, ran the file. To make it stop after the create, I inserted a `User` document with `name: 42` (validation bypassed). `db migrate` stopped in the move:

```text
✘ [MIGRATION.EXECUTION_FAILED] Operation data_transform.move User documents to members failed: MongoDB error 121 (DocumentValidationFailure): Document failed validation
```

State: `members` held U1 and U2; `users` still held all four documents. As the text says, I removed the `createCollection`, ran the file, set the bad document's `name` to `"Bad"`, and ran `db migrate`: three operations applied. End: `users` holds only the `Admin`, `members` holds U1, U2 and Bad once each; next plan "No changes detected". On this database the route works.

On any other database the edited migration fails (finding 9). 🛑

### 8b. Same route with a field `@map` change and a `--delete` on the staying model

`Admin.email @map("mail")` and `Admin.level` removed, in the same change (`t8`). `migration plan --name move --delete Admin.level` planned `Create collection members`, `Rename field email to mail in collection users`, `Remove field level`, validator. I put the move right after the create, as the text says. `db migrate` applied six operations. End: `users` `[{mail:"a@x.com"}]`, `members` `[{email:"u1@x.com",name:"U1"}, {email:"u2@x.com",name:"U2"}]`; the `User` documents kept `email`, since they left before the rename. Next plan empty. ✅

### Variant delete while another root model moves out

`Task` (discriminator `type`, variants `Bug`, `Feature`) and root model `Note` (`body`, `type String?`) in `tasks`. Change: `Note @@map("notes")`, `Feature` removed.

```text
$ prisma migration plan --name change --delete Feature
  why: Cannot delete the documents of variant "Feature": the documents of model "Note" in collection "tasks" can hold type "feature"
→ … A model that moves out of collection "tasks" leaves its documents in it, so make the change in two plans: first move model "Note" to its new collection and keep variant "Feature" as it is, plan and apply that, and move the documents of model "Note" out of collection "tasks": in the migration.ts that migration plan writes, right after the creation of the new collection, or by hand under db update; then make the change to variant "Feature" and plan again. Or keep variant "Feature" in the contract.
```

- `migration plan` (`t11`): plan 1 with `Feature` kept, move of `{ body: { $exists: true } }` added after the create, applied. Plan 2 asked `--delete Feature`, then planned the delete of `type: "feature"` documents and the validator. End: `tasks` holds the bug only; `notes` holds `note one` and `note two` (with `type: "feature"`). Next plan empty. ✅
- `db update` (`t11u`): same refusal text. Plan 1 stopped at the `tasks` validator; I moved the `Note` documents by hand and ran again; it applied. Then `--delete Feature` applied. Same end state; dry run plans nothing. ✅
- Another root model that stays (`t12`, `Memo` with `text`, `type String?` in `tasks`): the advice covers both:

  ```text
  why: Cannot delete the documents of variant "Feature": the documents of model "Memo", "Note" in collection "tasks" can hold type "feature"
  → … To change only the documents of variant "Feature", move the models to separate collections, or keep variant "Feature" in the contract. Model "Note" also moves out of collection "tasks" but leaves its documents in it, so that move goes in a plan of its own before this change: …
  ```

  After moving `Note` as it says, the next plan names only `Memo` and keeps the first advice. No `Memo` or `Note` document was touched. ✅ (wording: finding 10)

### 1. `@@map` change

`users` → `app_users`, two documents, unique `email`. `migration plan` planned only the rename; after `db migrate`: `["app_users"]`, both documents, indexes `_id_` and `email_1`, next plan empty. `db update` (`q1u`): the same single rename. ✅

### 3. Enum stored value

`ARCHIVED "archived"` → `"retired"` on `status` and `tags`: two `Replace value` operations and the validator, nothing asked. `{status:"retired", tags:["retired","active","retired"]}`, other document unchanged. ✅

### 6. Swaps

Collection swap (`q6a`): refused with the `prisma_swap_users` / `prisma_swap_accounts` route; followed: `users` holds the `Account` document, `accounts` the `User` document, next plan empty. Enum swap (`q6d`): refused with the `"prisma_swap_1"` / `"prisma_swap_2"` route, same text as round 2. ✅

### 9. Hand rename, then `db update`

Renamed `users` to `app_users` with the driver, then `@@map("app_users")` and `email @map("mail")`. `db update` applied index drop, field rename, index create, validator; no collection operation. Both documents hold `mail`; next dry run plans nothing. ✅

### 10. Both collections present

Refusal text unchanged from round 1. Fix 1 (`q10`): merged the new `app_users` document into `users`, dropped `app_users`, ran again: one rename, three documents. Fix 2 (`q10b`): hand rename then a new `users`; dropped `users`, ran again: no operations, marker advanced, both documents in `app_users`. ✅

## Findings

Round 2 finding 8 is fixed. Round 2 finding 7 is replaced by finding 9.

### 9. 🛑 Following the "stops after the create" advice leaves a migration that fails on every other database

The text says to remove the creation of `members` from `migration.ts` and run the file again. That file is the migration that every other database (a teammate's, staging, production) will apply. Two checks with the edited `migration.ts` from `t7`:

Fresh database, no documents (`t7b`):

```text
$ prisma db migrate
✘ [MIGRATION.SCHEMA_VERIFY_FAILED] Schema verification found 1 issue(s)
  why: The schema check after apply found: missing: members. The operations that ran before the failure stay applied.
```

Database at the initial migration with documents P1 (`User`) and an `Admin` (`t7c`):

```text
$ prisma db migrate
✘ [MIGRATION.SCHEMA_VERIFY_FAILED] Schema verification found 1 issue(s)
  why: The schema check after apply found: missing: members/validator. The operations that ran before the failure stay applied.
```

There, `$merge` created `members` with no validator, moved P1 into it and deleted it from `users`. Running `db migrate` again gives the same error. Putting the `createCollection` back now fails its precheck, because `members` exists (round 2 finding 7). No document was lost, but that database is stuck and needs a hand-written `collMod`.

What works: after the apply succeeds on the stopped database, put the `createCollection` back in `migration.ts` and run the file again. I did this on `t7`: `migration status` said "Up to date" and `db migrate` did nothing; the same migrations applied cleanly on a fresh database (four operations, `members` with its validator). Suggest the text adds that step ("once db migrate succeeds, put the creation back and run the file again, so other databases still create the collection"), or that the create's postcheck lets a re-run skip it, which would make the edit unnecessary.

### 10. ⚠️ "the documents of model "Memo", "Note"" reads as one model with two names

Command (`t12`): `migration plan --name change --delete Feature` with two root models in `tasks`:

```text
why: Cannot delete the documents of variant "Feature": the documents of model "Memo", "Note" in collection "tasks" can hold type "feature"
```

Suggest "the documents of models "Memo" and "Note"". The same list appears in the advice ("would delete the documents of "Memo", "Note" too"). Wording only.

## Cleanup

The MongoDB server is stopped. Scratch projects, contracts and logs stay under `wip/qa-mongo/` (gitignored); the original and edited `t7` migration files are in `wip/qa-mongo/trash/`.
