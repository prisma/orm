# Manual QA — stored-name renames on MongoDB, round 17

Date: 2026-11-26. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `f8aade7ffa`. Earlier round: `2026-11-26-qa-stored-names-mongo-round-16.md` in this folder. This round checks the new copy in the time-series rename route, the narrowed runner advice, and the advice on a failure that has no MongoDB error code.

Status: done. No new findings. Every case did what its text said, and every document ended where the text said it would. Two wording notes.

## Setup

- Tree already built at the tip; no build run. MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 16 helpers reused. New: contracts `ctr/r17a0.ts`, `ctr/r17a1.ts` (time-series `readings` to `sensor_readings`), `ctr/r17g0.prisma`; a TCP proxy `proxy.mjs` to drop the connection mid-apply. Projects `wip/qa-mongo/r17a`–`r17k`.
- The known defect still blocks the create: `r17k` failed with `'timeseries' is not allowed with 'validator'`. Everywhere else I removed the time-series validator from the emitted contract before planning.
- I followed each copy as the text printed it, ran `migration.ts` with node, applied with `db migrate`, and read every collection back.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1a | Time-series rename route, stopped between the copy and the drop | `r17a` | ✅ |
| 1b | The same, stopped after the drop | `r17b` | ✅ |
| 2 | Move into a new time-series collection, connection dropped between the copy and the delete | `r17c` | ✅ |
| 3 | Hand-written `$out` copies of other shapes, stopped after the copy | `r17d`, `r17e` | ✅ |
| 4a | Merge into an existing collection, source kept | `r17f` | ✅ |
| 4b | Dropped-source move with a stop and a re-run | `r17g` | ✅ |
| 4c | Plain `@@map`, `@map`, enum value change, `migration plan` and `db update` | `r17h`, `r17i` | ✅ |

### 1. Time-series rename route

`--rename Reading:Sample` on time-series `readings` now prints `rawAggregate("sensor_readings", [{ $unionWith: "readings" }, { $out: "sensor_readings" }])`, says a run after the drop adds nothing, and says what to do on a stop before the drop. I planned with `--delete Reading` and put the copy right after the create.

- `r17a`, stop between the copy and the drop (a failing step put there): the error names the copy and the drop that has not run, and says to delete the documents of `readings` or drop it before running again. I dropped `readings`, removed the failing step, re-ran. End: `sensor_readings` 1, 2, 3 once each, time-series options kept; `readings` gone. Next plan empty.
- `r17b`, stop after the drop: the error has no copy advice, which is right. Re-ran. End: 1, 2, 3 once each. Next plan empty.

### 2. Connection dropped between the copy and the delete

`r17c`: `Measurement` moves from `events` into new time-series `measurements`. I ran the apply through a TCP proxy and killed the proxy during a slow step between the copy and the delete. The error was `connect ECONNREFUSED`, with no MongoDB code, and it still carried the full advice: the delete has not finished, finish it on `events` with the same filter, do not delete from `measurements`, and how to find documents a too-early re-run doubled. I did that and re-ran. End: `measurements` 2 and 3 once each; `events` e1. Next plan empty.

### 3. Other `$out` copies get no pair advice

- `r17d`: `rawAggregate("events", [{ $match }, { $out: "measurements" }])` (reads only the source), then a delete with the same filter, stopped between them. No copy advice.
- `r17e`: a summary `$group` into `$out: "summary"`, then an unrelated delete on `events`, stopped between them. No copy advice.

### 4. No regression

- `r17f`: the route prints the `$merge` copy with the bypass. End: `members` U1, G9; `users` A2. Next plan empty.
- `r17g`: `User` and `Staff` leave `users` for `members` and `crew`. A `Staff` document with `badge: 7` stopped the copy; the error named its `_id` and a `find` in `users`. Fixed it, re-ran. End: `members` U1; `crew` S2, S4, S7; `users` gone. Next plan empty.
- `r17h` (`migration plan`) and `r17i` (`db update`): `@@map("items")` → `things`, `@map("t")` → `ttl` (indexed), enum `"low"` → `"lo"` on a scalar and a list. Nothing asked, 7 operations, documents and index right; the next plan or `db update` had nothing to do.

## Findings

None.

## Wording, not findings

- `r17c`: the doubled-documents hint says "the copy's filter, run on collection measurements, selects each of them two or more times". The filter also selects every document the target already held, so it does not pick out the doubled ones by itself. Saying "look for an `_id` that appears more than once in collection measurements" would be plainer.
- `r17a`, `r17b`, `r17d`, `r17e`: as in round 16, my planted `$boom` step is a raw aggregate, and its error still explains it as an update ("Documents the update changed before the error stay changed…").

## Cleanup

MongoDB and the proxy are stopped. Scratch projects stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
