# Manual QA — stored-name renames on MongoDB, round 30

Date: 2026-11-27. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `edb849fdb1`. Earlier round: `2026-11-27-qa-stored-names-mongo-round-29.md` in this folder. This round checks commit `edb849fdb1`: in step 5 of "Moving a MongoDB collection aside", a time-series document is deleted with a filter that matches it alone, after a count with that filter; step 6's count now subtracts the documents deleted from the collection and covers a `"fail"` copy that stops after an empty list; the refusal's drop sentence now reads "Drop orders only if it holds nothing you need, even when an earlier run of this command created it".

Status: done. One new finding, low. In every case, following the printed advice and the error-reference steps led to a `db migrate` that succeeded, every document I chose to keep was kept, nothing was doubled, the step 6 count rule gave the number `countDocuments()` showed, and `db verify` passed. Finding 53 is fixed. Finding 54: the regular-collection bullet of step 5 says "delete the one in items" without the condition, so read on its own it tells the user to delete the document the run wrote even when they chose to keep it.

## Setup

- `dist` was current: `packages/3-targets/mongo/1-target/dist/control.mjs` holds the new text (`only if it holds nothing you need, even when`) and not the old (`This holds also if an earlier run`), and no source file is newer. No build was run.
- MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end. No proxy was needed.
- Round 18 to 29 helpers reused (`mk.sh`, `c.sh`, `cs.sh`, `p.sh`, `q.sh`, `mkp27.sh`, `mkp28s.sh`, `mkp29l.sh`, `mkts29.sh`, `step29.mjs`, `ins-move.mjs`, `rehash20.mjs`). New:
  - `mkts30.sh` with `seedts30.txt`: as `mkts29.sh`, but `readm`'s dataTransform writes two readings under `_id` 31 (`value` 0 at 02-01, `value` 5 at 02-02), and `readings` holds the documents given before the run (`pre30.txt`: `_id` 1, 2, and 31 twice with `value` 7 at 02-01 and `value` 8 at 02-03; `pre30e.txt`: 31 twice, both `value` 0 at 02-01).
  - `ts-aside30.sh`: step 2 for a time-series collection as written (`$out` with the same `timeseries` options, both counts, drop).
  - `pre30run.sh`: `mkts30.sh`, the first stop, step 2, step 3 (`--to …_readm`, count), step 4's `$nor`, and step 5's list and `find` of both collections.
  - `step30.mjs` (run through `s30.sh`): `step29.mjs` plus `find <_id>` on both collections, `count` and `del` with a whole-document filter on either collection (`countDocuments(<filter>)`, `deleteOne(<filter>)`), and `all`.
- mongosh is not installed. Each `mongosh` step was run as the same server command through the Node driver.
- Projects `wip/qa-mongo/r30a`–`r30m`.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1 | Time-series: `readings_kept` and `readings` each hold two documents under one `_id`, with different content | `r30a`, `r30b`, `r30c`, `r30e`, control `r30d` | ✅ |
| 2 | Regular collection: a `"fail"` copy stops after an empty list | `r30f`, `r30g` | ✅ |
| 3 | The reworded drop sentence (finding 53) | every refusal of this round | ✅ fixed |
| 4 | Regression: round 29 cases 1 and 2 | `r30h`, `r30i`, `r30j`, `r30k`, `r30l`, `r30m` | ✅ with finding 54 |

### 1. Two documents under one `_id` in each collection, time-series

In each project: `db migrate` refused at `collection.readings.create`. Step 2 copied `readings` into time-series `readings_kept` (4 and 4) and dropped `readings`. Step 3, `--to …_readm`, created `readings` and wrote the two run readings under 31; count 2, noted. Step 4's `$nor` reports no validator. Step 5's list showed `_id` 31 twice, as the time-series bullet says it can. `find({ _id: 31 })` showed `value` 7 and 8 in `readings_kept`, and 0 and 5 in `readings`. For each document I did not keep, I wrote the filter from the `find` output, for example `{ _id: 31, ts: ISODate("2026-02-01T00:00:00Z"), value: 0 }`, checked that `countDocuments` gave 1, ran `deleteOne` and checked `deletedCount: 1`. Then `$unionWith`/`$out`.

| Project | Kept | Deleted | Step 6 rule | `countDocuments()` |
| ------- | ---- | ------- | ----------- | ------------------ |
| `r30a` | 7 and 8 (both moved aside) | 0 and 5 from `readings` | 2 − 2 + 4 = 4 | 4 |
| `r30b` | 7 (moved aside) and 5 (run) | 8 from `readings_kept`, 0 from `readings` | 2 − 1 + 3 = 4 | 4 |
| `r30c` | 0 and 5 (both run) | 7 and 8 from `readings_kept` | 2 − 0 + 2 = 4 | 4 |
| `r30e` | 0 and 5 (run); `readings_kept` held 0 twice, the same as the run's 0 in every field | both 0s from `readings_kept` | 2 − 0 + 2 = 4 | 4 |

In every project the step 6 list was empty, `readings` held exactly the documents chosen, each once, `readings_kept` was dropped, `db migrate` succeeded, `db verify` passed, and `readings` is still time-series. In `r30e` the count with the filter gave 2; as the step says, each `deleteOne` deleted one of them (count 2, then 1, then 0).

Control `r30d`: `countDocuments({ _id: 31 })` on `readings` gave 2, and `deleteOne({ _id: 31 })` deleted whichever came first. Here that was `value` 0; had I chosen to delete 5, it would have deleted 0, the one I chose to keep. The count first with the whole-document filter is what prevents this.

### 2. A `"fail"` copy stops after an empty list

`mkp27.sh` (`notesm` creates `notes`, `itemsm` creates `items`, both with no after-check; `items` exists with `_id` 1 and 2). `db migrate` stopped at `items`; I renamed it to `items_kept`; `--to …_itemsm` stopped at `notes`, which the first run had created and which was empty, so I dropped it as the advice says and ran `--to …_itemsm` again, which created `items` (count 0, noted). `collMod`, `$nor` found nothing, the step 5 list was empty. Then, to stand for a write that was not stopped, I inserted `{ _id: 2, t: "stray" }` into `items`. `$merge` with `"fail"` copied `_id` 1 and stopped on a duplicate key for `_id` 2. Following "compare as above, then copy with `keepExisting`": the list now showed 1 (copied, the same in both) and 2 (different).

- `r30f`: I kept the moved-aside 2 by deleting 2 from `items`, then copied with `"keepExisting"`. The new step 6 bullet says to count with the first list (empty) and not to subtract the delete under that `_id`: 0 − 0 + 2 = 2. `countDocuments()` gave 2; `items` holds 1 and the moved-aside 2.
- `r30g`: I kept the stray 2 and copied with `"keepExisting"`: 0 + 2 = 2. `countDocuments()` gave 2; `items` holds 1 and the stray 2.

In both the step 6 list was empty; I dropped `items_kept`, `db migrate` had nothing to apply, all three migrations show applied, and `db verify` passed. Subtracting the delete in `r30f`, as the main sentence of step 6 would without the bullet, gives 1, which is wrong; the bullet is needed and gives the right number.

### 3. The reworded drop sentence (finding 53)

Every refusal of this round (`r30a`–`r30m` first stops, `r30h` and `r30i` stops at `orders`, `r30f`/`r30g` stops at `notes`) reads, for example: "Drop orders only if it holds nothing you need, even when an earlier run of this command created it: an operation of that run may have moved documents into it from a collection it then deleted them from, and those documents are only in orders. After you drop it, run the command that stopped again, as you ran it…". Read cold, "even when" plainly qualifies "only if it holds nothing you need", and the reason follows at once after the colon. There is no "this" left to misread, and "it" can only be the collection. "This holds also if" is gone. Finding 53 is fixed.

### 4. Regression

- Round 29 case 1A (`r30h`, `mkp29l.sh … A`): `db migrate` moved the 3 `legacy` documents into `orders` and refused at `collection.items.create`; moved `items` aside; `--to …_movem` refused at `collection.orders.create` with the new drop sentence and `--to …_ordersm`; moved `orders` aside, `--to …_ordersm` (count 0), list empty, `"fail"` copied 3, step 6 list empty, 3 and 3, dropped; `--to …_movem` created `items`; `items` list empty, `"fail"` copied 2, 2 and 2, dropped; `db migrate` up to date; `db verify` passed. `orders` holds `a`, `a`, `b` under their original `_id`s.
- Round 29 case 1B (`r30i`, `… B`): the unique index `c_1` failed on the two `a` values; I changed one to `a2`; `db migrate` refused at `orders` with the new sentence; move-aside for `orders` with `--to …_ordersm`, 3 and 3; `db migrate` built `c_1`; `db verify` passed.
- Round 29 case 2, regular (`mkp28s.sh`): `r30j` (same content) and `r30k` (the application changed `seed`'s `body` before the move aside). Both: stop at `items`, `w1` written into `notes`, `items` moved aside, `--to …_itemsm` stopped at `notes`, `notes` moved aside, `--to …_notesm` wrote `seed` again (count 1); the list gave 31. `r30j`: the pair is the same, no delete, `"keepExisting"`, 1 − 0 + (2 − 1) = 2, count 2. `r30k`: kept the application's version by `deleteOne({ _id: 31 })` on `notes`, `"keepExisting"`, 1 − 1 + 2 = 2, count 2, `body` is `app-changed`. Both then finished `items` (2 and 2), `db migrate` up to date, `db verify` passed.
- Round 29 case 2, time-series (`mkts29.sh`), with the new filter: `r30l` (same content): count 1 with `{ _id: 31, ts: …, value: 0 }` in `readings_kept`, deleted it, copied: 1 − 0 + 2 = 3, count 3. `r30m` (`value` 99 moved aside, 0 from the run): count 1 and deleted the run's 0 in `readings`, copied: 1 − 1 + 3 = 3, count 3, 31 holds 99 once. Both: list empty, `db verify` passed.

## Findings

### 54. The regular bullet of step 5 says to delete without the condition (low)

Step 5 says "If they differ, decide which one to keep; to keep the one in `items_kept`, delete the one in `items`." The next line, the regular-collection bullet, then reads "A regular collection: one document holds each `_id`, so delete the one in `items` with `db.getCollection("items").deleteOne({ _id: <the _id> })`. Then, if the list was empty, copy with …". On its own the bullet reads as an instruction for every listed `_id`. A user who decided to keep the document the run wrote (or found the pair the same) and follows the bullet deletes it, and `"keepExisting"` then copies the moved-aside one in its place: when the two differ, the version they chose is lost. "Then, if the list was empty" also reads oddly after a delete, since an empty list leaves nothing to delete. In `r30j` and `r30k` I read the bullet as applying only to the "keep the one in `items_kept`" case, which is what the text means, and both ended correctly. Starting the bullet with "A regular collection: if you keep the one in `items_kept`, delete …", as the time-series bullet already says "delete each document you do not keep", would remove the doubt. Where it lives: step 5 of "Moving a MongoDB collection aside" in `docs/reference/error-reference.md`.

## Notes, not findings

- The new step 6 bullet says "If a copy with `"fail"` stopped although that list was empty". Step 6 mentions two lists before it, its own list of documents not copied and "the list you made first in step 5", so a reader has to work out that "that list" is the second. "Count with that first list" then settles it. It also says "under those `_id`s" after "the `_id` it stopped on"; in `r30f` that is one `_id`. Both read correctly with a little care.
- The whole-document filter for a time-series delete was tested with flat fields only. With a `metaField` that is an embedded document, an equality filter on it needs the same field order as stored; copying the value from the `find` output gives that order, so the step as written still works.

## Cleanup

MongoDB is stopped. Scratch projects and helpers stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
