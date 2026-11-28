# Manual QA — stored-name renames on MongoDB, round 9

Date: 2026-11-25. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `6d12672109`. Script: `projects/migration-statements/slices/stored-name-renames/manual-qa-pr2.md`. Earlier round: `2026-11-25-qa-stored-names-mongo-round-8.md` in this folder.

Status: done. No document was lost, duplicated or put under the wrong model when the printed text was followed, with one exception in finding 31, where a hand-written update ran twice. Every round 8 move case passes again. Round 8 findings 28 and 29 are fixed. Two new warnings (findings 30, 31), no blockers.

## Setup

- Tree already built at the tip; no build run. MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 8 helpers reused (`setup.sh`, `c.sh`, `p.sh`, `q.sh`, `ins-move.mjs`, the `r8*-move.txt` snippets). Round 9 projects are `wip/qa-mongo/r9a`–`r9n`, `r9du`, `r9nu`; contracts `ctr/r9*.prisma`.
- To stop an apply, I inserted a document with a wrong type, bypassing validation.
- Helper slip: in my first `r9f` run, `ins-move.mjs` did not add imports to a multi-line import (as round 8 noted), `node migration.ts` failed, and I ran `db migrate` anyway with the plan's own ops.json, which dropped `users` with its documents. That is what the plan says it does after `--delete`; not a product issue. I rebuilt `r9f` and repeated it correctly.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1a | Target exists with a validator; stop at its validator, fix, re-run | `r9a` | ✅ |
| 1b | Target created, `name @map("full_name")`; rejected copy, fix, re-run | `r9b` | ✅ |
| 1c | `guests` renamed to `members` | `r9c` | ✅ |
| 1d | Variant route, two plans, with a stop and a late document | `r9d`, `r9du` | ✅; ⚠️ 30 |
| 1e | Two source collections, stop on the second copy | `r9e` | ✅ |
| 1f | Every model leaves the source collection, with a stop | `r9f` | ✅ |
| 1g | One move with two copies, then one delete | `r9g` | ✅ |
| 1h | Field rename collision after a copy | `r9h` | ✅ |
| 1i | Model left behind beside a merge | `r9i` | ✅ |
| 1j | Model left behind beside a variant that leaves | `r9j` | ✅ |
| 2 | Round 8 findings 28, 29 | `r9e`, `r9f`, `r9g`, `r9i` | ✅ |
| 3a | Bypass-validation refusal | read only | ✅ |
| 3b | Create onto an existing collection, after a copy | `r9k` | ✅ |
| 3c | Data-transform update failure, after a copy | `r9m` | ⚠️ 31 |
| 4 | Plain `@@map`, `@map`, enum value change, with `migration plan` and `db update` | `r9n`, `r9nu` | ✅ |

### 1. Move cases

- `r9a`: plan without `--rename User:Member`, move at the start, with bypass. A bad `User` (`name: 42`) stopped it at `validator.members.update`. Fixed it in `members` with the printed update command, re-ran. End: `users` `[{a@x, rank 3}]`; `members` U1, U2, G1, Bad once each. Next plan empty.
- `r9b`: "right after the creation of collection "members"", with `$set full_name`, no bypass. A bad `User` (`name: 7`) stopped the copy; U1 and U2 were already in `members`, as the text says. Fixed in `users`, re-ran: `3 of 4 operation(s)`. End: `members` U1, U2, Bad with `full_name`; `users` the `Admin`. Next plan empty.
- `r9c`: "right after the rename of collection "guests" to "members"", with bypass. `5 operation(s)`. End: `members` U1, U2, G1; `users` the `Admin`. Next plan empty.
- `r9d`: the full change refused with the variant route. First plan with `Feature` kept, move at the start. A bad `Note` (`body: 7`) stopped it at `validator.notes.update`. Fixed it in `notes`, added `note three` to `tasks`, re-ran: applied, and `note three` moved too. Second plan asked for `--delete Feature`; given, it deleted the feature. End: `tasks` the bug; `notes` all four notes and `jot`. Next plan empty. See finding 30 for the `db update` sentence.
- `r9e`: two source collections. A bad `Post` (`body: 9`) stopped the second copy after the first had run. Fixed in `posts`, re-ran: `6 of 8 operation(s)`. End: `users` the `Admin`; `members` U1, G1; `posts` the draft; `articles` p1 and the fixed one. Next plan empty.
- `r9f`: the plan asked about `User` and `Staff`; `--delete User --delete Staff` gave the drop. A bad `User` stopped it at the `members` validator after both copies; `users` was empty and still there. Fixed, re-ran: `4 of 7 operation(s)`. End: `users` dropped; `members` U1, G1, Bad; `crew` S1. Next plan empty.
- `r9g`: with field statements `--rename Member.name:Member.fullName --rename Crew.badge:Crew.tag`, the route prints a `$set` and an `$unset` per model. Without them it prints only the `$unset` and says it deletes the field; that is true. Two dataTransforms and one `$or` delete: `5 operation(s)`. End: `users` the `Admin`; `members` U1, U2 with `fullName`, S1 with `tag`, G1. Next plan empty.
- `r9h`: an `Admin` with both `level` and `rank` stopped `renameField` after the copy. The re-run sentence is true: the copy ran again over an emptied source. `4 of 5 operation(s)`. End: both admins with `rank`; `members` U1, G1. Next plan empty.
- `r9i`, `r9j`: the plan without statements asks only about `Clerk` (or `Bug`); the rename is refused again; `--delete` plans it; the apply stops at the `users` validator, as the text warns.

### 2. Round 8 findings

- 28 ✅. The last line no longer repeats an opening sentence. It is now only "Leave out … : the refusal of --rename User:Member says why, what that plan does, and how to keep the documents." See the wording notes.
- 29 ✅. The merge route now reads "rewrite the documents of model "User" into collection "members" and the documents of model "Clerk" into collection "guests" yourself". `Visitor` is no longer named.

### 3. Re-run sentences

- 3a, bypass refusal: not triggered. It needs a database user without the `bypassDocumentValidation` action, and the memory server runs without authentication. From the runner source, the message says to grant the action, then uses the same re-run sentence as the others, computed from the operations before the failing one. That is correct.
- 3b (`r9k`): I created `articles` by hand before the apply. The stop says "If articles holds nothing you need, drop it, then run the command again. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again." True: the `User` copy and delete had run; after I dropped `articles`, the re-run gave `7 of 8 operation(s)`. The copy ran again over an empty source. End state correct; next plan empty.
- 3c (`r9m`): a hand-written `rawUpdateMany` after the copy, which meets `$toInt("G1")`. The stop names the value, says documents already updated stay updated, and uses the re-run sentence. See finding 31.

### 4. Plain renames

`r9n`: `@@map("items")` → `things`, `title @map("t")` → `ttl` (indexed), enum value `"low"` → `"lo"` on a scalar and a list field. Nothing asked; 7 operations: rename collection, index dropped and recreated on `ttl`, field rename, two value replacements, validator. Documents read back correct; next plan empty. `r9nu`: the same with `db update`: `Applied 7 operation(s)`, same documents.

## Findings

### 30. ⚠️ The variant route's `db update` sentence gives the steps in the wrong order

Project `r9du`. Contract: `Task` with variants `Bug` and `Feature`, and root model `Note`, all in `tasks`. Change: `Note @@map("notes")`, `Feature` removed. `db update` refuses with the variant route, which ends: "Under db update, apply that change, then move the documents out of collection "tasks" by hand."

Following it: with `Feature` kept, `db update` stops at `validator.tasks.update`, because the `Note` documents are still in `tasks`:

```
✘ [MIGRATION.PRECHECK_FAILED] Operation validator.tasks.update stopped: 1 document in collection tasks does not fit the new validator
```

The documents must be moved first. After I moved them by hand, the next `db update` applied. Nothing is lost, and the stop's own text says "db update writes no migration.ts, so there fix the documents first". But the route's sentence, read as written, leads straight into that stop. It should say: move the documents out of `tasks` by hand, then apply the change with `db update`. Source: `mongo-variant-planning.ts`, the `firstMove` text.

### 31. ⚠️ A data-transform update that fails partway does not say it will run again over the documents it already changed

Project `r9m`. After the move, I added a dataTransform whose update is not safe to run twice:

```ts
rawUpdateMany("members", { nick: { $exists: true } }, [{ $set: { nick: { $concat: ["$nick", { $toString: { $toInt: "$nick" } }] } } }], { bypassDocumentValidation: true })
```

It changed `"7"` to `"77"`, then stopped at `"G1"`:

```
✘ [MIGRATION.EXECUTION_FAILED] Operation data_transform.number the guests failed: its update met a value MongoDB cannot convert
  why: … Documents it updated before that value stay updated. … Fix the update in the migration's migration.ts, run the file with node, then run the command again. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again. …
```

I did what it says: I fixed the conversion (`$convert` with `onError: 0`) and re-ran. The update ran again over `"77"`, giving `"7777"`. The other update-failure message already says to change the update "so its filter and update work on a re-run". This one does not, and its example of an operation that runs again is a copy, not the update that just failed. It should say that this update runs again over the documents it already changed, so its filter must skip them. Before this branch, `origin/main` printed the same message without the re-run sentence, so the gap is older than this change. The new sentence is true, but it does not cover this case.

## Wording preferences, not findings

- After the printed route, the last line ("Leave out … : the refusal of --rename User:Member says why, what that plan does, and how to keep the documents.") points to the text just above it in the same message, and does not say which statement it belongs to (`Post:Article`, `Staff:Crew`). It could be left out when the route is printed in the same output.
- In a two-model split refusal (`r9e`), the first paragraph names only the first model's case ("the documents of model "Admin" do not move…"), not the second's (`Draft`).
- `r9g` without field statements: the route's `$unset` deletes `name`. That is stated plainly, but it could also say to add `--rename Member.name:Member.fullName` to keep the values.

## Cleanup

MongoDB is stopped. Scratch projects and contracts stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
