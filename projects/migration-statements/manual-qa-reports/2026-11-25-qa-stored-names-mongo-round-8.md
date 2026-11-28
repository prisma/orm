# Manual QA — stored-name renames on MongoDB, round 8

Date: 2026-11-25. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `4419176829`. Script: `projects/migration-statements/slices/stored-name-renames/manual-qa-pr2.md`. Earlier round: `2026-11-25-qa-stored-names-mongo-round-7.md` in this folder.

Status: done. No document was lost, duplicated or put under the wrong model in any run. Every repeated move case passes when the printed text is followed. The new cases pass: a move with several copies, two changes that mix a model left behind with a merge or a leaving variant, and a stop after a copy. Round 7 findings 24, 25 and 27 are fixed. Two new wording warnings (findings 28, 29), no blockers.

## Setup

- Tree already built at the tip; no build run. MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 7 helpers reused (`setup.sh`, `c.sh`, `p.sh`, `q.sh`, `ins-move.mjs`). Round 8 projects are `wip/qa-mongo/r8a`–`r8l`; new contracts `ctr/r8*.prisma`; move snippets `r8*-move.txt`, `r8e-post.txt`, `r8f-staff.txt`.
- Each move was typed from the printed example, with a filter on a field only the moving model stores. To stop an apply, I inserted a document with a wrong type, bypassing validation.
- Helper note: `ins-move.mjs` does not add imports when the generated import spans several lines (`r8f`). I added `dataTransform`, `deleteDocuments` and `rawAggregate` by hand. Not a product issue.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1a | Target exists with a validator; stop at the target's validator, fix, re-run | `r8a` | ✅ |
| 1b | Target created, `name @map("full_name")`; rejected copy, fix, re-run | `r8b` | ✅ |
| 1c | `guests` renamed to `members` | `r8c` | ✅ |
| 1d | Variant route, two plans, with a stop and a late document | `r8d` | ✅ |
| 1e | Two source collections, with a stop on the second copy | `r8e` | ✅; ⚠️ 28 |
| 1f | Every model leaves the source collection, with a stop | `r8f` | ✅; ⚠️ 28 |
| 2a | One move with two copies (one dataTransform each), then one delete | `r8g` | ✅; ⚠️ 28 |
| 2b | A model left behind beside a merge | `r8i` | ✅; ⚠️ 29 |
| 2c | A model left behind beside a variant that leaves | `r8j` | ✅ |
| 2d | A field rename collision after a copy, and its re-run sentence | `r8h` | ✅ |
| 3 | Round 7 findings 24, 25, 27; `prisma init` "Install manually" | `r8a`, `r8b`, `r8e`, `r8k` | ✅ |

### 1. Round 7 move cases

- `r8a` (`User` → `Member` in existing `members`, `Admin.level @map("rank")`): move at the start, with bypass. A bad `User` (`name: 42`) stopped it at `validator.members.update`, which named the `_id`. Fixed with the printed update command, re-ran. End: `users` `[{a@x, rank 3}]`; `members` U1, U2, G1, Bad once each. Next plan empty.
- `r8b` (new `members`, `full_name`): "right after the creation of collection "members"", no bypass. A bad `User` (`name: 7`) stopped the copy. Fixed in `users`, re-ran: `3 of 4 operation(s)`. End: `members` U1, U2, Bad with `full_name`; `users` the `Admin`. Next plan empty.
- `r8c` (`guests` → `members`): "right after the rename of collection "guests" to "members"", with bypass. `5 operation(s)`. End: `members` U1, U2, G1; `users` the `Admin`. Next plan empty.
- `r8d` (variant route: `Note` leaves `tasks` for `notes`, `Feature` removed): first plan with `Feature` kept. A bad `Note` (`body: 7`) stopped it at `validator.notes.update`. Fixed in `notes`, added `note three` to `tasks`, re-ran: applied, and `note three` moved too. Second plan asked for `--delete Feature`; given, it deleted the feature. End: `tasks` the bug; `notes` all four notes and `jot`. Next plan empty.
- `r8e` (`User` → `members`, which exists; `Post` → new `articles`): one refusal, a part for each model, then "Both dataTransforms go in that one migration.ts". A bad `Post` (`body: 9`) stopped the second copy after the first had run. Fixed in `posts`, re-ran: `6 of 8 operation(s)`. End: `users` the `Admin`; `members` U1, G1; `posts` the draft; `articles` p1 and the fixed one. Next plan empty.
- `r8f` (`User` → `members`, `Staff` → new `crew`, `users` dropped): the route says to answer the plan's question with `--delete`. The plan asked; `--delete User --delete Staff` gave the drop. Both moves added. A bad `User` stopped it at the `members` validator, after both copies; `users` was empty and still there. Fixed, re-ran: `4 of 7 operation(s)`. End: `users` dropped; `members` U1, G1, Bad; `crew` S1. Next plan empty.

### 2. New cases

2a, several copies (`r8g`): `User` and `Staff` both leave `users` for `members`, each with a field rename (`name` → `fullName`, `badge` → `tag`). The route now says "add one dataTransform for each group of models whose documents change alike", prints one `rawAggregate` per model with its own `$set`/`$unset`, then one `deleteDocuments` "that selects the documents of all of them". I wrote two dataTransforms and one delete with an `$or` filter. `5 operation(s)`. End: `users` the `Admin`; `members` U1, U2 with `fullName`, S1 with `tag`, G1. Next plan empty.

2b, left behind plus a merge (`r8i`): `User` leaves `users` (Admin stays) for `members`; `Clerk` leaves `staff` (alone) for `guests`, where `Visitor` is. The text says: `User` is removed and nothing is asked; the plan asks about `Clerk`, its question offers the same rename, which is refused again, and `--delete` plans it. Each part checked: the plan without statements asked only about `Clerk`; `--rename Clerk:Teller` was refused again; `--delete Clerk` planned and dropped `staff`; applying it stopped at the `users` validator because the `User` documents stayed, as the text warns. See finding 29.

2c, left behind plus a leaving variant (`r8j`): `User` as in 2b; variant `Bug` leaves `tasks` for new `defects`. Same text shape, with "asks about the data of model "Bug"". Checked: only `Bug` was asked about; its rename was refused again; `--delete Bug` deleted the bug documents. The apply stopped at the `users` validator as warned; after I removed `name` from the `User` document it finished. End: `tasks` the feat only; `defects` empty.

2d, stop after a copy (`r8h`): an `Admin` document held both `level` and `rank`, so `renameField level → rank` stopped after the move had run. The stop ends "Once the documents are fixed, run the command again. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again." That is true: on the re-run the copy ran again, but its source documents were already deleted, so nothing was duplicated. `4 of 5 operation(s)`. End: `users` both admins with `rank`; `members` U1, G1. Next plan empty.

### 3. Round 7 findings and `prisma init`

- 24 ✅. The printed copy call keeps its indentation: stages sit under `rawAggregate("users", [`.
- 25 ✅. A rejected copy now says "fix that document in its source and run the command again, or change the pipeline … run the file with node, then run the command again".
- 27 ✅. With two source collections the "leave out" paragraph is one paragraph of about 100 words, with no repeated sentences.
- 26 is unchanged, as the tip's commit message says it is deferred: `--rename Member.name:Member.fullName` alone still says to add the model rename first (`r8l`).
- `prisma init` "Install manually": that text comes from `errorInitInstallFailed`, which nothing calls, and it is not in the built CLI. No user can see it. I made the install fail (`r8k`, a failing `pnpm` shim). The live message is "→ Run the install yourself: pnpm add -D prisma@latest @types/node" and "→ Emit the contract once the dependencies are installed: prisma contract emit". It reads well; the indentation change does not affect it.

## Findings

Round 7 findings 24, 25 and 27 are fixed. The two below are about wording; neither stops the user or loses data.

### 28. ⚠️ A combined refusal ends with the second refusal's opening again

Projects `r8e`, `r8f`, `r8g`. After the route, a last line repeats the opening sentence for the second model, then says "the refusal of --rename User:Member says what that plan does". In `r8g` it is word for word the first paragraph. In `r8f` it reads "the documents of model "User" do not move to collection "crew"", which is true but makes the reader stop. The route above has already said everything. Wording preference.

### 29. ⚠️ The merge route speaks of `Visitor` documents that `guests` "does not already hold"

Project `r8i`. The hand-written route says to rewrite "the documents of model "Clerk", and those of model "Visitor" that collection "guests" does not already hold, into collection "guests"". All `Visitor` documents are already in `guests`, so the clause names nothing to do, yet suggests some `Visitor` documents might be elsewhere. Real but small; following it does no harm.

### Side notes, not findings of this change

- `prisma orm init --help` wraps two lines too early ("it prints how to install" / "Prisma 8 beside…", "instead," / "which breaks…").
- When the first `prisma orm init` install fails, the output has a stray "written" line before "Nothing was written."
- `errorInitInstallFailed` is unused code.

## Cleanup

MongoDB is stopped. Scratch projects, contracts and the `shim/` folder stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
