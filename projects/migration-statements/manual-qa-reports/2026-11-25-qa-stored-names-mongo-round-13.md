# Manual QA — stored-name renames on MongoDB, round 13

Date: 2026-11-25. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `e86b0cf904`. Earlier round: `2026-11-25-qa-stored-names-mongo-round-12.md` in this folder. This round checks the fixes for the second CodeRabbit review (`wip/coderabbit/triage-2.md`).

Status: done. One new finding (34, minor). Every route checked names the right models and asks the right question. Every move case kept every document it said it would keep.

## Setup

- Tree already built at the tip; no build run. MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 12 helpers reused. `q.mjs` now also passes `oid(n)` for fixed ObjectIds. `ins-move.mjs` now adds its imports to an import that spans several lines (rounds 8 to 10 tripped on this; I tripped on it once more in `r13c` before fixing it, and rebuilt the project).
- Projects `wip/qa-mongo/r13a`–`r13l`; contracts `ctr/r13*.prisma`, and TypeScript contracts `ctr/r13b0.ts`, `ctr/r13b1.ts`.
- To stop an apply, I inserted a document with a wrong type, bypassing validation.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1 | Source dropped, and the destination also removes a model that shared it | `r13c` | ✅ |
| 2 | Source kept with no model left in it | `r13b` | ✅ |
| 3 | Two shared collections each send a model into one new collection | `r13d` | ✅ |
| 4 | Enum value removal, field optional in one model and required in another | `r13e` | ✅ |
| 5a | Copy rejected; a later validator update checks the documents | `r13f` | ✅ |
| 5b | Copy rejected; a later validator update does not check the documents | `r13g` | ⚠️ 34 |
| 6a | Dropped-source move with a stop and a re-run | `r13h` | ✅ |
| 6b | Move into a shared collection with a stop and a re-run | `r13i` | ✅ |
| 6c | Plain `@@map`, `@map`, enum value change, `migration plan` and `db update` | `r13j`, `r13k` | ✅ |

### 1. A removed model shares the dropped source

`r13c`: `User`, `Staff`, `Bot` in `users`. After: `Member` in `members`, `Crew` in `crew`, `Bot` removed. `--rename User:Member --rename Staff:Crew` is refused. The route says the plan asks about models "User", "Staff" and "Bot", and that "No copy moves the documents of model "Bot": the drop deletes them." It no longer says the drop removes only an emptied collection. The plain plan asked about exactly those three. I answered with `--delete` for all three and added the two copies. End: `members` U1, `crew` S2, `users` gone, the `Bot` document deleted as said. Next plan empty.

### 2. Source kept with no model in it

A PSL contract cannot keep a collection with no model, so I used TypeScript contracts with `users` under control policy `tolerated`: the plan does not drop it. `User` and `Admin` in `users` become `Member` in `members` and `Boss` in `bosses`. The route says the models "are then removed and nothing is asked, since nothing is deleted. Their documents stay in collection "users", where no model reads them." It asks for no `--delete`. The plain plan asked nothing and warned that the drop of `users` was suppressed. I added both copies. End: `members` U1, `bosses` A2, `users` empty. Next plan empty.

### 3. Two sources into one new collection

`r13d`: `User` + `Admin` in `users`, `Clerk` + `Boss` in `staff`. After: `Member` and `Teller` in new `people`. The route ends: "Collections "users" and "staff" both move documents into collection "people", and a document moved from one is merged into a document with the same _id moved from the other: check that no _id is in two of collections "users", "staff" and "people"." I put the same `_id` in a `User` and a `Clerk` document, against that warning. After the apply, `people` held one merged document with both `name` and `desk`, as the text says.

### 4. Enum value removal across two models

`r13e`: `Guest.level Level?` (declared first) and `User.level Level`, both in `users`; value `mid` removed with `--delete Level.MID`. The operation's check is "no document in users holds value "mid" in field level, which is required". A `User` document holding `mid` stopped the apply with its `_id`, a find query, and both ways to keep the data. I followed the by-hand route (`replaceStoredValue` to `low`). Applied; the document now holds `low`. Next plan empty.

### 5. Copy rejected by the target's validator

`User` leaves `users` and joins `Guest` in `members`. The copy runs first, so the old `members` validator rejects every `User` document.

- 5a `r13f`, the plan's validator update with `checkDocuments: true`: the advice says to add `{ bypassDocumentValidation: true }` to the copy, "so that update checks the moved documents". Followed it. Applied; `members` U1 and G9. Next plan empty.
- 5b `r13g`, the same with `checkDocuments` removed from that update: the advice says the update does not check the documents, so "fix that document in its source ..., or change the pipeline ... so the documents it writes fit the validator". Neither can work here (finding 34). Moving the copy after the validator update worked.

### 6. No regression

- 6a `r13h`, item 1's case with a `Staff` document holding `badge: 7`: the copy into `crew` stopped and named its `_id`. Fixed it in `users`, re-ran: applied. End: `members` U1, `crew` S2 and S4, `users` gone. Next plan empty.
- 6b `r13i`, item 5a's case with a `User` document holding `name: 5`: the `members` validator update stopped and named the `_id` and the field. I used the printed bypass update command and re-ran: applied. End: `members` U1, U5, G9; `users` A2. Next plan empty.
- 6c `r13j`: `@@map("items")` → `things`, `title @map("t")` → `ttl` (indexed), enum `"low"` → `"lo"` on a scalar and a list field. Nothing asked; 7 operations; documents and index right; next plan empty. `r13k`: the same with `db update`: 7 operations, same result; the next run has no operations.

## Findings

### ⚠️ 34. The copy advice cannot be followed when the validator update after it does not check documents

`r13g`. A copy moves `User` documents into `members` before the validator update that admits them. The update does not check documents. The advice offers two fixes: fix the document in its source, or change the pipeline so the documents fit the validator. The validator at that point is the old one, which accepts only `Guest` documents, so no `User` document can fit it. The fix that works is to move the copy after that validator update. The advice does not say so. Under the planner's own output this does not happen, because its validator updates check documents (case 5a). It happens when someone sets `checkDocuments` to false, which the validator check's own failure advice suggests.

Suggested fix: in this case, also say to put the copy after the operation that updates the validator.

## Wording preferences, not findings

- `r13b`: the route ends "If the new validator of collection "users" does not accept them, its change stops the apply". Under `tolerated` the plan does not change the validator of `users`, so that sentence does not apply.
- `r13d`: the refusal's first sentence names only `Admin` as a model whose documents do not move. `Boss` in `staff` is in the same position.
- Seen again, already in `deferred.md`: with only `Staff` keeping its name (`r13a`), the plain plan renames `users` to `crew`, which carries `User` and `Bot` documents along with no question. The validator check then stops the apply.

## Cleanup

MongoDB is stopped. Scratch projects and contracts stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
