# Manual QA — stored-name renames on MongoDB, round 2

Date: 2026-11-24. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `4506815242f6b8ee2e3507acd119d1d3ed764c4c`. Script: `projects/migration-statements/slices/stored-name-renames/manual-qa-pr2.md`. Round 1: `2026-11-24-qa-stored-names-mongo-round-1.md`.

Status: done. No document was lost, duplicated or moved to the wrong model. Round 1 findings 1, 3 and 6 are fixed; 5 is fixed for enums; 2 and 4 are unchanged. Two new warnings, no blockers: a stopped `migration.ts` cannot be run again when it creates a collection (finding 7), and the new variant refusal's advice loops when followed as written (finding 8).

## Setup

- `git status --short` was clean. `mise exec -- pnpm build` passed (all 105 tasks cached).
- MongoDB one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 1's helpers in `wip/qa-mongo/`, plus `c.sh` (emit the contract, then run the CLI) and `setup.sh` (new project, initial contract, plan and apply, insert documents). Round 2 projects are `wip/qa-mongo/r*`, contracts in `wip/qa-mongo/ctr/`.
- `origin/main` was not run. Where I say main behaves the same, I read it from `origin/main`'s source, as noted.

## Scenarios

| # | Scenario | Projects | Verdict |
| - | -------- | -------- | ------- |
| 1 | `@@map` change, both commands | `r1`, `r1u` | ✅ |
| 2 | Field `@map` on root and variant | `r2` | ✅ |
| 4 | `@@map` with type change, `--rename` and `--delete` | `r4` | ✅ |
| 5 | Stale `--delete User` (round 1 finding 4) | `r5` | ⚠️ finding 4, unchanged |
| 6 | Swaps and chains (round 1 findings 2, 3, 5) | `r6a`–`r6f` | ✅ fixed, except findings 2 and 5b |
| 8 | `--rename` on a shared collection (round 1 finding 1) | `r8`, `r8i`, `r8j` | ✅ route works; ⚠️ finding 7 when stopped |
| 9 | Hand rename, then `db update` with a field `@map` change | `r9` | ✅ |
| 12 | No origin snapshot (round 1 finding 6) | `r4x` | ✅ fixed |
| new | Variant delete or discriminator change while another root model moves out | `r10`, `r11`, `r11u`, `r12` | ⚠️ finding 8 |

### 1. `@@map` change

`users` → `app_users`, two documents, unique `email`. `migration plan` planned only `Rename collection users to app_users`; after `db migrate`: collections `["app_users"]`, both documents, indexes `_id_` and `email_1`; next plan "No changes detected". `db update` (`r1u`) applied the same single rename. ✅

### 2. Field `@map` on a root model and a variant

```text
├─ Rename field severity to level in collection tasks in documents whose type is "bug"
├─ Rename field title to heading in collection tasks
└─ Update validator on tasks (added: heading, level; removed: title, severity)
```

End: `{type:"bug", level:"high", heading:"crash"}`, `{type:"feature", effort:5, heading:"big"}`. Next plan empty. ✅

### 4. `@@map` with other changes

Without statements, the questions name `User.name` and `User.nick` and the renamed collection `app_users`. With `--rename User.name:User.fullName --delete User.nick`, the same five operations as round 1. End `{email, score: 3 (double), fullName: "Ada"}`. ✅

### 5. Stale `--delete User`

```text
✘ [CLI.CONSENT_UNUSED] --delete User was given but nothing in this run asked about User.
→ Remove the flag, or spell the subject the way the command names it.
```

Unchanged from round 1 (finding 4). The fixes brief says this text lives in the CLI engine, in another repository, and is to be recorded there. ⚠️

### 6. Swaps and chains

- **Field swap, different types** (`r6b`). The route now says the stored name:

  ```text
  → … Make the change in two plans: first give field "User.age" the stored name (@map) "prisma_swap_x" and field "User.first" the stored name (@map) "prisma_swap_y", stored names nothing uses, and plan and apply that; then give field "User.age" the stored name (@map) "x" and field "User.first" the stored name (@map) "y", and plan again.
  ```

  Followed with `migration plan` and `db migrate`: two renames, then two renames back. End `{x: 36, y: "Ada"}`, next plan empty. Round 1 finding 3 fixed. ✅
- **Enum swap** (`r6d`). The text now reads "move stored values in a cycle, "a" to "b" and "b" to "a", and a rewrite of one would overwrite the other before it is read", and suggests `"prisma_swap_1"` and `"prisma_swap_2"`. Followed: `[{level:"b", tags:["b","a"]}, {level:"a", tags:["a"]}]`, correct. Round 1 finding 5 (first point) fixed. ✅
- **Enum chain** (`r6e`): only `Level.A` goes through `"prisma_swap_1"`; `Level.B` gets `"c"` in the first plan. Fixed. ✅
- **Collection chain** (`r6f`): the route still moves both models through temporary collections. It works; round 1 finding 5 (second point) remains for collections only.
- **Collection swap** (`r6a`): refused with the route through `prisma_swap_users` / `prisma_swap_accounts`, as in round 1. ✅
- **Same-shape field swap** (`r6c`): `migration plan` still says "No changes detected". Round 1 finding 2, unchanged, documented as a known gap.

### 8. `--rename` on a shared collection

`User` (with `name`) and `Admin` (with `level`) share `users`; three documents. `User` becomes `Member @@map("members")`.

```text
$ prisma migration plan --name move --rename User:Member
✘ [MIGRATION.PLANNING_FAILED] Migration planning failed
  why: Cannot rename model "User" to "Member": collection "users" also stores model "Admin"
→ … With migration plan, keep the documents by moving them in the migration that plan writes: plan the change without this statement, and in the operations of the migration.ts it writes, before the validator change of collection "users", add a dataTransform whose run copies the documents of model "User" into collection "members", such as rawAggregate("users", [{ $match: <a filter that selects only those documents> }, { $merge: { into: "members" } }]), and a deleteDocuments({ collection: "users", filter: <the same filter> }); then run that migration.ts to emit its ops.json, and apply it with db migrate. This works only when a filter can tell those documents apart, such as a field only model "User" stores.
```

Followed with only what it says (`r8`): `migration plan --name move` planned `Create collection members` and `Update validator on users (removed: name)`. I added, before the `collMod`:

```ts
dataTransform('move User documents to members', {
  run: () => rawAggregate('users', [{ $match: { name: { $exists: true } } }, { $merge: { into: 'members' } }]),
}),
deleteDocuments({ collection: 'users', filter: { name: { $exists: true } } }),
```

The `dataTransform` signature came from the package's types; the text does not show it, but `name` plus `{ run }` is the obvious reading. `node migration.ts` emitted four operations; `db migrate` applied them. End: `users` holds the `Admin` document, `members` both `User` documents; next plan empty. Round 1 finding 1 fixed. ✅

Stopped part way (`r8i`): same migration, plus one document in `users` with `level: "not-int"` inserted with validation bypassed. `db migrate` ran the create, the move and the delete, then stopped at the validator with `MIGRATION.PRECHECK_FAILED`, ending "Once the documents are fixed, run the command again; operations that already ran are skipped." State then: `members` held both `User` documents, `users` held `Admin` and the bad document. I deleted the bad document, inserted a late `User` document `{email:"u3@x.com", name:"U3"}` into `users` (as an old application might), and ran `db migrate` again. It was refused at the first operation (finding 7). After I removed the `createCollection` from `migration.ts`, emitted it again and ran `db migrate`, it applied three operations: `members` held U1, U2 and U3 once each, `users` held only `Admin`. Running the move and the delete again lost and duplicated nothing. ⚠️ finding 7

### 9. Hand rename, then `db update`

Renamed `users` to `app_users` with the driver, then `@@map("app_users")` and `email @map("mail")`. `db update` applied the index drop, field rename, index create and validator; no collection operation. Both documents hold `mail`. Next `db update --dry-run`: no operations. ✅

### 12. No origin snapshot

`db update` project, `migrations/snapshots` moved away, then `@@map("users")` → `"app_users"`:

```text
       If it was renamed, keep its data instead: store the snapshot of the contract the database is at, then run this command again. A change of its stored name alone is then planned with no question; a change of its name is answered with --rename.
       …
       2. Run `prisma db update --advance-ref db --dry-run` (`db` is the name of the ref that tracks the database; give another ref name if you use one), …
       3. Put the new contract source back, run `prisma contract emit`, and run this command again with `--advance-ref db`.
```

Followed steps 1 to 3: the dry run planned no operations, the real run stored the snapshot, and step 3 renamed the collection with no question. Document kept. Round 1 finding 6 fixed. ✅

### New: variant change while another root model moves out

`Task` (base, `@@map("tasks")`, discriminator `type`) with variants `Bug` and `Feature`, and root model `Note` (`body`, `type String?`) also in `tasks`. Documents: one bug, one feature, `{body:"note one"}`, `{body:"note two", type:"feature"}`. Change: `Note @@map("notes")`, `Feature` removed.

When `Note` has no `type` field (`r10`), the plan only asks `--delete Feature`, and with it plans `Create collection notes`, `Delete the documents of collection tasks whose type is "feature"`, validator. Correct: no `Note` document can match. With `type` on `Note` (`r11`):

```text
$ prisma migration plan --name change
✘ [MIGRATION.PLANNING_FAILED] Migration planning failed
  why: Cannot delete the documents of variant "Feature": the documents of model "Note" in collection "tasks" can hold type "feature"
→ Collection "tasks" stores several models and no discriminator tells their documents apart, so deleting the documents with that value would delete the documents of "Note" too. A model that moves out of collection "tasks" leaves its documents in it, so the documents of model "Note" stay there: change only the documents of variant "Feature" after they are moved, with a hand-written migration under migration plan or by hand under db update, and plan this change again; or keep variant "Feature" in the contract.
```

Same with `--delete Feature`, on `db update`, and as "Cannot convert variant "Feature"" for a discriminator value change (`r12`). The refusal protects `note two`. Following its advice is finding 8. A two-plan route works under both commands: first move `Note` out and keep `Feature` (under `migration plan`, add the move to that `migration.ts` as scenario 8 says; under `db update`, move the documents by hand when the validator stops), then remove `Feature` with `--delete Feature`. End in both `r11` and `r11u`: `tasks` holds only the bug, `notes` holds both notes, including `note two` with `type: "feature"`. ⚠️

## Findings

Round 1 findings 1, 3 and 6 are fixed. Finding 5 is fixed for enums and remains for collection chains (the route still works). Findings 2 and 4 are unchanged, as the fixes brief planned.

### 7. ⚠️ A `migration.ts` that creates a collection cannot be run again after a later operation stops

Commands (`r8i`, the shared-collection route of scenario 8, with one document the new validator rejects):

```text
$ prisma db migrate
✘ [MIGRATION.PRECHECK_FAILED] Operation validator.users.update stopped: 1 document in collection users does not fit the new validator
  … Once the documents are fixed, run the command again; operations that already ran are skipped. The operations that ran before the failure stay applied.

(bad document deleted)
$ prisma db migrate
✘ [MIGRATION.PRECHECK_FAILED] Operation collection.members.create failed during precheck: collection members does not exist
  why: Before operation collection.members.create runs, it checks: collection members does not exist. That check failed: the database already has collection "members". The failed apply changed nothing.
→ The database has drifted from its migration history: it is not in the state the migrations before this one leave. See how it differs from the contract with `prisma db verify`, change the database or the migration so they agree, and run `prisma db migrate` again
```

The same happens with the plan exactly as written, without my edits (`r8j`). In `ops.json`, `collection.members.create` has an empty postcheck, so it is never skipped as already done. `prisma db verify` only says "Hash mismatch". The advice to "change the database … so they agree" invites dropping `members`, which at that point holds the only copy of the moved `User` documents. I got through by removing the `createCollection` from `migration.ts`, which only suits this one database: a fresh database applying that edited file would get `members` without its validator. `origin/main` has the same empty postcheck in `packages/3-targets/mongo/1-target/src/core/migrations/migration-factories.ts` (the branch does not change that file), so this is not a regression, but the new route makes a stop in that migration more likely: the refusal itself warns that the validator change can stop the apply.

### 8. ⚠️ The variant refusal's advice loops when followed as written

Commands (`r11u`, `db update` route): moved the `Note` documents into `notes` by hand, as the text says, then ran the command again:

```text
$ prisma db update --no-interactive --delete Feature
✘ [MIGRATION.PLANNING_FAILED] Migration planning failed
  why: Cannot delete the documents of variant "Feature": the documents of model "Note" in collection "tasks" can hold type "feature"
```

The refusal comes from the contracts, not from the documents, so moving the documents changes nothing. Under `migration plan` (`r11`), "a hand-written migration" means `prisma migration new`, which scaffolds an empty migration from the origin to the full new contract: the user must write every operation, including the variant delete the plan refused, and a later "plan this change again" is then empty. That is round 1 finding 1 again. "after they are moved" also reads as if "they" were the `Feature` documents.

The route that works is two plans: first move `Note` out with `Feature` kept (moving the documents in that plan's `migration.ts`, as scenario 8's text says, or by hand under `db update`), then remove or change `Feature`. Suggest the text says that, in that order, and leaves "keep variant Feature in the contract" as the first step, not as an alternative ending. `origin/main` refused this plan too, per the fixes brief; I did not compare its text.

## Cleanup

The MongoDB server is stopped. Scratch projects, contracts and logs stay under `wip/qa-mongo/` (gitignored); a moved-away snapshot and a removed scaffold are in `wip/qa-mongo/trash/`.
