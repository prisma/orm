# Manual QA — stored-name renames on MongoDB, round 11

Date: 2026-11-25. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `92d50d8a39`. Script: `projects/migration-statements/slices/stored-name-renames/manual-qa-pr2.md`. Earlier round: `2026-11-25-qa-stored-names-mongo-round-10.md` in this folder. This round checks the changes made for the CodeRabbit review (`wip/coderabbit/triage.md`).

Status: done. Two new findings, both ⚠️, neither loses data when the printed text is followed. Every move case kept every document.

## Setup

- Tree already built at the tip; no build run. MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 10 helpers reused. New: `ins2.mjs` (inserts a move and handles multi-line imports). Projects `wip/qa-mongo/r11a`–`r11j`, `r11e2`, `r11iu`; contracts `ctr/r11*.prisma`; `r11f` and `r11g` use TypeScript contracts, because PSL has no `@@control` or time-series options for MongoDB.
- To stop an apply, I inserted a document with a wrong type, bypassing validation.
- Helper slip: `c.sh` does not show a failed `contract emit`, because `p.sh` always exits 0. I caught it once (`@@control` is not PSL for MongoDB) and switched that case to a TypeScript contract. Every other run produced a new contract hash.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1a | Every model leaves the source collection; stop at the validator update, fix, re-run | `r11a` | ✅ |
| 1b | Model leaves a collection the other model keeps (target has a validator) | `r11j` | ✅ |
| 2a | Three models share a collection: one `--rename`, two move by `@@map`; plan drops the source | `r11b` | ✅ |
| 2b | Moving model renames a field away from the destination variant's discriminator name | `r11c` | ✅ |
| 2c | Collection swap; the database already has a collection with the suggested temporary name | `r11d` | ⚠️ 32 |
| 2d | Enum swap route, and a temporary value a third member already stores | `r11e`, `r11e2` | ✅ |
| 2e | By-hand collection rename route (control policy `tolerated`) that also drops an index | `r11f` | ✅ |
| 2f | Time-series rename route under `migration plan` | `r11g` | ✅ text; ⚠️ 33 |
| 3 | Collection created by hand whose validator adds a predicate to the contract's `$jsonSchema` | `r11h` | ✅ |
| 4 | Plain `@@map`, `@map`, enum value change, `migration plan` and `db update` | `r11i`, `r11iu` | ✅ |

### 1. Round 10 move cases

- `r11a` (`User` and `Staff` leave `users`; `Guest` in `members`): both renames refused with one route. Followed it: planned with `--delete Staff --delete User`, added the `User` move at the start and the `Staff` move after the creation of `crew`. A bad `User` (`name: 42`) stopped it at `validator.members.update`, naming its `_id`. Fixed it in `members` with the printed update command, re-ran: applied, `users` dropped. End: `members` U1, G1, Bad; `crew` S1. Next plan empty.
- `r11j` (`User` leaves `users`, `Admin` stays): route says nothing is asked and to add the copy at the start with `bypassDocumentValidation`. Followed it. End: `users` the admin with `rank: 3`; `members` U1, G1. Next plan empty.

### 2. New cases

- 2a `r11b`: `--rename User:Member` is refused. The route now names all three models, says the plan drops `users` and asks about all three, and says to answer with `--delete`. It gives one copy for each model, each right after the creation of its collection. Followed it. A bad `Bot` (`token: 7`) stopped the copy into `bots`; the message named its `_id` and said to fix it in its source. Fixed in `users`, re-ran: applied, 10 operations. End: `members` U1; `crew` S1; `bots` T1, T7; `users` gone. Next plan empty.
- 2b `r11c`: `Note` (field `label` stored as `type`) leaves `notes` (shared with `Jot`) to become variant `Memo` of `Task`, discriminator `type`, with `label` stored as `oldType`. The route's copy is `{ $set: { oldType: "$type", type: { $literal: "memo" } } }`, with no `$unset`. Followed it. End: `tasks` holds `{ body: "n1", oldType: "urgent", type: "memo" }` and the bug; `notes` holds the jot. Next plan empty.
- 2c `r11d`: see finding 32. Under `db update` the route avoids the name the database has (`prisma_swap_accounts_`). Under `migration plan` it offers `prisma_swap_accounts`, which exists. After picking another name by hand, both plans applied and the documents swapped collections; the existing collection kept its document.
- 2d `r11e`: values `"low"` and `"high"` swapped. The route offers `prisma_swap_1` and `prisma_swap_2`. Followed it in two plans: documents end with the values swapped in the scalar and list fields. Next plan empty. `r11e2`: with a third member already storing `"prisma_swap_1"`, the route offers `prisma_swap_2` and `prisma_swap_3`.
- 2e `r11f`: `events` (unique index on `name`) becomes `occasions` with control policy `tolerated`. The question says to put `renameCollection` right after the drops of indexes on `events`. The plan with `--delete Event` is: drop index, create index on `occasions`, drop `events`. Followed the text: rename after the index drop, removed the drop. Applied 3 operations. End: `occasions` e1, e2, unique index `name_1`. Next plan empty.
- 2f `r11g`: `--rename Reading:Measurement` on a time-series collection is refused. The `migration plan` part now ends "Then run that migration.ts to emit its ops.json, and apply it with db migrate." The plan with `--delete Reading` is: create `measurements`, then drop `readings`, as the text says. I could not apply it: the known deferred problem (a time-series collection cannot be created from a contract on MongoDB 8.2.6, `deferred.md`) still applies.

### 3. Validator with an extra predicate

`r11h`: I created `users` by hand with the contract's validator plus `email: { $regex: "@" }`, both as `$and` and as a second top-level key. In both, `db migrate` stopped at `collection.users.create` ("already exists without the options this migration creates it with"). The create was not skipped. After I set the exact validator, the next run skipped the create and applied.

### 4. Plain renames

`r11i`: `@@map("items")` → `things`, `title @map("t")` → `ttl` (indexed), enum value `"low"` → `"lo"` on a scalar and a list field. Nothing asked; 7 operations. Documents read back with `ttl` and `"lo"` in both fields, index on `ttl`. Next plan empty. `r11iu`: same with `db update`: `Applied 7 operation(s)`, same documents; next run has no operations.

## Findings

### ⚠️ 32. Under `migration plan`, the collection swap route can suggest a temporary name the database already has

`migration plan` plans from the contracts, so the route cannot see the database. In `r11d` the database had `prisma_swap_accounts` with a document of its own. The route still offered that name and called it one of the "collections nothing uses". Following it, `db migrate` renamed `accounts` to `prisma_swap_users` and then stopped: "collection prisma_swap_accounts already exists". The stop message gives one way out, "If prisma_swap_accounts holds nothing you need, drop it". It does not say to pick another name. No data was lost, and choosing another name by hand worked.

What would fix it: the `migration plan` route says to check that the temporary names are not in the database, or the stop message also says to give the model another collection name and plan again.

### ⚠️ 33. The `migration plan` part of the time-series route does not say to stop writes

The `db update` part says to stop writes to `readings` until it has run, since a document written after the copy is dropped with it. The `migration plan` part has the same risk: a document written to `readings` between the copy and the drop is lost. It says nothing about writes. The other move routes now say it.

## Wording preferences, not findings

- `r11b`: the plain plan's question about `Bot` and `Staff` says to write a hand-written migration that moves the documents of `Bot` and `Staff`. It does not name `User`, whose documents also leave `users` (as `Member`). The `User` line offers `--rename`, which leads to the full route, so the user does reach it.
- Round 10's notes still apply.

## Cleanup

MongoDB is stopped. Scratch projects and contracts stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
