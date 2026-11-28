# Manual QA — stored-name renames on MongoDB, round 18

Date: 2026-11-26. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `ac56115637`. Earlier round: `2026-11-26-qa-stored-names-mongo-round-17.md` in this folder. This round checks the move of two groups of models into one new time-series collection: one copy and one delete per group, the runner's advice on a stop, and the new hint that finds doubled documents by `_id`.

Status: done. No findings (numbering would start at 40). Every case did what its text said, and every document ended where the text said it would. Three notes on wording and one on a path the text does not print.

## Setup

- Tree already built at the tip; no build run. MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 17 helpers reused. New: contracts `ctr/r18a0.ts`, `ctr/r18a1.ts` (`Measurement` with `v`, `x` and `Sample` with `w` leave shared `events` for time-series `measurements` as `Reading` and `Probe`), `ctr/r18g0.ts`; scripts `mk18.sh`, `ins18.py`, `rmboom.py`, `ids.sh`. Projects `wip/qa-mongo/r18a`–`r18k`.
- The known defect still blocks the create: `r18i` failed with `'timeseries' is not allowed with 'validator'`. Everywhere else I removed the time-series validator from the emitted contract before planning.
- A failing raw-aggregate step (`$boom`) stands in for a stop. I wrote each copy and delete as the text printed it, ran `migration.ts` with node, applied with `db migrate`, and read every collection back.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1a | Two groups, stopped after the copy, before both deletes | `r18a` | ✅ |
| 1b | Two groups, stopped between the deletes | `r18b` | ✅ |
| 1c | Two groups, deletes in the other order, stopped between them | `r18e` | ✅ |
| 1d | Run again too early on purpose, then the duplicate-finding aggregate | `r18c`, `r18d` | ✅ |
| 2a | One group into a new time-series collection, stop and re-run | `r18g` | ✅ |
| 2b | Time-series rename route, stop between the copy and the drop | `r18h` | ✅ |
| 2c | Plain `@@map`, `@map`, enum value change, `migration plan` and `db update` | `r18j`, `r18k` | ✅ |

### 1. Two groups into one new time-series collection

`--rename Measurement:Reading --rename Sample:Probe` is refused, and the text prints one `rawAggregate` with a `$unionWith` stage for each model (the `Measurement` stage with `$unset: ["x"]`), then one `deleteDocuments` per stage with that stage's filter, and says to finish the unfinished deletes on `events` after a stop. I planned without the renames and added the copy (filters `v` and `w` exist) and the two deletes after the create.

- `r18a`, stop after the copy: the error names both deletes as not finished and says to finish each with its own filter. I did (2 and 2 deleted), removed the stop, re-ran. End: `measurements` 2, 3, 4, 5 once each, `x` gone, time-series options kept; `events` e1. Next plan: no changes.
- `r18b`, stop between the deletes: the error names only the `w` delete. I finished it, re-ran. End: `measurements` 2–5 once each; `events` e1.
- `r18e`, the `w` delete first, stop between: the error names only the `v` delete. Finished it, re-ran. Same end state.
- `r18c` (stop between the deletes) and `r18d` (stop after the copy): I removed the stop and re-ran without finishing the deletes. The re-run exits 0 and doubles the documents still in `events` (`r18c`: 4 and 5; `r18d`: 2–5). The aggregate the error prints, `db.measurements.aggregate([{ $group: { _id: '$_id', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])`, returned exactly those `_id` values with `n: 2`.

### 2. No regression

- `r18g`: one model from `events` into new time-series `measurements`. The route prints one copy and one delete with "the same filter". A stop between them names the delete; I finished it and re-ran. End: `measurements` 2, 3 once each; `events` e1. Next plan: no changes.
- `r18h`: `--rename Reading:Sample` on time-series `readings` prints the `$unionWith: "readings"` copy. A stop between the copy and the drop names the drop and says to drop `readings` or delete its documents. I dropped it and re-ran. End: `sensor_readings` 1, 2, 3 once each, granularity `hours` kept; `readings` gone. Next plan: no changes.
- `r18j` (`migration plan`) and `r18k` (`db update`): `@@map("items")` → `things`, `@map("t")` → `ttl` (indexed), enum `"low"` → `"lo"` on a scalar and a list. Nothing asked, 7 operations, documents and index right; the next plan or `db update` had nothing to do.

## Findings

None.

## Notes, not findings

- Off the printed path, `r18f`: if one delete with `$or` of both filters replaces the two deletes, a stop between the copy and it gets no copy advice at all, only the general "a copy in a dataTransform runs again". This matches the rule that a delete pairs with a stage by the same filter, and the text does say to write one delete per stage. Worth knowing, since merging the deletes is a natural shortcut.
- Wording, `r18h`: the rename-route error says a too-early re-run leaves each document "two or more times, under the same _id", but unlike the move error it does not print the `$group` aggregate to find them. Here every document of `readings` is doubled, so it matters less.
- Wording, all stops: as in rounds 16 and 17, my `$boom` step is a raw aggregate, and its error still explains it as an update ("Documents the update changed before the error stay changed…").
- Wording, `r18c`/`r18d`: a too-early re-run exits 0 with no message. That is what the text warns about (the copy has no check), so the doubled documents show up only when someone looks.

## Cleanup

MongoDB is stopped. Scratch projects stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
