# Manual QA — stored-name renames on MongoDB, round 15

Date: 2026-11-26. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `2daf94834a`. Earlier round: `2026-11-26-qa-stored-names-mongo-round-14.md` in this folder. This round checks the time-series copies (`$out` and `$unionWith`) and the guard on the source lookup for a rejected copy.

Status: done. One serious finding (36) and one minor one (37). Every other case did what its text said, and every document ended where the text said it would.

## Setup

- Tree already built at the tip; no build run. MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 14 helpers reused (`setup.sh`, `c.sh`, `q.mjs`, `ins-move.mjs`). New: `mkts.sh` and `mkts2.sh` (projects with a TypeScript contract), `cs.sh` and `stripsnap.mjs` (emit, then remove a collection's validator from `output/contract.json`), `stripts.mjs` (remove the validator from a `createCollection` in `migration.ts`).
- Projects `wip/qa-mongo/r15a`–`r15p`; contracts `ctr/r15*.ts`, `ctr/r15m*.prisma`, and round 14's `r14a*.ts`, `r14b*.prisma`, `r14g0.prisma`.
- The known defect (a time-series collection is created with the contract's validator, which MongoDB 8.2.6 refuses) still blocks the planned create: `r15a` failed with `'timeseries' is not allowed with 'validator'`. In `r15a` and `r15b` I removed the validator from the create in `migration.ts`, so those applies end at the schema check (`missing: measurements/validator`). Everywhere else I removed the time-series validator from the emitted contract before planning, so the plan creates the collection without one and the apply finishes.
- To stop an apply, I inserted a document with a wrong type, bypassing validation, or (`r15d`, `r15e`) put a `dataTransform` with an unknown stage between the copy and the delete, then removed it.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1 | Model moves out of a shared collection into a new time-series collection, with a stop and a re-run | `r15a`, `r15b`, `r15c` | 🛑 36 |
| 2 | Model moves into an existing time-series collection that holds documents, stopped between the copy and the delete | `r15d`, `r15e`, `r15f` | ⚠️ 37 |
| 3 | Two models move into one new time-series collection | `r15g`, `r15h` | ✅ |
| 4 | Rejected copy whose `$merge` does not match on `_id` alone | `r15i`, `r15j`, `r15k` | ✅ |
| 5a | Merge into an existing collection, source kept | `r15o` | ✅ |
| 5b | Dropped-source move with a stop and a re-run | `r15p` | ✅ |
| 5c | Plain `@@map`, `@map`, enum value change, `migration plan` and `db update` | `r15m`, `r15n` | ✅ |

### 1. Move into a new time-series collection

`r14a`'s contracts: `Event` and `Measurement` in `events`; after, `Reading` in new time-series `measurements`. `--rename Measurement:Reading` is refused and now prints a copy ending in `{ $out: "measurements" }`, placed right after the create, and says `$out` replaces nothing because the plan creates the collection right before it. The plain plan asked nothing.

- `r15c`: followed as printed. End: `events` holds only `e1`; `measurements` holds both measurements with their `_id` values, and keeps `timeseries: { timeField: 'at' }`. Next plan empty.
- `r15a`, stop in the copy: a measurement with `at: 'bad'` stopped the `$out` ("'at' must be present and contain a valid BSON UTC datetime value"). Nothing was written. I fixed the document and re-ran: all three measurements moved.
- `r15b`, stop after the delete: see finding 36.

### 2. Move into an existing time-series collection

`r15d`: `Reading` already in time-series `measurements` with two documents (`_id` 11, 12); `Measurement` in `events` becomes `Sample` in `measurements`. The route prints one `rawAggregate("measurements", [{ $unionWith: { coll: "events", … } }, { $out: "measurements" }])`, says why `$out` alone would remove what the collection holds, and says to delete the moved documents from `measurements` before a re-run if the apply stops between the copy and the delete.

- `r15d`: stopped between the copy and the delete. `measurements` then held 2, 3, 11, 12; `events` still held 2 and 3. I followed the text: deleted 2 and 3 from `measurements`, re-ran. End: `measurements` 2, 3, 11, 12, options kept; `events` `e1`. No existing document lost. Next plan empty.
- `r15e`: the same stop, re-run without that delete. `measurements` holds 2 and 3 twice, as the text warns. See finding 37.
- `r15f`: stopped after the delete, at the `events` validator update. Fixed the document and re-ran: the copy ran again and kept 2, 3, 11, 12. The `$unionWith` form is safe here.

### 3. Two models into one new time-series collection

- `r15g`: `Measurement` and `Probe` change alike, so the route gives one copy with `$out`. End: both documents in `measurements`, options kept, next plan empty.
- `r15h`: `Measurement` loses field `x`, so the copies differ. The route gives one `$unionWith` copy with a stage for each model and says why `$out` in each would remove the other's documents. End: both documents in `measurements`, `x` gone, next plan empty.

### 4. Rejected copy whose `$merge` does not match on `_id`

`User` leaves `users` and joins `Guest` in `members`; the old `members` validator rejects the copy.

- `r15i`, `on: 'email'` (unique index made by hand): the error says MongoDB names the document "by the _id … of the document in collection members that the $merge matched or would insert, which need not be the _id of a document in collection users". No `find` in `users`. I followed the bypass advice: applied, next plan empty.
- `r15j`, `whenMatched` pipeline: the same text.
- `r15k`, control with `on: ['_id']`: the error still gives `db.getCollection("users").find({ _id: … })`.

### 5. No regression

- 5a `r15o`: the route prints the `$merge` copy with the bypass and the `_id` limits. End: `members` U1, G9; `users` A2. Next plan empty.
- 5b `r15p`: `User` and `Staff` leave `users` for `members` and `crew`; plain plan with `--delete User --delete Staff`. A `Staff` document with `badge: 7` stopped the copy; the error named its `_id` and a `find` in `users`. Fixed there and re-ran: applied. End: `members` U1, `crew` S2 and S4, `users` gone. Next plan empty.
- 5c `r15m`: `@@map("items")` → `things`, `@map("t")` → `ttl` (indexed), enum `"low"` → `"lo"` on a scalar and a list. Nothing asked, 7 operations, documents and index right, next plan empty. `r15n`: the same with `db update`: 7 operations, same result; the second run had nothing to do.

## Findings

### 🛑 36. A re-run after the delete empties a new time-series collection that the `$out` copy filled

`r15b`. The route for a move into a new time-series collection ends the copy in `$out`, and ends with "If the apply stops, fix what stopped it and run db migrate again." The copy has no check, so a re-run runs it again. If the apply stopped after the delete, the copy now finds no documents in the source, and `$out` replaces the collection with nothing.

What I did: an `Event` document with `name: 5` stopped the `events` validator update, which runs after the copy and the delete. At that point `measurements` held both measurements. I fixed the document with the bypass update the error prints and re-ran `db migrate`. Afterwards `measurements` was empty, and `events` no longer held the measurements. Both documents were gone. `r15a` lost its three the same way, re-run after the schema check stopped the apply.

The stop message only says "an operation with no check, such as a copy in a dataTransform, runs again". Nothing warns that this copy deletes what the first run moved.

Possible fix: use the `$unionWith` form for a new collection too. A first run reads an empty collection, and a re-run after the delete keeps what the first run wrote (`r15f` shows this). Its other risk, duplicates after a stop between the copy and the delete, is already explained in the route.

### ⚠️ 37. The warning to delete moved documents before a re-run is only in the plan's text

`r15e`. For a `$unionWith` copy, the route says that after a stop between the copy and the delete, you must delete the moved documents from the destination before you re-run. The error printed at the stop does not say this. It only says the copy runs again. Someone who follows that error, perhaps days after planning, ends with every moved document twice. Time-series collections do not enforce unique `_id`, so nothing stops it.

Suggested fix: put the warning where the user will see it at the stop, for example as a comment the route asks for above the copy in `migration.ts`, or in the runner's message when a copy into a time-series collection is followed by a failure.

## Wording, not findings

- `r15a`, `r15d`: when a `dataTransform` copy fails, the error explains it as an update ("Documents the update changed before the error stay changed… make the update give the same result when it runs twice"). For a copy ending in `$out`, nothing is written when it fails, and the text about the update does not apply.

## Cleanup

MongoDB is stopped. Scratch projects and contracts stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
