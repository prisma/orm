# Manual QA — stored-name renames on MongoDB, round 31

Date: 2026-11-27. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `afdd6a4d3f`. Earlier round: `2026-11-27-qa-stored-names-mongo-round-30.md` in this folder. This round checks commit `afdd6a4d3f`, which changes only steps 5 and 6 of "Moving a MongoDB collection aside" in `docs/reference/error-reference.md`: a time-series delete whose filter counts more than 1 is narrowed with `<field>: { $exists: false }` and `<field>: { $type: "null" }` until it counts 1, and a count of 0 means the filter was typed wrong; the regular-collection bullet now says to delete the document in `items` only for an `_id` where you keep the one in `items_kept`; the step 6 bullet for a `"fail"` copy that stops after an empty list is reworded.

Status: done. No new findings. In every case, following step 5 as written deleted only the document I chose not to keep, the step 6 count rule gave the number `countDocuments()` showed, the step 6 list was empty, `db migrate` succeeded and `db verify` passed. Finding 54 is fixed.

## Setup

- `dist` was current: since round 30's commit `edb849fdb1`, only `docs/reference/error-reference.md` and two project documents changed, and `packages/3-targets/mongo/1-target/dist/control.mjs` holds round 30's text. No build was run.
- MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end. No proxy was needed.
- Round 18 to 30 helpers reused (`mk.sh`, `c.sh`, `cs.sh`, `p.sh`, `q.sh`, `mkp27.sh`, `mkp28s.sh`, `mkp29l.sh`, `ts-aside30.sh`, `step29.mjs`, `step30.mjs`, `ins-move.mjs`, `rehash20.mjs`). New:
  - `gen31.mjs` writes the twin fixtures: `pre31X1/2.txt`, `pre31N1/2.txt`, `pre31M1/2.txt` (the documents of `readings` before the run, the twins in each insert order), `pre31R.txt`, and `seedts31R1/2.txt` (a run that writes the twins).
  - `mkts31.sh`: as `mkts30.sh`, with the seed, the documents before the run and the `timeseries` options as arguments.
  - `pre31run.sh`: `mkts31.sh`, the first stop, step 2, step 3 (`--to …_readm`), the count, `$nor`, the step 5 list and `find` of both collections.
  - `step31.mjs` (through `s31.sh`): `step30.mjs` plus `findf`, which runs `find(<filter>)` on either collection.
  - `fin31.sh`: the time-series copy, step 6's list and count, the documents under `_id` 31, the drop, `db migrate`, `db verify`, and the collection type.
  - `m31.sh`, `r31.sh`, `reg31.sh`, `fail31.sh`, `leg31.sh`: the runs of cases 1C, 1D, 2, 3A and 3B.
- mongosh is not installed. Each `mongosh` step was run as the same server command through the Node driver.
- Projects `wip/qa-mongo/r31*`. Two stray log files with spaces in their names (`r31gb app-changed kept-*.txt`, `r31gc seed run-*.txt`) come from a mistyped shell loop; they hold only errors and were left in `wip/`.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1A | Time-series twins: one has an extra field | `r31x1p`, `r31x1q`, `r31x2p`, `r31x2q`, control `r31xc` | ✅ |
| 1B | Time-series twins: `null` against a missing field, in `readings_kept` | `r31n1p`, `r31n1q`, `r31n2p`, `r31n2q` | ✅ |
| 1C | Time-series twins: a nested meta field | `r31m1p`, `r31m1q`, `r31m2p`, `r31m2q` | ✅ |
| 1D | Time-series twins written by the run, in `readings` | `r31r1p`, `r31r1q`, `r31r2p`, `r31r2q` | ✅ |
| 2 | The regular-collection bullet (finding 54) | `r31ga`, `r31gb`, `r31gc` | ✅ fixed |
| 3 | Regression: round 30 case 2, round 29 case 1 | `r31hf`, `r31hg`, `r31ia`, `r31ib` | ✅ |

### 1. Twins under one `_id`, time-series

In each project, `db migrate` refused at `collection.readings.create`. Step 2 copied `readings` into time-series `readings_kept` with the same `timeseries` options (4 and 4) and dropped `readings`. Step 3, `--to …_readm`, created `readings` and wrote the run's documents under `_id` 31; I noted the count. `$nor` reports no validator. The step 5 list showed `_id` 31, and `find({ _id: 31 })` showed both collections. In cases 1A to 1C, `readings_kept` held the twins (`value` 7, `ts` 2026-02-01) and `readings` held the run's `value` 0 and 5, which differ from them, so I kept both of the run's documents and one twin. For each document I did not keep, I wrote the filter from the `find` output with every field, counted, and narrowed it as step 5 says when the count was more than 1. Then I ran `deleteOne`, checked `deletedCount: 1`, and copied with `$unionWith`/`$out`. "Order 1" and "order 2" are the two insert orders of the twins. The ending `p` or `q` says which twin was kept.

1A. Twins `P = { _id: 31, ts, value: 7 }` and `Q = { …, value: 7, note: "x" }`.
- Keep P (`r31x1p`, `r31x2p`): the filter for Q, `{ _id: oid(31), ts: ISODate(…), note: "x", value: 7 }`, counted 1 at once and deleted Q.
- Keep Q (`r31x1q`, `r31x2q`): the filter for P counted 2, and `find(<filter>)` showed P and Q. Q has `note`, which P lacks, so I added `note: { $exists: false }`. It then counted 1 and deleted P.
- Control `r31xc` (order 2, keep Q): `deleteOne` with the filter that counted 2 deleted Q, the document I meant to keep. The narrowing is needed.

1B. Twins `P = { …, value: 7, note: null }` and `Q = { …, value: 7 }`.
- Keep P (`r31n1p`, `r31n2p`): the filter for Q counted 2, and `find` showed P with `note: null`. P has `note`, which Q lacks, so I added `note: { $exists: false }`. It counted 1 and deleted Q.
- Keep Q (`r31n1q`, `r31n2q`): the filter for P, `{ …, note: null }`, counted 2, since `null` also matches the missing field. Following step 5, I wrote `note: { $type: "null" }` in place of `note: null`. It counted 1 and deleted P.

1C. `readings` before the run had `metaField: "m"`, and `readings_kept` got the same (`{ timeField: "ts", metaField: "m", granularity: "hours" }`). Twins `P = { …, value: 7, m: { s: "a" } }` and `Q = { …, value: 7, m: { s: "a", z: 1 } }`.
- Keep P (`r31m1p`, `r31m2p`): to try the count-0 sentence, I first typed Q's meta as `m: { z: 1, s: "a" }`. The count gave 0, as step 5 says it can. After I copied the filter from `find` again (`m: { s: "a", z: 1 }`), it counted 1 and deleted Q.
- Keep Q (`r31m1q`, `r31m2q`): the filter for P counted 1 at once, since equality on an embedded document matches the whole document, and deleted P.
- A probe in a scratch database showed that MongoDB sorts the keys of a time-series meta field when it stores them: a document inserted with `m: { z: 1, s: "a" }` is shown by `find` as `m: { s: "a", z: 1 }`. So a filter copied from `find` matches. One typed from the application's own code may not, and the count-0 sentence covers that case.

1D. The run itself writes twins under 31 into `readings`: `{ …, value: 0, note: null }` and `{ …, value: 0 }`, in both orders (`seedts31R1/2.txt`). `readings_kept` holds `_id` 1, 2 and 31 with `value` 9. I kept 9 and one twin, and deleted the other twin from `readings`, narrowing as in 1B. In all four projects the filter counted 2, then 1, and `deleteOne` deleted the twin I did not keep.

Step 6 in every project of case 1:

| Case | Noted in step 3 | Deleted from `readings` | In `readings_kept` at the copy | Rule | `countDocuments()` |
| ---- | --------------- | ----------------------- | ------------------------------ | ---- | ------------------ |
| 1A, 1B, 1C | 2 | 0 | 3 | 2 − 0 + 3 = 5 | 5 |
| 1D | 2 | 1 | 3 | 2 − 1 + 3 = 4 | 4 |

In every project the step 6 list was empty, `_id` 31 held exactly the documents I chose, each once, `readings_kept` was dropped, `db migrate` succeeded, `db verify` passed, and `readings` is still time-series.

### 2. The regular-collection bullet (finding 54)

`reg31.sh`: `mkp28s.sh` (`notesm` creates `notes` and writes `seed` under `_id` 31; `itemsm` creates `items`, which exists with 2 documents). Before the first run, `notes` exists with `{ _id: 31, body: <given>, code: "seed" }` and `{ _id: 32, body: "w1", code: "w1" }`. `db migrate` refused at `collection.notes.create`. I renamed `notes` to `notes_kept`. `--to …_notesm` wrote `seed` again (count 1). `collMod`, `$nor` and the `code` duplicates check found nothing. The list gave 31.

- `r31ga`, the pair differs (`body` `app-changed` moved aside, `seed` from the run), and I keep the run's. The bullet now says "Where you keep the one in `items`, or the two are the same, delete nothing", so I deleted nothing. The list was not empty, so I copied with `"keepExisting"`. Step 6: 1 − 0 + (2 − 1) = 2, and the count is 2. `notes` holds the run's `seed` and `w1`.
- `r31gb`, the same pair, and I keep the moved-aside one. "Delete the one in `items` only for an `_id` where you keep the one in `items_kept`": I ran `deleteOne({ _id: 31 })` on `notes` (`deletedCount: 1`), then `"keepExisting"`. Step 6: 1 − 1 + 2 = 2, and the count is 2. `notes` holds `app-changed` and `w1`.
- `r31gc`, the two are the same. I deleted nothing and used `"keepExisting"`: 2, and the count is 2.

In all three I dropped `notes_kept`. `db migrate` then refused at `items` (as `mkp28s.sh` sets up), so I moved `items` aside, ran `--to …_itemsm` (count 0), got an empty list, and the `"fail"` copy gave 2 and 2. Then `db migrate` was up to date, all three migrations show applied, and `db verify` passed. Read cold, the bullet now states its condition, and both branches of the choice are spelled out. Finding 54 is fixed.

### 3. Regression

- Round 30 case 2 (`fail31.sh`, `mkp27.sh`): `db migrate` stopped at `items`; I renamed it `items_kept`. `--to …_itemsm` stopped at `notes`, which was empty, so I dropped it and ran `--to …_itemsm` again (count 0). The list was empty. Then I inserted a stray `{ _id: 2, t: "stray", level: "low", tags: [] }` into `items`. My first try at this omitted `level` and `tags`, and the validator rejected it, so I reran both projects with a valid document. The `"fail"` copy copied `_id` 1 and stopped on a duplicate key for 2.
  - `r31hf`: I kept the moved-aside 2 by deleting 2 from `items`, then copied with `"keepExisting"`. The reworded bullet says to count with the first list in step 5 (empty) and not to subtract the document deleted under that `_id`: 0 − 0 + 2 = 2, and the count is 2.
  - `r31hg`: I kept the stray and deleted nothing: 0 + 2 = 2, and the count is 2.
  - In both, the step 6 list was empty, `db migrate` was up to date and `db verify` passed. The new wording ("the first list in step 5", "the document … under that `_id`") removes the "that list" and "those `_id`s" doubts noted in round 30.
- Round 29 case 1A (`r31ia`): `db migrate` moved the 3 `legacy` documents into `orders` and refused at `collection.items.create`. I moved `items` aside. `--to …_movem` refused at `collection.orders.create` with "Drop orders only if it holds nothing you need, even when an earlier run of this command created it". I moved `orders` aside and ran `--to …_ordersm` (count 0). The list was empty, and `"fail"` copied 3 (3 and 3). Then `--to …_movem` created `items`, and its copy gave 2 and 2. After that, `db migrate` was up to date and `db verify` passed. `orders` holds `a`, `a` and `b` under their original `_id`s.
- Round 29 case 1B (`r31ib`): the unique index `c_1` failed on the two `a` values. I changed `_id` 12 to `a2`. `db migrate` refused at `orders` with the same drop sentence. I moved `orders` aside and ran `--to …_ordersm`; the copy gave 3 and 3. Then `db migrate` built `c_1`, and `db verify` passed.

## Findings

None. Findings 54 and earlier are fixed or were closed in earlier rounds.

## Notes, not findings

- The narrowing rule names two cases: a field that a match has and the document to delete lacks, and a field that holds `null`. Every twin pair tested needed at most one added condition. A pair can need both. For example, to delete `{ a: null }` against `{ a: null, b: 1 }`, the user writes `a: { $type: "null" }` and adds `b: { $exists: false }`. The text allows both, since it says "for each field".
- The sentence "If `find` shows that the matches are the same in every field, it does not matter which one goes" covers twins that differ only in the key order of a meta field, because MongoDB stores such twins identically (see 1C).

## Cleanup

MongoDB is stopped. Another session's mongod (port 54246, under `wip/qa-mongo/r44`) was running and was left alone. Scratch projects and helpers stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
