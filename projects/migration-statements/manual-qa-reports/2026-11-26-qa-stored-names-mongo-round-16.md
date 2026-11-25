# Manual QA — stored-name renames on MongoDB, round 16

Date: 2026-11-26. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `02242f34f5`. Earlier round: `2026-11-26-qa-stored-names-mongo-round-15.md` in this folder. This round re-checks round 15's findings 36 and 37 with the real CLI.

Status: done. Findings 36 and 37 are fixed. One minor new finding (38). Every other case did what its text said, and every document ended where the text said it would.

## Setup

- Tree already built at the tip; no build run. MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 15 helpers and contracts reused (`mkts.sh`, `mkts2.sh`, `cs.sh`, `setup.sh`, `ins-move.mjs`, `ctr/r14a*.ts`, `ctr/r15d*.ts`, `ctr/r14b*.prisma`, `ctr/r14g0.prisma`, `ctr/r15m*.prisma`). Projects `wip/qa-mongo/r16a`–`r16k`.
- The known defect still blocks the create: `r16k` failed with `'timeseries' is not allowed with 'validator'`. Everywhere else I removed the time-series validator from the emitted contract before planning, so the applies finish.
- To stop an apply after the delete, I inserted an `Event` with `name: 5`, bypassing validation, so the `events` validator update stops. To stop between the copy and the delete, I put a `dataTransform` with an unknown stage between them, then removed it before the re-run.
- I followed each copy as the route printed it, ran `migration.ts` with node, applied with `db migrate`, and read every collection back.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1 | Move into a new time-series collection, stopped after the delete | `r16a` | ✅ (36 fixed) |
| 2 | The same, stopped between the copy and the delete | `r16b` | ✅ (37 fixed) |
| 3 | Move into an existing time-series collection holding documents, one stop each way | `r16d`, `r16e` (`r16c`: see 38) | ✅ |
| 3b | A copy written in round 15's form (reads only the source), stopped after the delete | `r16f` | ✅ |
| 4a | Merge into an existing collection, source kept | `r16g` | ✅ |
| 4b | Dropped-source move with a stop and a re-run | `r16h` | ✅ |
| 4c | Plain `@@map`, `@map`, enum value change, `migration plan` and `db update` | `r16i`, `r16j` | ✅ |

### 1. New time-series collection, stop after the delete

The route for a move into new `measurements` now prints `rawAggregate("measurements", [{ $unionWith: { coll: "events", … } }, { $out: "measurements" }])` right after the create. It says a run after the delete writes back what the collection holds, and what to do on a stop before the delete.

`r16a`: the stop came at the `events` validator update. `measurements` held 2 and 3; `events` held e1 and the bad event. The error says nothing about the copy, which is right here. I fixed the event with the printed bypass update and re-ran. End: `measurements` 2 and 3 once each, options kept; `events` e1, e4. Next plan empty.

### 2. New time-series collection, stop between the copy and the delete

`r16b`: the stop message now says the delete "has not finished", to finish it on `events` with the same filter, and not to delete from `measurements`. I did that, re-ran. End: `measurements` 2 and 3 once each; `events` e1. Next plan empty.

### 3. Existing time-series collection holding 11 and 12

- `r16e`, stop between the copy and the delete: the same advice as case 2. Followed it, re-ran. End: `measurements` 2, 3, 11, 12, once each, options kept; `events` e1. Next plan empty.
- `r16d`, stop after the delete: fixed the event, re-ran. End: 2, 3, 11, 12 once each. Next plan empty.

### 3b. Round 15's copy form

`r16f`: a copy `rawAggregate("events", [{ $match }, { $out: "measurements" }])`, stopped after the delete. The error says a re-run would empty `measurements` and shows the `$unionWith` form to change it to. I changed it, ran the file, fixed the event, re-ran. End: `measurements` 2 and 3; nothing lost.

### 4. No regression

- `r16g`: the route prints the `$merge` copy with the bypass. End: `members` U1, G9; `users` A2. Next plan empty.
- `r16h`: `User` and `Staff` leave `users` for `members` and `crew`; plain plan with `--delete User --delete Staff`. A `Staff` document with `badge: 7` stopped the copy; the error named its `_id` and a `find` in `users`. Fixed it, re-ran. End: `members` U1; `crew` S2, S4, S5; `users` gone. Next plan empty.
- `r16i` (`migration plan`) and `r16j` (`db update`): `@@map("items")` → `things`, `@map("t")` → `ttl` (indexed), enum `"low"` → `"lo"` on a scalar and a list. Nothing asked, 7 operations, documents and index right, next plan empty.

## Findings

### ⚠️ 38. A re-run before the delete is finished adds the moved documents again, and later messages cannot tell

`r16c`, by my own mistake. After the stop between the copy and the delete, I ran `db migrate` once more to re-read the message, before I finished the delete. The copy ran again and `measurements` then held 2 and 3 twice. The second stop gave the same advice as the first. I followed it, and the apply finished with the duplicates still there.

The route and the stop message both warn about this, so a careful user is safe. But a user who retries by reflex, or a script that retries `db migrate`, adds another copy on each retry, and no later message mentions duplicates that are already there. Time-series collections do not enforce a unique `_id`, so nothing stops it.

Possible fix: when the runner sees this case, it could count documents in the target that share an `_id` with documents still in the source, and say so in the stop message. Or accept it as documented.

## Wording, not findings

- `r16b`: the planted `$boom` stage is a raw aggregate with no `$out`, and its error still explains it as an update ("Documents the update changed before the error stay changed…"). This only concerns my planted failure, not a real copy.

## Cleanup

MongoDB is stopped. Scratch projects stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
