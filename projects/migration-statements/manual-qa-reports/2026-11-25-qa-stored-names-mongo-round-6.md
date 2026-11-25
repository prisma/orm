# Manual QA — stored-name renames on MongoDB, round 6

Date: 2026-11-25. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `50fe1f36d5`. Script: `projects/migration-statements/slices/stored-name-renames/manual-qa-pr2.md`. Earlier round: `2026-11-25-qa-stored-names-mongo-round-5.md` in this folder.

Status: done. No document was lost, duplicated or put under the wrong model in any run. Every move case from round 5 still passes. Round 5 findings 15 and 18 are fixed, 16 is mostly fixed, and 17 is partly fixed. All new cases pass when the printed text is followed. Five new wording warnings (findings 19–23), no blockers.

## Setup

- Tree already built at the tip; no build run. MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 5 helpers reused (`setup.sh`, `c.sh`, `p.sh`, `q.sh`, `ins-move.mjs`). Round 6 projects are `wip/qa-mongo/r6a`–`r6o`; new contracts `ctr/r6*.prisma`. Older, unrelated `r6*` folders were moved to `wip/qa-mongo/trash/old-r6/`.
- Each move was typed from the printed example, with a filter on a field only the moving model stores. To stop an apply, I inserted a document with a wrong type, bypassing validation.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1a | Target exists with a validator; stop at the target's validator, fix, re-run | `r6a` | ✅ |
| 1b | Target created; moving model changes a stored name (`@map`, and a renamed field) | `r6b`, `r6c` | ✅; ⚠️ 19, 21 |
| 1c | `guests` renamed to `members` | `r6d` | ✅ |
| 1d | Moving model becomes a variant | `r6f` | ✅ |
| 1e | Variant route, two plans, with a stop and a late document | `r6e` | ✅ |
| 2 | Round 5 findings 15–18 | `r6c`, `r6a`, `r6n`, `r6e`, `r6g` | ✅ 15, ✅ 18; 16 mostly; 17 partly |
| 3a | Two models leave one collection for two collections | `r6h` | ✅; ⚠️ 20 |
| 3b | Moving model drops a field | `r6i` | ✅; ⚠️ 23 |
| 3c | A fill or a cast on the target blocks the move | `r6j`, `r6k`, `r6l` | ✅; ⚠️ 22 |
| 3d | Field statement whose model rename is refused | `r6c`, `r6m` | ✅ when followed; ⚠️ 19 |
| 4 | A copy the target validator rejects | `r6n`, `r6b`, `r6o` | ✅; ⚠️ 21 |

### 1. Round 5 move cases

- `r6a` (`User` → `Member @@map("members")`, `Admin.level @map("rank")`, `Guest` already in `members`): the text says to add the move at the start, with `{ bypassDocumentValidation: true }`. A bad `User` (`name: 42`) stopped it at `validator.members.update`. I fixed it with the printed mongosh command and re-ran. End: `users` `[{a@x, rank 3}]`; `members` U1, U2, G1, Bad once each. Next plan "No changes detected".
- `r6b` (`members` new, `name @map("full_name")`): "right after the creation of collection "members"", no bypass, stages `{ $set: { full_name: "$name" } }, { $unset: ["name"] }`. A bad `User` (`name: 7`) stopped the copy (see section 4). I fixed it in `users` and re-ran: `3 of 4 operation(s)`. End: `members` U1, U2, Bad with `full_name` only; `users` the `Admin`. Next plan empty.
- `r6c` (`--rename User:Member --rename Member.name:Member.fullName`): the text now says to leave out both statements (finding 19). Planned with neither, pasted the move: `4 operation(s)`; `members` U1, U2 with `fullName`. Next plan empty.
- `r6d` (`guests` → `members`): "right after the rename of collection "guests" to "members"", with bypass. `5 operation(s)`. End: `members` U1, U2, G1; `users` the `Admin`. Next plan empty.
- `r6f` (`User` becomes `Member @@base(Person, "member")`): stage `{ $set: { kind: { $literal: "member" } } }`, with bypass. End: U1, U2 with `kind: "member"`, G1 `kind: "guest"`. Next plan empty.
- `r6e` (variant route: `Note` leaves `tasks` for `notes`, `Feature` removed): first plan with `Feature` kept, move at the start. A bad `Note` (`body: 7`) stopped it at `validator.notes.update`. I fixed it in `notes`, added `note three` to `tasks`, and re-ran: applied, and `note three` was moved too. Second plan asked for `--delete Feature`, then deleted the feature document. End: `tasks` the bug only; `notes` `note one`, `jot`, `note two`, `note three`. Next plan empty.

### 2. Round 5 findings 15–18

- 15 ✅. The refusal now says "Leave out --rename User:Member and --rename User.name:Member.fullName", and the field statement's own line says "That refusal names the statements to leave out, this one among them". Leaving out both works. But see finding 19.
- 16, mostly ✅. A rejected copy now reads "the validator of collection members rejected a document the copy wrote", says the copy runs again on a re-run, and gives one piece of advice that fits the migration (section 4). Still there: the validator-check stop in `r6a` ends "operations that already ran are skipped", which is not true of the move. It did no harm.
- 17, partly ✅. Stages are now printed in the same JavaScript style as the rest. The variant route's unclear sentence now reads "Write that first contract as this one with variant "Feature" kept: these steps expect its plan to change collection "notes" as this plan does." Clearer, but it comes after the steps it qualifies. The route is still one paragraph (about 330 words for one move, 600 for two).
- 18 ✅. The target-rewrite refusal (`r6g`) now ends "Or make the change in an earlier migration, before model "Member" is added to collection "members"." Followed: plan 1 renamed `Guest.email` to `mail`, plan 2 moved the documents. End: `members` U1 (`email`), G1 (`mail`). Next plan empty.

### 3. New cases

3a, two models leave `users` (`r6h`): `User` → `Member` in `members` (exists), `Staff` → `Crew` in `crew` (new), `Admin` stays. One refusal holds the route, with a part "For model "User"" (at the start, with bypass) and a part "For model "Staff"" (right after the creation of `crew`, no bypass). The field statement's second line points back to it. I pasted both: `7 operation(s)`. End: `crew` S1, `members` U1 and G1, `users` the `Admin`. Next plan empty. See finding 20.

3b, moving model drops `email` (`r6i`): the route prints `{ $unset: ["email"] }`. Followed: `members` U1 as `{ name }`, G1. Next plan empty. See finding 23.

3c, a change on the target that would reach the moved documents:

- Fill (`r6j`, new required `Guest.score`): without the statement, "Cannot fill field "score" of model "Guest" in collection "members": model "Member" is stored in the same collection", with the earlier-migration advice. No move is offered. Followed: plan 1 filled `score` (temporary 0) while `members` held only `Guest`; plan 2 had the move at the start. End: U1 without `score`, G1 with `score: 0`. Next plan empty.
- Cast on a field both models store (`r6l`, `Guest.code` String → Int, `Member.code` String): refused in the same way with the same advice. Followed in two migrations. End: U1 `code: "abc"`, G1 `code: 5`. Next plan empty.
- Cast on a field only `Guest` stores (`r6k`, `Guest.age`): planned with the move, as it should be; the cast touches only documents that hold `age`.

3d, field statement whose model rename is refused (`r6c`, `r6m`): following the combined refusal (leave out both) works, with no loop. Giving the field statement alone, in either syntax, sends the user back to add the model statement. See finding 19.

### 4. A copy the target validator rejects

- Target exists, a later operation updates its validator, copy without the bypass (`r6n`):

```text
✘ [MIGRATION.EXECUTION_FAILED] Operation data_transform.move User documents to members failed: the validator of collection members rejected a document the copy wrote
  why: … A later operation of this migration updates the validator of collection members: add { bypassDocumentValidation: true } as the last argument of the copy's rawAggregate call, so that update checks the moved documents. Run the file with node, then run the command again. …
```

One piece of advice, and the right one. Followed: `5 operation(s)`; `users` the `Admin` as `rank`, `members` U1, G1.

- Target created by the plan, a bad source document (`r6b`, `r6o`): "No later operation of this migration updates the validator of collection members, so change the pipeline in the migration's migration.ts so the documents it writes fit the validator." Followed literally in `r6o` (`full_name: { $toString: "$name" }`): applied, `members` holds `full_name: "7"`. Fixing the source document in `users` (`r6b`) also works. See finding 21.

## Findings

Round 5 findings 15 and 18 are fixed. 16 is mostly fixed and 17 partly; what is left of them is noted in section 2.

### 19. ⚠️ The refusal names the field statement in a syntax the CLI rejects

Projects `r6c`, `r6m`. I typed `--rename Member.name:Member.fullName`. The refusal says to leave out `--rename User.name:Member.fullName`, which is not what I typed. Given as a statement, that form is rejected: "Name a field's model as the destination contract names it: --rename Member.name:Member.fullName". Leaving out both works. But a user who leaves out only the model statement gets "Rename the origin model to "Member" with its own --rename statement before this one", which sends them back to the refused statement. Suggest the refusal quotes the statements as the user typed them.

### 20. ⚠️ The two-move route reads as two separate applies

Project `r6h`. Each part ends with "Run that migration.ts to emit its ops.json, and apply it with db migrate" and its own "If the apply stops…". A reader could run and apply after the first move. Both parts also say "before any other operation on collection "users"", but the second copy comes after the first part's `deleteDocuments` on `users`. The order the text gives worked; the wording is just not exact. Suggest the steps for each model, then one "run and apply" at the end.

### 21. ⚠️ A rejected copy into a new collection does not name the document

Projects `r6b`, `r6o`. The validator-check stop names the document (`It has _id ObjectId(…)`) and gives a `find` query. The rejected copy names neither, so the user has to find the bad source document alone. Its only advice is to change the pipeline. Fixing the source document is often what the user wants, and it works too.

### 22. ⚠️ With the statement, a fill refusal is mentioned but not shown

Project `r6j`. With `--rename User:Member`, the output says "Planned without it, the change is refused for another reason as well, which that refusal names", but does not print that refusal. In `r6g` (a field rename on the target) both refusals are printed in one run. The user needs one more run to see the fill refusal.

### 23. ⚠️ The route does not say the copy drops a field's values

Project `r6i`. The text says "nothing is asked, since nothing is deleted", then prints `{ $unset: ["email"] }`, which deletes `email` from every moved document. That is correct for the new contract, but the text could say that those values are lost.

## Cleanup

MongoDB is stopped. Scratch projects and contracts stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
