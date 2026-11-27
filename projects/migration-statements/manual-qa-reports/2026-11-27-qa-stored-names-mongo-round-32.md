# Manual QA — stored-name renames on MongoDB, round 32

Date: 2026-11-27. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `05bb985fd2` (merges `origin/main` into `301016a5b4`). Earlier round: `2026-11-27-qa-stored-names-mongo-round-31.md` in this folder. This round checks the four commits after `afdd6a4d3f`: the count advice reads with majority read concern, a failed count read no longer blocks the copy, a copy with an after-check or with a stage other than `$set`, `$addFields` or `$unset` after its `$match` gets no count advice, a filtered move keeps the documents outside its filter, and `db migrate` refuses a time-series move copy whose filter compares strings when the two collections have different collations.

Status: done. One new finding (55). The collation refusal works for both collation pairs, the printed route leads to a migration that moves every document once, and a move with the same collation still runs. The filtered settle-by-hand advice kept the documents that stay in the source. The printed majority count sends `readConcern: majority` and gives the right number. The regressions pass. Finding 55: a hand-written copy with any other stage after its `$match`, such as `$limit` or `$project`, now falls outside the copies the runner recognises, so a dropped connection during it is reported as `CLI.UNEXPECTED` with "Check the error message and try again". Trying again copies every moved document a second time, and `db verify` passes.

## Setup

- `dist` was built at the commit: `packages/3-targets/mongo/1-target/dist/control.mjs` is from 20:08, the commit from 20:07, and it holds the new texts (`was not run: collections`, `readConcern: { level: "majority" }`). No build was run.
- MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end with the proxies.
- Round 18 to 31 helpers reused (`mk.sh`, `mkts.sh`, `c.sh`, `cs.sh`, `p.sh`, `q.sh`, `mk18.sh`, `ins18.py`, `stop21.sh`, `proxy20.mjs`, `via20.sh`, `ins-move.mjs`, `pre31run.sh`, `fin31.sh`, `s31.sh`, `step31.mjs`, `leg31.sh`, `mkp29l.sh`, the round 31 fixtures). New:
  - `ctr/r32A0.ts` … `ctr/r32S1.ts`: `events` stores `Event` and `Measurement`; the change moves `Measurement` (renamed `Reading`) into time-series `measurements`. Pair A: `events` has collation `{ locale: "en", strength: 2 }`, `measurements` none. Pair B: the other way round. Pair C: both `en`/2. Pair S: `events` has `{ locale: "simple" }`, `measurements` none.
  - `mk32.sh <name> <pair> <filter>`: `events` holds `e1` (an `Event`) and the `Measurement` documents `_id` 2 (`kind: "reading"`) and 3 (`kind: "Reading"`). It plans the change, adds the copy and its delete after the create of `measurements` from `mv32s.txt` (`{ kind: "reading" }`), `mv32n.txt` (`{ v: { $exists: true } }`), `mv32t.txt` (`{ kind: { $type: "string" } }`) or `mv32m.txt` (two `$unionWith` stages, one with `$in: ["Reading"]`), and runs `migration.ts`.
  - `fix32.sh`: rewrites both filters as the refusal says, runs `migration.ts`, `db migrate`, shows the end state, `migration status` and `db verify`. `run32.sh`: `mk32.sh`, one `db migrate`, the end state and `db verify`.
  - `probe32.mjs`: in a scratch database, shows which documents a `$unionWith` copy and a find on the source select under each collation pair.
  - `count32.mjs`: the printed `$currentOp` check and the printed majority count, with command monitoring to show the read concern sent. `curop32.mjs`: the longer `$currentOp` query that the uncounted-copy advice prints. `end32e.sh`: the end state of an `mk18.sh` project, `db verify` and the next plan.
  - `x32.sh`: round 31 case 1A, order 1, plus keeping both twins. `r32w.sh`: `r31.sh` with new project names.
- mongosh is not installed. I ran each `mongosh` command as the same server command through the Node driver.
- Projects `wip/qa-mongo/r32*`.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1A | Collation refusal, source case-insensitive, then the route | `r32a` | ✅ |
| 1B | Collation refusal, target case-insensitive, then the route | `r32b` | ✅ |
| 1C | Same collation, string filter, runs | `r32c` | ✅ |
| 1D | Other filters and collations: `$type`, two stages, explicit simple, planner route | `r32t`, `r32m`, `r32s`, `r32rb`, `r32rc`, `r32rs` | ✅ |
| 2 | Filtered move from a shared collection, settled by hand | `r32g`, `r32h`; `r32j` | ✅; ❌ finding 55 |
| 3 | The majority count, live | `r32e`, `r32f` | ✅ |
| 4 | Regression: round 31 case 1, round 29 case 1 | `r32x1p`, `r32x1q`, `r32x1b`, `r32w1p`, `r32w1q`, `r32w2p`, `r32w2q`, `r32la`, `r32lb` | ✅ |

### 1. The collation refusal

First I checked the premise in a scratch database (`probe32.mjs`), with `kind: "reading"` as the filter and documents 2 (`"reading"`) and 3 (`"Reading"`):

| `events` | `measurements` | The `$unionWith` copy selects | A find on `events` selects |
| -------- | -------------- | ----------------------------- | -------------------------- |
| `en`/2 | none | 2 | 2, 3 |
| none | `en`/2 | 2, 3 | 2 |
| `en`/2 | `en`/2 | 2, 3 | 2, 3 |

So, without the refusal, pair A deletes document 3 without copying it, and pair B copies 3 and leaves it in `events` too.

`migration plan --rename Measurement:Reading` refuses, since `events` also stores `Event`, and prints the move route. For pairs A and B the route adds: "Collections "events" and "measurements" have different collations. … So write the filter so that it compares no string, for example { <a field only those models store>: { $exists: true } } … db migrate refuses the copy if its filter compares a string." For pairs C and S it says nothing of collations.

1A (`r32a`, pair A, filter `{ kind: "reading" }`). `db migrate` stopped with `MIGRATION.PRECHECK_FAILED`: "Operation data_transform.move Measurement to measurements was not run: collections measurements and events have different collations, and the filter of its $unionWith stage compares strings". The `why` says to write the filter of the copy and of its delete so it compares no string, run the file with node, and run the command again. `events` still held `e1`, 2 and 3 with no change. The create of `measurements`, the operation before the copy, had run: `measurements` existed and was empty (see notes). `migration status` showed the migration pending. Following the route, I changed both filters to `{ v: { $exists: true } }`, ran `migration.ts` and `db migrate`. It applied 4 operations. `events` holds `e1`; `measurements` holds 2 and 3, each once (the duplicates query finds nothing), and is time-series with no collation. Status: both migrations applied. `db verify` passed.

1B (`r32b`, pair B). The planner's draft creates `measurements` with the collation. The same refusal, nothing moved. After the same rewrite, `db migrate` succeeded: `events` holds `e1`, `measurements` holds 2 and 3 once each, time-series with collation `en`/2. `db verify` passed.

1C (`r32c`, pair C, filter `{ kind: "reading" }`). No refusal. The migration applied, both 2 and 3 moved (the shared collation matches both), `events` holds `e1`, `db verify` passed.

1D. Further checks:

- `r32t` (pair A, `{ kind: { $type: "string" } }`): no refusal, since `$type` names a type. Both moved, `db verify` passed.
- `r32m` (pair A, two `$unionWith` stages, the second with `kind: { $in: ["Reading"] }`): refused, with the plural wording ("a filter of its $unionWith stages compares strings", "write the filters of the copy and of its deletes").
- `r32s` (pair S, `events` created with `{ locale: "simple" }`): no refusal. MongoDB stores no collation for `simple`, so both collections compare alike. The filter `{ kind: "reading" }` then selects only 2 in both the copy and the delete, so nothing is lost, and the validator change stops on 3, which stays in `events`. That is the filter I wrote, not a fault.

### 2. A filtered move from a shared collection, settled by hand

`mk18.sh`: `events` holds `e1` (an `Event`), 2 and 3 (`v`), 4 and 5 (`w`). The copy has two filters, `v` and `w`, with two deletes. `stop21.sh` drops the connection when the `$out` answers.

- `r32g`: the copy finished, then I deleted 3 from `measurements` to stand for another write. The printed count gives 3, which is neither 0 nor 4, so the advice is to settle by hand: "leave in collection events every document the copy does not select, and of those it selects only the ones that collection measurements does not hold yet". So I kept `e1` (not selected) and 3 (selected, not in `measurements`) and deleted 2, 4 and 5 from `events`. The rerun copied 3 and deleted it from `events`. End: `events` holds `e1`, `measurements` holds 2, 3, 4, 5 once each, time-series, `db verify` passed, the next plan finds no changes.
- `r32h` (pair A, filter `{ v: { $exists: true } }`, the copy finished): since the collations differ, the runner read no counts, and the new text says so: "The error does not show whether the copy finished, and the runner has no count of the documents from before it that could show it." It gives the `$currentOp` query (which, run as printed, listed nothing) and then the same settle-by-hand advice. `measurements` held 2 and 3, so I deleted only 2 and 3 from `events` and kept `e1`. The rerun copied nothing more. End: `events` `e1`, `measurements` 2 and 3 once each, `db verify` passed.
- `r32j` (the `mk18.sh` copy with `{ $limit: 100 }` after one `$match`, the copy finished): finding 55.

### 3. The majority count, live

The stopped-copy text now says to count "the documents of collection measurements that a majority of the replica set has written, which a failover cannot roll back, for example with db.getCollection("measurements").countDocuments({}, { readConcern: { level: "majority" } })".

- `r32e` (stop after the copy committed): `count32.mjs` ran the `$currentOp` check (nothing listed) and the count. Command monitoring shows the count's aggregate sent `readConcern: { level: "majority" }`. It gave 4, which the text names as "the copy finished". I ran both deletes by hand (2 and 2) and the command again. End: `events` `e1`; `measurements` 2, 3, 4, 5 once each; `db verify` passed; next plan no changes.
- `r32f` (the `$out` request dropped unsent): the count gave 0. The text now says that a majority count can lag, "wait a moment and count again". Counted again 2 seconds later: 0. I ran the command again as it is. Same end state as `r32e`.

### 4. Regression

- Round 31 case 1A (`x32.sh`, order 1). `r32x1p`: the filter for Q counted 1 and deleted it; step 6 gave 2 − 0 + 3 = 5, and the count was 5. `r32x1q`: the filter for P counted 2, `note: { $exists: false }` made it 1, and it deleted P; 5 and 5. The new step 5 branch, `r32x1b`, keeps both twins: I deleted nothing, the copy added both, and step 6 gives 2 − 0 + 4 = 6, the count. `readings` holds both twins and the run's two documents under `_id` 31. In all three, the step 6 list was empty, `db migrate` and `db verify` succeeded, and `readings` is still time-series.
- Round 31 case 1D (`r32w.sh`, both orders, keeping each twin): in all four the filter counted 2, then 1 after narrowing, `deleteOne` deleted one, and 2 − 1 + 3 = 4 matched the count. The first run of `r32w2q` failed in my helper with `DRIVER.CONNECTION_FAILED` while the machine was under load from other sessions; I ran it again and it passed as the others did.
- Round 29 case 1A (`r32la`) and 1B (`r32lb`): as in round 31. 1A stopped at `items`, then at `orders` with "Drop orders only if it holds nothing you need, even when an earlier run of this command created it"; both copies back gave 3 and 3, and 2 and 2. 1B stopped at `c_1`, then at `orders`, copy back 3 and 3, and `c_1` was built. Both end with `db migrate` up to date and `db verify` passing.

## Findings

### 55. A stopped hand-written copy with an extra stage is reported as an unexpected error, and trying again duplicates every moved document

`r32j`: the copy is the one `mk18.sh` writes, with `{ $limit: 100 }` after the `$match` of its second `$unionWith` stage. I dropped the connection after the `$out` committed. `db migrate` printed:

```text
✘ [CLI.UNEXPECTED] Unexpected error
  why: Unexpected error during migrate: connection 1 to 127.0.0.1:54365 closed
→ Check the error message and try again
```

It does not say that a copy was running, that it has no check, or that it runs again. The majority count gave 4, so the copy had finished. I ran `db migrate` again, as the message says. It succeeded: `measurements` then held 2, 3, 4 and 5 twice each (the duplicates query finds all four `_id`s), `events` held `e1`, `db verify` passed and the next plan found no changes. Nothing reports the duplicates.

Cause: since `27d6727205`, `unionCopyOf` in `mongo-out-copy-reruns.ts` recognises a copy only when every stage after its `$match` is `$set`, `$addFields` or `$unset` (`REWRITE_STAGES`). At `afdd6a4d3f` it accepted any stages after the `$match`, so this copy got the count advice. Now `outCopyRerunText` gives no text, and `MongoMigrationRunner.execute` then rethrows the driver error (`if (text === undefined || stopped === undefined) throw error;`), which the CLI reports as `CLI.UNEXPECTED`. The error reference says this: an error thrown by an operation is reported as it is, except after a copy that `migration plan` prints. The same applies to `$project`, `$sort`, `$limit` or a second `$match`, which a user may well add, since the route only says to write the copy with a `$match`.

Why it matters: a time-series collection keeps documents that share an `_id`, so the duplicates are silent. The text a user reads is the one that leads to them. Before this change they got the advice.

Suggestion: when a `dataTransform` that ends in `$out` (or `$merge`) and reads another collection with `$unionWith` stops because of a thrown error, report it as `MIGRATION.EXECUTION_FAILED`, even when the runner cannot read counts for it. Give the uncounted advice: check that the copy has ended, then settle by hand before running again. The runner already has this text (`uncountedCopyText`). At the least, say that the copy has no check and runs again.

## Notes, not findings

- The collation refusal comes at the copy, so the operations before it in the same migration have already run. In `r32a` and `r32b` the create of `measurements` had run and left an empty collection. The text says so ("The operations that ran before the failure stay applied", "operations that already ran are skipped"), and the rerun after the rewrite skipped the create. No document moved before the refusal. A check before the first operation would leave the database unchanged, but nothing here goes wrong.
- When the two collections' collations differ, the runner never reads counts, even for a filter that compares no string. That is the only kind of filter it lets run in that case. So a move between collections with different collations that stops always falls to settling by hand (`r32h`), though the counts would be right for such a filter.
- The text for a count of 0 that stays 0 says the copy may still have finished and "the query below finds them", meaning the duplicates query. It says how to find duplicates but not how to remove one copy of a document, since a delete by `_id` in a time-series collection removes both. I did not test this branch here.
- I sent the majority count through the Node driver, not mongosh, so I did not check that mongosh passes `readConcern` on to the server.

## Cleanup

MongoDB and the proxies are stopped. Scratch projects and helpers stay under `wip/qa-mongo/` (gitignored). Three empty stray files that a mistyped loop created (`r32c C s-run.txt` and two like it) were deleted. No tracked file other than this report was changed, and nothing was committed.
