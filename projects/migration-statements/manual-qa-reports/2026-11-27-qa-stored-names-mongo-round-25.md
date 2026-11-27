# Manual QA — stored-name renames on MongoDB, round 25

Date: 2026-11-27. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `5e85945bba`. Earlier round: `2026-11-27-qa-stored-names-mongo-round-24.md` in this folder. This round checks commit `5e85945bba` (moving a collection aside follows steps in the error reference, a copy that may still run is checked before its count, and the runner guards the marker with the one policies option).

Status: done. Findings 47 and 48 are fixed. I followed the section "Moving a MongoDB collection aside" in `docs/reference/error-reference.md` exactly as written, for a regular collection with a validator and a unique index the documents break, with a later migration pending, for a time-series collection, and for an extension space. Every document was kept, `db migrate` succeeded, `migration status` marked every migration applied and `db verify` passed. The printed `$currentOp` command shows a copy that still runs after its connection drops, and both ways on (wait, or `killOp`) led to the right count and end state. No new findings.

## Setup

- `dist` was current: the target package was built at 16:33, the commit is from 16:35, no source file is newer, and `dist/control.mjs` holds the new texts (`Moving a MongoDB collection aside`, `$currentOp`). No build was run.
- MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end with the proxies.
- Round 18 to 24 helpers reused (`mk.sh`, `c.sh`, `cs.sh`, `p.sh`, `q.sh`, `mk18.sh`, `mkp24.sh`, `stop21.sh`, `proxy20.mjs`, `via20.sh`, `rehash20.mjs`, `stripsnap.mjs`, `ext24.mjs`). New:
  - `mkts25.sh`: like `mkp23.sh`, for a TypeScript contract. A base migration (`others`) is applied under a ref with the given change policy, then a migration creates time-series `readings` (validator stripped, after-check emptied), and a time-series `readings` with 3 documents is put in place.
  - `ctr/r25b1.prisma` (`r24u.prisma` with `title` stored as `name`), `ctr/r25c0.ts`, `ctr/r25c1.ts`.
  - `proxy25.mjs`: forwards the first `$out` request, then drops that connection a set number of milliseconds later, while the server still runs it. `stop25.sh` runs `db migrate` through it. `cop25.sh` runs the printed `$currentOp` command and the count.
- mongosh is not installed. I ran each printed `mongosh` command as the same server command through the Node driver (`q.sh`), changing only the syntax.
- Projects `wip/qa-mongo/r25a`–`r25k`.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1 | The move-aside section, followed as written | `r25a`–`r25d` | ✅ |
| 2 | An extension space on a database that permits only migrations | `r25h` | ✅ |
| 3 | The `$currentOp` check before counting | `r25e`–`r25g` | ✅ |
| 4 | Regression: round 24 case 1 | `r25i`–`r25k` | ✅ |

### 1. The move-aside section

The refusal on a database that permits only migrations now reads, for `items`: "If items holds documents you need, you can keep them by moving the collection aside: stop the application's writes to it, move it to items_kept, run db migrate --to 20261127T0538_items so this migration creates items with its options, and copy the documents back. Follow every step under "Moving a MongoDB collection aside" in the error reference for MIGRATION.PRECHECK_FAILED, which keep the documents until the copy back is checked." It does not name `db sign`, `reconcile` or `--permit-policy-change`. The `--to` value is the migration's directory name, which the CLI accepts.

- `r25a` (`mkp24.sh r25a migrate`: the migration creates `items` with a validator and a unique index `t_1`; `items` holds four documents, two sharing `t` "keep" and one with `level` "medium", outside the enum). Step 2: `renameCollection("items_kept")`. Step 3: `db migrate --to 20261127T0538_items` created `items` with its validator and `t_1`, and stopped there. Step 4: the `$nor` query over the validator from `getCollectionInfos` found `_id` 3; the `$group` query (on `t`, the stored name the index shows) found "keep" twice. I fixed both in `items_kept`. Step 5: `$merge` with `whenMatched: "fail"` copied all four. Step 6: counts 4 and 4; dropped `items_kept`. Step 7: `db migrate` had nothing left to run. All four documents kept. `migration status`: "Up to date", both migrations applied. `db verify` passed.
- `r25d` (the same data, but copying back without fixing, to follow step 6's failure branch). The `$merge` failed with a DuplicateKey error on `t` "keep". `items` held 2 and `items_kept` 4, so the user keeps `items_kept`. I fixed the document MongoDB named and copied again with `whenMatched: "keepExisting"`. That failed with "Document failed validation" on the other bad document, with 3 copied. I fixed that one and copied again: 4 and 4. Dropped `items_kept`, ran `db migrate`. All four kept, status up to date, both applied, `db verify` passed. See the notes on how MongoDB names only one failing document.
- `r25b` (a later migration pending). As `r25a`, plus a later migration planned with `migration plan --from 20261127T0539_items`, which renames the stored field `t` to `name`: it drops `t_1`, renames the field, creates `name_1` and updates the validator. The refusal names `--to 20261127T0539_items`, the stopped migration, not the later one. Step 3 ran only the create and `t_1`, so the rename did not run on the empty `items`. Steps 4 to 6 as in `r25a` (counts 3 and 3). Step 7's `db migrate` ran the later migration's four operations over the copied documents: each now has `name` in place of `t`. Status up to date, all three migrations applied; `db verify` passed.
- `r25c` (`mkts25.sh r25c migrate`: the migration creates time-series `readings`, granularity `hours`; `readings` already holds 3 time-series documents). Step 2's time-series branch: `aggregate([{ $out: "readings_kept" }])` made a regular collection; counts 3 and 3; dropped `readings`. Step 3: `db migrate --to 20261127T0540_readings` created `readings` as time-series. Step 4: the migration creates no validator and no index (see notes). Step 5's time-series branch: `readings.aggregate([{ $unionWith: "readings_kept" }, { $out: "readings" }])` succeeded; `readings` stayed time-series with granularity `hours`. Step 6: counts 3 and 3; dropped `readings_kept`. Step 7: already up to date. All three documents kept, with their `ts` and `value`. Status up to date, both applied; `db verify` passed.

### 2. An extension space

`r25h`: the app's base migration applied under a ref with `change: ["migrate"]`, then `ext24.mjs` added to the config's `extensions`, `contract emit` pinned `migrations/audit/`, and `audit_log` created with two documents, one without the required `event`. `db migrate` refused, and the text:

- says "This migration belongs to an extension: its operations come from the extension's package, not from a migration.ts in this project, so its ops.json cannot be written again here", and offers no route that writes `ops.json` again;
- does not name `db sign`;
- says "run the command again so this migration creates audit_log with its options", and points to the section "with its part for an extension's migration";
- ends "The apply stopped in contract space "audit"".

Following the section and its extension part: renamed to `audit_log_kept`, ran `db migrate` as it is (it created `audit_log` in the audit space and nothing in the app space), found the document without `event` with the `$nor` query, fixed it, copied back with `whenMatched: "fail"` (2 and 2), dropped `audit_log_kept`. Both documents kept. `migration status`: both spaces up to date, both migrations applied. `db verify` passed. It prints "Schema warnings" naming `audit_log` and `others`; round 24 found the same in a project where the extension was applied with no stop, so it is not from this change. A further `db migrate`: "Already up to date across 2 space(s)".

### 3. The `$currentOp` check before counting

The stopped-copy text now says, before the counts: "To tell whether it finished, first check that it is no longer running: MongoDB keeps running an aggregate that ends in $out after the connection that sent it drops. In mongosh, db.getSiblingDB("admin").aggregate([{ $currentOp: { allUsers: true } }, { $match: { "command.aggregate": "measurements" } }]) lists the copy while it runs. Wait until it lists nothing, or end the copy with db.killOp(<the opid it lists>)."

- `r25e` (300,004 documents to move, connection dropped 100 ms after the `$out` was forwarded): the copy had already finished by the time I ran the check; it listed nothing and the count was 300,004. Not slow enough, so I made the copy slow instead.
- `r25f` (the move from `mk18.sh`, with a stage in the copy's pipeline that sleeps 8 seconds per document, connection dropped 300 ms after forwarding): `db migrate` stopped at once. Right after, the printed `$currentOp` command listed one operation and the count was 0. A user who counted then, without the check, would have read 0 and run the command again as it is, copying the documents twice. I ran the check again until it listed nothing (about 17 seconds); the count was then 4, the finished number. I ran the two deletes as the text says (2 and 2) and ran the command again. End: `measurements` 2, 3, 4, 5 once each, still time-series; `events` holds e1; the duplicates query finds nothing; `db verify` passed; next plan: no changes.
- `r25g` (the same, ending the copy): the check listed the operation; `killOp` with its `opid` ended it within a second. The check then listed nothing and the count was 0, and no temporary collection was left. I ran the command again as it is. End as in `r25f`; `db verify` passed; next plan: no changes.

### 4. Regression

Round 24 case 1, the stopped time-series copy:

- `r25i` (stop after `$out` committed): the check lists nothing; count 4; ran both deletes (2 and 2) and the command again. End: 2, 3, 4, 5 once each, `x` gone, time-series kept; `events` e1; duplicates query nothing; next plan no changes.
- `r25j` (stop before `$out` was sent): the text is the same byte for byte as `r25i`'s apart from the port and database name. Count 0; ran again as it is. Same end state.
- `r25k` (stop after commit, then `_id` 3 deleted from `measurements`): count 3, "any other number", settle by hand. Following "leave in collection events only the documents that collection measurements does not hold yet", I deleted 2, 4, 5 from `events` and ran again. End: 2, 3, 4, 5 once each; next plan no changes.

## Findings

None.

## Notes, not findings

- Step 6 says that when the copy back stops part way, "MongoDB names" the document that stopped it. In `r25d` two documents broke the collection (a duplicate `t` and a value outside the enum). The first error named only the duplicate, the document after both was still copied, and the second copy named the other one. The user gets there by repeating "fix, copy again", which the step already says, and nothing is lost while `items_kept` is kept. Step 4's queries find both before the first copy.
- In the time-series case the migration creates no validator, so step 4's `getCollectionInfos(...)[0].options.validator` is `undefined`, and the `$nor` query built from it fails with "$nor argument's entries must be objects". A user sees there is no validator to check and skips that part. The steps do not say what to do then.
- Step 5's time-series copy (`$out` into the existing time-series collection, with no `timeseries` option) worked on MongoDB 8.2.6. I did not test older servers.
- The unique-index example in step 4 groups on `$title`; the index from a PSL field with `@map("t")` is on `t`. `getIndexes()` shows the stored name, so the user can see what to group on.

## Cleanup

MongoDB and the proxies are stopped. Scratch projects and helpers stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
