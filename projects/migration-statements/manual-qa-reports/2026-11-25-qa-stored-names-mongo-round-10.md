# Manual QA — stored-name renames on MongoDB, round 10

Date: 2026-11-25. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `8f17fdc6a4` (includes a merge of `origin/main`). Script: `projects/migration-statements/slices/stored-name-renames/manual-qa-pr2.md`. Earlier round: `2026-11-25-qa-stored-names-mongo-round-9.md` in this folder.

Status: done. No new findings. Round 9 findings 30 and 31 are fixed. Every move case I re-ran kept every document when the printed text was followed. A split and a merge refused together each state their own reason.

## Setup

- Tree already built at the tip; no build run. MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 9 helpers and contracts reused. Round 10 projects are `wip/qa-mongo/r10a`–`r10h`, `r10hu`; new contracts `ctr/r10g*.prisma`; move snippet `r10c-move.txt`.
- To stop an apply, I inserted a document with a wrong type, bypassing validation.
- Helper slip, as in round 9: in my first `r10e` run, `ins-move.mjs` did not add the imports to a multi-line import, `node migration.ts` failed, and my chained command ran `db migrate` on the plan's own ops.json. That dropped `users` with its documents, which is what the plan says it does after `--delete`. Not a product issue. I rebuilt `r10e` and repeated it correctly.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1a | Target exists with a validator; follow the `--rename` refusal, stop, fix, re-run | `r10b` | ✅ |
| 1d | Variant route under `migration plan`, two plans, stop and late document | `r10c` | ✅ |
| 1e | Two source collections, stop on the second copy | `r10d` | ✅ |
| 1f | Every model leaves the source collection, stop | `r10e` | ✅ |
| 2a | Finding 30: variant route under `db update` | `r10a` | ✅ fixed |
| 2b | Finding 31: data-transform update that fails part way | `r10f` | ✅ fixed |
| 3 | A split and a merge refused together, both orders | `r10g` | ✅ |
| 4 | Plain `@@map`, `@map`, enum value change, `migration plan` and `db update` | `r10h`, `r10hu` | ✅ |

### 1. Move cases

- `r10b`: `--rename User:Member` is refused with the route. Following it: planned without the statement, added the copy and delete at the start. A bad `User` (`name: 42`) stopped it at `validator.members.update`, naming its `_id`. Fixed in `members` with the printed update command, re-ran: `3 of 5 operation(s)`. End: `users` `[{a@x, rank 3}]`; `members` U1, U2, G1, Bad once each. Next plan empty.
- `r10c`: full change refused with the variant route. First plan with `Feature` kept, move at the start. A bad `Note` (`body: 7`) stopped it at `validator.notes.update`. Fixed in `notes`, added `note three` to `tasks`, re-ran: applied, and `note three` moved too. Second plan asked for `--delete Feature`; given, it deleted the feature. End: `tasks` the bug; `notes` all notes and `jot`. Next plan empty.
- `r10d`: both renames refused with one route. Added the `User` move at the start and the `Post` move right after the creation of `articles`. A bad `Post` (`body: 9`) stopped the second copy at the `articles` validator; the message named its `_id` and said to fix it in its source. Fixed in `posts`, re-ran: `6 of 8 operation(s)`. End: `users` the `Admin`; `members` U1, G1; `posts` the draft; `articles` p1 and the fixed one. Next plan empty.
- `r10e`: plain plan asks about `Staff` and `User`; the rename route says to answer with `--delete` and add both moves. Did so. A bad `User` stopped it at the `members` validator after both copies; `users` was empty and still there. Fixed, re-ran: `4 of 7 operation(s)`, `users` dropped. End: `members` U1, G1, Bad; `crew` S1. Next plan empty.

### 2. Round 9 findings

- 30 ✅. The `db update` sentence now reads: "Under db update, first move the documents of model "Note" out of collection "tasks" by hand, then apply that change." I followed it: moved the notes by hand, `db update` with `Feature` kept applied, then `db update --delete Feature` applied 2 operations. End: `tasks` the bug; `notes` both notes and `jot`. Next `db update` has no operations.
- 31 ✅. The same unsafe update (`"7"` → `"77"`, stops at `"G1"`) now says: "When the command runs again, this update runs again over every document its filter selects, those it already changed among them, so make the update give the same result when it runs twice, or restore the documents it changed before you run the command again." I restored `"77"` to `"7"`, fixed the conversion with `$convert … onError: 0`, re-ran: `4 of 6 operation(s)`. End: `"77"` and `"G10"`, each changed once. Next plan empty.

### 3. Split and merge refused together

`r10g`: `User` → `Member` leaves `users` (shared with `Admin`) — a split; `Clerk` → `Teller` moves from `staff` into `guests` (holds `Visitor`) — a merge. In both orders of the statements, the summary lists both refusals, the first statement's reason comes first, and the other's own reason follows the route: the split says the documents of `Admin` do not move; the merge says `guests` would also store the documents of `Visitor`. Neither borrows the other's reason. The claims about the plan without statements hold: nothing asked about `User`, a question about `Clerk` only, its rename refused again, `--delete Clerk` plans 4 operations with the drop of `staff`.

### 4. Plain renames

`r10h`: `@@map("items")` → `things`, `title @map("t")` → `ttl` (indexed), enum value `"low"` → `"lo"` on a scalar and a list field. Nothing asked; 7 operations. Documents read back with `ttl`, `"lo"` in both fields, index on `ttl`. Next plan empty. `r10hu`: same with `db update`: `Applied 7 operation(s)`, same documents; next run has no operations.

## Findings

None.

## Wording preferences, not findings

- In the split-and-merge refusal, the second statement's reason sits as a bare line between the route and the closing line. It names the collections, so it can be matched, but it does not say which statement it belongs to (for example "For --rename Clerk:Teller: …").
- Round 9's notes still apply: the closing line points to the refusal printed just above it, and a two-model split names only the first model's case in its first paragraph.

## Cleanup

MongoDB is stopped. Scratch projects and contracts stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
