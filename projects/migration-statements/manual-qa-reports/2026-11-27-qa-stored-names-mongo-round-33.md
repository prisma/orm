# Manual QA — stored-name renames on MongoDB, round 33

Date: 2026-11-27. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `b71895cb1c`. Earlier round: `2026-11-27-qa-stored-names-mongo-round-32.md` in this folder. This round checks the commits after `05bb985fd2`: the runner refusal for different collations is gone, and the printed route now gives every time-series move's `deleteDocuments` the target's collation, or `{ locale: "simple" }`; a copy the runner does not recognise that stops on a thrown error gives `MIGRATION.EXECUTION_FAILED` with advice to settle by hand (finding 55); the planner's own `$merge` move into a regular collection is recognised and reported as before.

Status: done. No new findings. The route prints the right collation for both collation pairs, and with it the copy and the delete select the same documents: every document was moved once, or, where my filter missed one, it stayed in the source and the validator change stopped on it. Finding 55 is fixed: the stopped `$limit` copy now gives `MIGRATION.EXECUTION_FAILED` and says not to run again until the collections are settled; following that left each document once. The interrupted planner `$merge` move is reported as `CLI.UNEXPECTED`, as before, and running again left each document once. The regressions pass.

## Setup

- `dist` is from commit `d0dae1107e`, as the brief says; the commits after it change only docs and JSON records. `control.mjs` holds the new route text ("the simple one, since collection") and the planner `$merge` check. No build was run.
- MongoDB 8.2.6, one-node replica set from mongodb-memory-server, started from a copy of the helpers so that it has its own URI file: `wip/qa-mongo/r33/` holds copies of the round 18 to 32 helpers and `ctr/`, with their paths pointed at `wip/qa-mongo/r33`, and `r33/db-uri.txt`. The original `wip/qa-mongo/db-uri.txt` was not touched. MongoDB and the proxies were stopped at the end.
- New helpers in `wip/qa-mongo/r33/`:
  - `mk33.sh <name> <A|B>`: round 32's `mk32.sh` up to the plan, with the plan output kept. `events` holds `e1` (an `Event`) and the `Measurement` documents 2 (`kind: "reading"`) and 3 (`kind: "Reading"`). Pair A: `events` has collation `en`/2, time-series `measurements` none. Pair B: the other way round.
  - `mv33As.txt`, `mv33Ai.txt`, `mv33Bs.txt`, `mv33Bi.txt`: the copy and delete as the route prints them, with filter `{ kind: "reading" }` (s) or an `$in` filter (i), and the collation the route names for the pair. `ins33.sh` inserts one after the create of `measurements` and runs `migration.ts`. `st33.sh` shows the end state.
  - `ctr/r33m0.ts`, `ctr/r33m1.ts`, `mk33m.sh`, `mv33m.txt`: the move of `Measurement` into a regular `measurements`, with the `$merge` copy the route prints.
  - `proxy33.mjs` and `stop33.sh`: `proxy20.mjs` and `stop21.sh` with the request text to watch for as an argument, so the proxy can stop a `$merge` (its log still says `$out`).
- mongosh is not installed. I ran each printed `mongosh` command as the same server command through the Node driver (`curop32.mjs`, `count32.mjs`).
- Projects `wip/qa-mongo/r33/r33*`.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1A | Time-series move, source case-insensitive, target simple: string filter, then `$in` filter | `r33a` | ✅ |
| 1B | Time-series move, source simple, target case-insensitive: string filter; `$in` filter | `r33b`; `r33c` | ✅ |
| 2 | QA 55 again: hand-written `$limit` copy, connection dropped | `r33j` | ✅ |
| 3 | Planner `$merge` move into a regular collection, interrupted | `r33m` | ✅ |
| 4 | Regression: round 32 cases 2 and 3 | `r33g`, `r33h`, `r33e`, `r33f` | ✅ |

### 1. A move into a time-series collection with each collation pair

`migration plan --rename Measurement:Reading` refuses, since `events` also stores `Event`, and prints the move route. The delete line now carries the collation:

- Pair A: `deleteDocuments({ collection: "events", filter: <the same filter>, collation: { locale: "simple" } })`, then "The $unionWith stage reads collection "events" with the collation of collection "measurements", so the delete selects with that collation too, the simple one, since collection "measurements" has none: with the collation of collection "events", it could remove documents the copy did not take, or leave documents it took."
- Pair B: `collation: { locale: "en", strength: 2 }`, and the same sentence without "the simple one".
- The "if the apply stops" sentence now says "with the same filter and collation". The old "db migrate refuses the copy" sentence is gone.

I wrote the copy and delete as printed, planned without `--rename`, and ran `migration.ts`. In `ops.json` the delete carries the collation.

1A (`r33a`, pair A). First the filter `{ kind: "reading" }`. `db migrate` copied 2 and deleted 2, and then the validator change on `events` stopped with `MIGRATION.PRECHECK_FAILED` on document 3 ("1 document in collection events does not fit the new validator"). Under the simple collation that the route names, my filter does not select `"Reading"`, so 3 was neither copied nor deleted: `events` held `e1` and 3, `measurements` held 2, nothing was lost. This is my filter, as the route explains. I changed both filters to `{ kind: { $in: ["reading", "Reading"] } }`, ran `migration.ts` and `db migrate`. The copy ran again: `measurements` kept 2 and added 3. End: `events` holds `e1`; `measurements` holds 2 and 3 once each (the duplicates query finds nothing), time-series, no collation. `migration status`: both migrations applied. `db verify` passed.

1B (`r33b`, pair B, `{ kind: "reading" }`). One `db migrate` applied 4 operations. The copy, read with `en`/2, took 2 and 3, and the delete with `en`/2 removed both. Without the collation the delete would have left 3 in `events` (round 32's premise check). End: `events` holds `e1`, `measurements` holds 2 and 3 once each, time-series with `en`/2. `db verify` passed.

1B `$in` (`r33c`, pair B, `{ kind: { $in: ["READING"] } }`). One `db migrate`. Both moved once, `events` holds `e1`, `db verify` passed.

### 2. QA 55: a hand-written `$limit` copy whose connection drops

`r33j`: the `mk18.sh` copy, with `{ $limit: 100 }` after the `$match` of its second `$unionWith` stage. `stop21.sh` dropped the connection when the `$out` answered. `db migrate` printed:

```text
✘ [MIGRATION.EXECUTION_FAILED] Operation data_transform.move Measurement and Sample documents to measurements failed: connection 1 to 127.0.0.1:55601 closed
  why: Operation data_transform.move Measurement and Sample documents to measurements writes into collection measurements with an aggregate that ends in $out, and the error does not show whether it finished: it may have. Before you do anything else, first check that it is no longer running: … Then compare collection measurements with the collections the operation reads by hand, and settle which documents each should keep. Do not run the command again until you have: the run would copy the documents again, and could write them into collection measurements a second time. The operations that ran before the failure stay applied.
```

The error reference says the same in `MIGRATION.EXECUTION_FAILED`: any other `dataTransform` whose aggregate writes with `$out` or `$merge`, "such as a copy with a `$limit` or `$project` after its `$match`", gets this failure, with no count.

Following it: the printed `$currentOp` query listed nothing. `measurements` held 2, 3, 4 and 5, and `events` still held all five, so the copy had finished. I deleted 2, 3, 4 and 5 from `events` and ran `db migrate`. It succeeded; the copy ran again and added nothing. End: `events` holds `e1`, `measurements` holds 2 to 5 once each, time-series; `db verify` passed; the next plan finds no changes.

### 3. The planner's `$merge` move into a regular collection, interrupted

`r33m`: `Measurement` moves from `events` into a new regular `measurements`. The route prints `rawAggregate("events", [{ $match: <filter> }, { $merge: { into: "measurements" } }])` and a `deleteDocuments` with the same filter and no collation. I used `{ v: { $exists: true } }` and dropped the connection when the `$merge` answered. `db migrate` printed:

```text
✘ [CLI.UNEXPECTED] Unexpected error
  why: Unexpected error during migrate: connection 1 to 127.0.0.1:55602 closed
→ Check the error message and try again
```

That is as before, and as the error reference says: this copy "gets no such failure: its `$merge` matches each document by `_id`, so a re-run writes no document a second time". At that point `measurements` held 2 and 3 and `events` still held all three. I ran `db migrate` again, as the message allows. It succeeded. End: `events` holds `e1`, `measurements` holds 2 and 3 once each (a regular collection, so `_id` is unique anyway); `db verify` passed; the next plan finds no changes.

### 4. Regression: round 32 cases 2 and 3

- `r33g` (round 32 `r32g`): the `mk18.sh` copy finished, then I deleted 3 from `measurements` to stand for another write. `MIGRATION.EXECUTION_FAILED`, with the counted advice ("If it holds 4", "If it holds 0"), and its delete step now says "with the filter and collation of its deleteDocuments call". The printed majority count gave 3, so I settled by hand: kept `e1` and 3 in `events`, deleted 2, 4 and 5. The rerun copied 3 and deleted it. End: `events` `e1`, `measurements` 2 to 5 once each, `db verify` passed, next plan no changes.
- `r33h` (round 32 `r32h`, pair A, filter `{ v: { $exists: true } }`, the delete with `collation: { locale: "simple" }` as the route now prints): since the collations differ, the advice has no counts ("the runner has no count of the documents from before it that could show it") and says to settle by hand. `measurements` held 2 and 3, so I deleted 2 and 3 from `events`. The rerun added nothing. End: `events` `e1`, `measurements` 2 and 3 once each, `db verify` passed.
- `r33e` (round 32 `r32e`, stop after the `$out` committed): `MIGRATION.EXECUTION_FAILED`. The printed majority count sent `readConcern: { level: "majority" }` and gave 4, "the copy finished". I ran both deletes by hand (2 and 2) and the command again. End: `events` `e1`, `measurements` 2 to 5 once each, `db verify` passed, next plan no changes.
- `r33f` (round 32 `r32f`, the `$out` request dropped unsent): the count gave 0, and 0 again 2 seconds later. I ran the command again as it is. Same end state as `r33e`.

## Findings

None.

## Notes, not findings

- In 1A, `{ kind: "reading" }` under the simple collation selects only the lowercase document, so the move left document 3 behind and the validator change stopped on it. The route says the copy and the delete both select with the target's collation, so this is the filter I wrote, and the copy and delete agreed: nothing was lost. The validator failure's advice talks about fixing the document or turning off `checkDocuments`, not about the filter of the move. A user who wrote a filter that misses documents has to work that out from the document it names.
- For the interrupted `$merge` move, `CLI.UNEXPECTED` says only "Check the error message and try again", and trying again is safe. The route for that move also says "Check first that no _id is in both collections". After an interrupted copy, the copied `_id`s are in both, so a user who rereads the route before running again would find them and may think the rerun is unsafe. It is safe, since `$merge` writes each one onto itself, but nothing printed says so.
- The uncounted settle-by-hand text (`r33h`) describes the next run's delete from `events` without saying it selects with the target's collation. When settling by `_id`, as I did, that does not matter.
- I sent the printed `mongosh` commands through the Node driver, not mongosh.

## Cleanup

MongoDB (port 55459) and the proxies are stopped. Scratch projects and helpers stay under `wip/qa-mongo/r33/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
