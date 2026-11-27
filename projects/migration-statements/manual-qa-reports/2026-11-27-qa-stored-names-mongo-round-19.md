# Manual QA — stored-name renames on MongoDB, round 19

Date: 2026-11-27. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `efa37b5a94`. Earlier round: `2026-11-26-qa-stored-names-mongo-round-18.md` in this folder. This round checks the doubled-documents hint after commit `22a88f582d`, which now writes it as `db.getCollection("<name>").aggregate(...)` and adds it to the stop text of the time-series rename route.

Status: done. No findings (numbering would start at 40). The printed query, copied exactly, returned exactly the doubled `_id` values in every case, including a collection named `sensor-readings`.

## Setup

- The built `dist` already contained the new text, so no build ran. MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 18 helpers and contracts reused (`mk18.sh`, `ins18.py`, `rmboom.py`, `ctr/r18a0.ts`, `ctr/r18a1.ts`, `ctr/r17a0.ts`, `ctr/r17a1.ts`). New: `agg19.mjs`, `run19d.sh`, `run19h.sh`, `ins19h.py`, `mk19y.sh`, `ins19y.py`, `ctr/r19y1.ts`, `ctr/r19j0.prisma`, `ctr/r19j1.prisma`. Projects `wip/qa-mongo/r19a`–`r19z`.
- mongosh is not installed here. `agg19.mjs` takes the query from the saved error text with a regular expression and evaluates that exact string with `db.getCollection(name)` mapped to the node driver's `collection(name).aggregate(...)`. Nothing in the string is edited.
- Time-series validators were removed from the emitted contract before planning, as in round 18. A failing `$boom` raw aggregate stands in for a stop.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1a | Two groups, stopped after the copy, deletes finished, re-run | `r19a` | ✅ |
| 1d | Two groups, re-run too early, then the printed query | `r19c`, `r19d`, `r19y` | ✅ |
| 2b | Time-series rename route, stopped between the copy and the drop | `r19h`, `r19z`, `r19i` | ✅ |
| 2c | Plain `@@map`, `@map`, enum value change, `migration plan` and `db update` | `r19j`, `r19k` | ✅ |

### 1. The hint on the move into a time-series collection

- `r19c` (stop between the deletes) and `r19d` (stop after the copy): I removed the stop and re-ran without finishing the deletes. The error had printed `db.getCollection("measurements").aggregate([{ $group: { _id: '$_id', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])`. Run as printed, it returned `_id` 4 and 5 for `r19c` and 2, 3, 4 and 5 for `r19d`, each with `n: 2`. Those are exactly the doubled documents.
- `r19y`: the same move into `sensor-readings`. The error printed `db.getCollection("sensor-readings")...`; the query returned 4 and 5, exactly the doubles. The old form, `db.sensor-readings.aggregate`, would not have parsed.
- `r19a` (case 1a): the printed query returned nothing before any re-run, as it should. I finished both deletes (2 and 2), removed the stop, re-ran. End: `measurements` 2, 3, 4, 5 once each, `x` gone, time-series options kept; `events` e1. Next plan: no changes.

### 2. The time-series rename route

- The stop between the copy and the drop now names the drop, says to drop `readings` or delete its documents, and ends with the same hint, `db.getCollection("sensor_readings")...`. It reads correctly: "its documents are in collection sensor_readings more than once … To find them, group collection sensor_readings by _id …".
- `r19h`: re-run too early without dropping. The printed query returned 1, 2 and 3, each `n: 2`, exactly the doubles. `r19z` did the same into `sensor-readings`, with the same result.
- `r19i`: I dropped `readings` as the text says and re-ran. End: `sensor_readings` 1, 2, 3 once each, granularity `hours` kept; `readings` gone; the printed query returns nothing. Next plan: no changes.
- `r19j` (`migration plan`) and `r19k` (`db update`), case 2c: `@@map("items")` → `things`, `@map("t")` → `ttl` (indexed), enum `"low"` → `"lo"` on a scalar and a list. Nothing asked, 7 operations, both documents once each with the right values, index `ttl_1`. The next plan, or `db update`, had no operations.

## Findings

None.

## Notes, not findings

- The planning error for `--rename Reading:Sample` on a time-series collection still says what to do after a stop but not how to find doubles. The stop error itself now gives the hint, which is where a user needs it.
- After a too-early re-run, the next plan reports no changes while the doubles are there. That is expected, since planning compares contracts, not documents.
- The `$boom` stop is still explained as an update, as in rounds 16 to 18.

## Cleanup

MongoDB is stopped. Scratch projects stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
