# Manual QA — stored-name renames on MongoDB, round 12

Date: 2026-11-25. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `45384c0124`. Earlier round: `2026-11-25-qa-stored-names-mongo-round-11.md` in this folder. This round checks the fixes from dispatch 40 (`slices/stored-name-renames/dispatches/40-mongo-round-21-fixes.md`): text changes and tests.

Status: done. No new findings. Findings 32 and 33 are fixed. Every move case kept every document.

## Setup

- Tree already built at the tip; no build run. MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 11 helpers and contracts reused. Projects `wip/qa-mongo/r12a`–`r12i`; new contracts `ctr/r12*.prisma`. `r12c` and `r12d` use TypeScript contracts, as in round 11.
- To stop an apply, I inserted a document with a wrong type, or one that clashes, bypassing validation.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1a | Collection swap under `migration plan`; the database has both suggested temporary names | `r12a` | ✅ 32 fixed |
| 1b | Same, following the suggested name that exists, then the runner's new advice | `r12b` | ✅ 32 fixed |
| 1c | Time-series rename route under `migration plan` says to stop writes | `r12c` | ✅ 33 fixed |
| 2 | Collection rename stopped because the new collection exists; follow the advice | `r12d` | ✅ |
| 3 | Three-model split: the plain plan's question names every leaving model | `r12e` | ✅ |
| 4a | Three models move out with one stop (bad `Bot`) and a re-run | `r12e` | ✅ |
| 4b | One model leaves a collection another keeps, with one stop and a re-run | `r12f` | ✅ |
| 4c | Plain `@@map`, `@map`, enum value change, `migration plan` and `db update` | `r12g`, `r12h` | ✅ |

### 1. Findings 32 and 33

- `r12a`: database had `users`, `accounts`, and also `prisma_swap_accounts` and `prisma_swap_users`, each with a document of its own. The swap route now says the names are ones "neither contract uses" and ends "If the database already has a collection of one of those names, pick another." Followed it with `tmp_acc` and `tmp_usr`: both plans applied, documents swapped, the two existing collections kept their documents. Next plan empty.
- `r12b`: only `prisma_swap_accounts` existed. I followed the suggested names. `db migrate` renamed `accounts` to `prisma_swap_users`, then stopped at the rename of `users`. The stop now also says: if the target is a temporary name a refused rename suggested, delete this migration, give the model another temporary name the database does not have, and plan again. Followed that: deleted the migration, gave `User` `tmp_acc`, kept `prisma_swap_users` for `Account`, planned again. The apply skipped the rename that had already run and renamed `users` to `tmp_acc`. The second plan finished the swap. `prisma_swap_accounts` kept its document. Next plan empty.
- `r12c`: `--rename Reading:Measurement` on a time-series collection. The `migration plan` part now says to stop writes to `readings` before `db migrate` and to allow them again after, with the reason. Applying is still blocked by the known deferred problem (a time-series collection cannot be created from a contract on MongoDB 8.2.6).

### 2. Rename stopped because the new collection exists

`r12d`: `events` (unique index on `name`) becomes `occasions`, control policy `tolerated`, planned with `--delete Event`. I put `renameCollection` in the wrong place, after the `createIndex` on `occasions`, and removed the drop of `events`. `db migrate` dropped the index on `events`, created `occasions` through the index, then stopped at the rename. The advice now says to put the rename right after the drops of indexes on `events` and before every other operation, run node, drop `occasions`, and run again. Followed it exactly. Applied: 2 of 3 operations, the index drop skipped as already done. End: `occasions` e1, e2, unique index `name_1`; `events` gone. Next plan empty.

### 3. Three-model split question

`r12e` (`User`, `Staff`, `Bot` in `users`; after: `Member` in `members`, `Staff` in `crew`, `Bot` in `bots`). The plain plan's question about `Bot` and `Staff` now ends: "The documents of model "User" leave collection "users" too, and the destination removes that model: to keep them, rewrite them in the same migration into the collection of the model that takes them over." All three leaving models are named.

### 4. No regression

- 4a `r12e`: followed the `--rename User:Member` route with `--delete` for all three and the three copies. A bad `Bot` (`token: 7`) stopped the copy into `bots`, naming its `_id`. Fixed it in `users`, re-ran: 9 of 10 operations applied. End: `members` U1; `crew` S1; `bots` T1, T7; `users` gone. Next plan empty.
- 4b `r12f` (`User` leaves `users`, `Admin` stays, `Member` joins `Guest` in `members`): added the copy at the start, as the route says. I also put a `Guest` document in `members` with the `_id` of a moving `User` document, against the route's warning to check for shared `_id` values first. `$merge` merged them, as the route warns, and the validator update stopped, naming the `_id` and the extra field `nick`. Removed `nick` with the printed bypass update command, re-ran: applied. End: `users` the admin; `members` U1, G1, and the moved document. Next plan empty.
- 4c `r12g`: `@@map("items")` → `things`, `title @map("t")` → `ttl` (indexed), enum `"low"` → `"lo"` on a scalar and a list field. Nothing asked; 7 operations; documents and index correct; next plan empty. `r12h`: same with `db update`: 7 operations, same documents; next run has no operations.

## Findings

None new.

## Wording preferences, not findings

- `r12d`: the stop's first sentence, "If occasions holds nothing you need, drop it, then run the command again", does not work alone when the migration's own `createIndex` made `occasions`: the re-run creates it again and stops again. The next sentence covers that case, so a reader who reads on is fine. The third sentence, about temporary names from a refused rename, does not apply here but is worded as a condition.
- `r12e`: "the destination removes that model" reads oddly for `User`, which becomes `Member`. "The model that takes them over" is not named.
- Seen again, already recorded in `deferred.md`: two fields of the same type that swap stored names (`r12i`) give the same storage hash, and `migration plan` says "No changes detected".

## Cleanup

MongoDB is stopped. Scratch projects and contracts stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
