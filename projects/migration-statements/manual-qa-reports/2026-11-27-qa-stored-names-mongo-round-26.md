# Manual QA — stored-name renames on MongoDB, round 26

Date: 2026-11-27. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `0e854e4e7a`. Earlier round: `2026-11-27-qa-stored-names-mongo-round-25.md` in this folder. This round checks commit `0e854e4e7a` (moving a collection aside covers every existing collection the migration creates and ends with the command as it was run, and the running-copy check lists only copies into that collection of this database).

Status: done. No new findings. A migration that creates two collections that both exist and hold data names the second one in the refusal, and following the steps under "Moving a MongoDB collection aside" for both kept every document; the last step's `db migrate --to production` stopped where the ref points. The printed `$currentOp` query, run verbatim, lists only the copy, not the application's read aggregate on the same collection and not a copy in another database, and after `killOp` it lists nothing. A time-series collection with two documents sharing an `_id` keeps both through the new time-series copy aside and the copy back. Round 25's cases 1 and 3 still pass.

## Setup

- `dist` was current: the target package was built at 17:01, the commit is from 17:02, no source file is newer than `dist/control.mjs`, and it holds the new texts (`which already exists too`, `"command.$db"`). No build was run.
- MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end with the proxies.
- Round 18 to 25 helpers reused (`mk.sh`, `c.sh`, `cs.sh`, `p.sh`, `q.sh`, `mk18.sh`, `mkp24.sh`, `mkts25.sh`, `proxy25.mjs`, `stop25.sh`, `via20.sh`, `rehash20.mjs`, `stripsnap.mjs`). `proxy20.mjs` and `ext24.mjs` were not needed: no case this round stops a run by swallowing a reply, and no case uses an extension space. New:
  - `mkp26.sh`: base migration (`others`) applied under ref `production` with `change: ["migrate"]`; then migration `two` creates `items` (validator, unique `t_1`) and `notes` (validator, unique `code_1`), both creates with their after-check emptied; `three` renames the stored field `items.t` to `name`; `four` adds `extras`. Ref `production` then points at `three`'s contract. `items` (2 documents) and `notes` (3 documents) are put in place. Contracts `ctr/r26a1.prisma` to `ctr/r26a3.prisma`.
  - `cop26.mjs`: takes the `$currentOp` query out of the saved CLI text (or a file holding the documented one) and evaluates it word for word, with a `db` object that gives `getSiblingDB`, `getName` and `killOp` over the Node driver. It also prints every running aggregate, so what the query leaves out is visible.
  - `app26.mjs`: the application's slow read aggregate on a collection (`$unionWith` with a sleeping stage, ending in `$project`), and optionally a slow `$out` copy into a collection of the same name in another database.
  - `forms26.mjs`: slow `$merge: { into: "items" }` and `$out: { db, coll: "items_kept", timeseries }` copies, for the documented query's other forms.
- mongosh is not installed. Each `mongosh` step was run as the same server command through the Node driver.
- Projects `wip/qa-mongo/r26a`–`r26e`, plus database `r26q`.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1 | A migration creating two collections that both exist and hold data, with a `--to <ref>` run | `r26a` | ✅ |
| 2 | The `$currentOp` query, run as printed, beside an application read | `r26b`, `r26c`, `r26q` | ✅ |
| 3 | A time-series collection with two documents sharing an `_id` | `r26d` | ✅ |
| 4 | Regression: round 25 cases 1 and 3 | `r26e`, `r26b`, `r26c` | ✅ |

### 1. Two collections that both exist

`r26a`: `db migrate --to production` refused at `collection.items.create`. The text says, after the move-aside sentence for `items`: "This migration also creates collection notes, which already exists too: before you run db migrate --to 20261127T0605_two, move it aside the same way if it holds documents you need, or drop it if it holds nothing you need, so the run does not stop again at it." The closing line is "re-run `prisma db migrate --to production`", so it keeps the `--to`.

Following the section: step 2 renamed `items` to `items_kept` and `notes` to `notes_kept`. Step 3, `db migrate --to 20261127T0605_two`, created both with their validators and `t_1` and `code_1`, and stopped after `two`; both counted 0. Step 4: the `$nor` query over each validator found nothing, and the `$group` query on `t` and on `code` found no repeated value. Step 5: `$merge` with `whenMatched: "fail"` into each. Step 6: counts 2 and 2, 3 and 3; dropped both `_kept` collections. Step 7, the stopped command exactly as run, `db migrate --to production`, applied `three` only: the two `items` documents now have `name` in place of `t`, and the index is `name_1`. `four` stayed pending, as the ref asks. All five documents kept.

`migration status`: base, `two` and `three` applied, `four` pending, `@db` at `production`. `db verify` against the emitted contract (which includes `four`) reports a marker mismatch, as it should with `four` pending; against `three`'s contract it passed. A plain `db migrate` then applied `four`, and `db verify` passed.

### 2. The `$currentOp` query

- `r26b` (the time-series move from `mk18.sh`, with a stage that sleeps 8 seconds per document in the copy, the connection dropped 300 ms after the `$out` was forwarded). Before the run, `app26.mjs` started a 30-second read aggregate on `measurements` in `r26b`, and a slow `$out` into `measurements` in database `r26b_other`. The stop text prints the new query and says "connected to this database" and "run the query again until it lists nothing". Run verbatim right after the stop, it listed one operation: the `$out` aggregate of `r26b`. Not listed, while running: the read (`aggregate: "measurements"`, last stage `$project`), which round 25's query would have listed, and the other database's copy. Count 0 then. I ran it again every 2.5 seconds until it listed nothing (about 16 seconds); the read was still running then. Count 4. I ran the two deletes (2 and 2) and the command again. End: `measurements` holds 2, 3, 4, 5 once each, still time-series; `events` holds e1; the duplicates query finds nothing; `db verify` passed; the next plan: "No changes detected".
- `r26c` (the same, with the read running, ending the copy). The query listed only the copy; `killOp` on its `opid` returned "attempting to kill op". The query run again 300 ms later already listed nothing, and the read was still running, so `killOp` ended only the copy. Count 0, no temporary collection left. I ran the command again as it is. End as in `r26b`; `db verify` passed; no changes.
- `r26q` (the documented query with `"items"` replaced, against `forms26.mjs`): with `"items"` it listed only the `$merge: { into: "items" }` copy; with `"items_kept"` only the `$out: { db, coll: "items_kept", timeseries }` copy. The read aggregate on `items` was listed by neither.

### 3. Time-series documents sharing an `_id`

`r26d` (`mkts25.sh r26d migrate`, then a fourth document with `_id` 1, value 99, a different `ts`). The refusal is as in round 25, with no "also creates" sentence, since the migration creates one collection. Step 2's time-series form, `$out: { db, coll: "readings_kept", timeseries: <options.timeseries of readings> }`, made `readings_kept` time-series with the same `timeField`, `granularity` and `bucketMaxSpanSeconds`; counts 4 and 4, both `_id` 1 documents present; dropped `readings`. Step 3, `db migrate --to 20261127T0609_readings`, created time-series `readings`; count 0. Step 4: no validator, so the `$nor` query is skipped as the step now says. Step 5: `readings.aggregate([{ $unionWith: "readings_kept" }, { $out: "readings" }])`; counts 4 and 4, both `_id` 1 documents with their own `ts` and value; `readings` still time-series with the same options. Step 6: dropped `readings_kept`. Step 7: `db migrate`, the command as run. All four documents kept. Status up to date, both migrations applied; `db verify` passed.

For comparison, round 25's copy aside into a regular collection, `$out: "readings_regular"`, now fails on this data with an E11000 duplicate key error and creates nothing, so the new form is what keeps the second document.

### 4. Regression

- Round 25 case 1 (`r26e`, `mkp24.sh` with four documents: two sharing `t` "keep", one with `level` "medium"). Followed the section: renamed, `db migrate --to 20261127T0610_items`, step 4's queries found `_id` 3 and "keep" twice. To follow step 6's failure branch I copied back before fixing: `whenMatched: "fail"` stopped on DuplicateKey with 2 copied; after fixing `_id` 2, `keepExisting` stopped on "Document failed validation" with 3 copied; after fixing `_id` 3, it copied the rest: 4 and 4. Dropped `items_kept`, ran `db migrate`. All four kept, status up to date, `db verify` passed.
- Round 25 case 3 (the `$currentOp` check before counting, both the wait and the `killOp` branches) is repeated by `r26b` and `r26c` above, with the application's read added. Same end states as round 25.

## Findings

None.

## Notes, not findings

- The refusal's drop route ("If items holds nothing you need, drop it, then run the command again") does not mention `notes`. A user who takes it hits a second refusal naming `notes`, which gives the same choices, so nothing is lost; only the move-aside route names the other collections.
- In `r26c` the copy was already gone 300 ms after `killOp`, so I did not see a listing with `killPending`. The text's "run the query again until it lists nothing" covers the case anyway.
- The query was evaluated through the Node driver with a small `db` stand-in, not in mongosh. Its text was taken from the CLI output and the error reference without change.

## Cleanup

MongoDB, the proxies and the helper processes are stopped. Scratch projects and helpers stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
