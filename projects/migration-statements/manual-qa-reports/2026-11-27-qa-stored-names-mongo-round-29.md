# Manual QA — stored-name renames on MongoDB, round 29

Date: 2026-11-27. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `c03a51626c`. Earlier round: `2026-11-27-qa-stored-names-mongo-round-28.md` in this folder. This round checks commit `c03a51626c`: the refusal for a create with no after-check gives every collection the same advice, whoever created it (drop it only if it holds nothing you need, otherwise move it aside); step 5 of "Moving a MongoDB collection aside" lists the `_id`s the run wrote again and has the user compare each pair before the copy back; step 6 checks that no document was left behind.

Status: done. One new finding, low. In every case, following the printed advice and the error-reference steps at each stop led to a `db migrate` that succeeded, every document was kept, nothing was doubled, and `db verify` passed. The reviewers' data-loss case is fixed: the collection that holds the moved documents now gets the move-aside advice, and following it kept all three moved documents. Findings 51 and 52 are fixed. Finding 53: in the refusal, the sentence "This holds also if an earlier run of this command created items" follows a sentence about operations that run again, so it is not clear what "this" refers to.

## Setup

- `dist` was current: `packages/3-targets/mongo/1-target/dist/control.mjs` holds the new text (`This holds also if an earlier run`) and not the old (`its documents came from that run`), and no source file is newer. No build was run.
- MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end. No proxy was needed this round.
- Round 18 to 28 helpers reused (`mk.sh`, `c.sh`, `cs.sh`, `p.sh`, `q.sh`, `mkp27.sh`, `mkp27m.sh`, `mkp28s.sh`, `mkx27.sh`, `ext27.mjs`, `rehash20.mjs`, `ins-move.mjs`). New:
  - `mkp29l.sh` with `ctr/r29l0.prisma`, `r29l1.prisma`, `r29l2.prisma`, `r29l2u.prisma` and `move29.txt`: `base` creates `others` and `legacy`, which then holds 3 documents (`c` `a`, `a`, `b`); `ordersm` creates `orders` with its after-check emptied; `movem` first copies every `legacy` document into `orders` with `$merge` and deletes them from `legacy`, then either (`A`) creates `items` with its after-check emptied while `items` exists with 2 documents, or (`B`) creates a unique index on `orders.c`.
  - `mkts29.sh` with `seedts29.txt`: `readm` creates time-series `readings` with its after-check emptied, then writes reading `_id` 31 (`value` 0) with `$unionWith` and `$out`; `readings` exists before the run as a time-series collection with `_id` 1, 2 and 31, where 31 has the `value` given.
  - `step29.mjs` (run through `s29.sh`): each command of steps 4 to 6 as the error reference writes it, one per call: `collMod`, the `$nor` query, the duplicates `$group`, the step 5 `$lookup` list, a side-by-side view of each listed pair, the two `deleteOne` commands, `$merge` with `"fail"` or `"keepExisting"`, the time-series `$unionWith`/`$out`, the step 6 list with `{ $match: { written: [] } }`, the counts, and the drop.
- mongosh is not installed. Each `mongosh` step was run as the same server command through the Node driver.
- Projects `wip/qa-mongo/r29a`–`r29y`.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1 | The reviewers' data-loss case: a newer migration moves `legacy` documents into a collection an older create with no after-check made, then stops | `r29a`, `r29b` | ✅ |
| 2 | A run writes documents again under the same `_id`, same and different content, regular and time-series | `r29c`, `r29d`, `r29e`, `r29f`, controls `r29g`, `r29h` | ✅ |
| 3 | Findings 51 and 52 | all stops of this round | ✅ with finding 53 |
| 4 | Regression: round 28 cases 1, 3 and 4 | `r29i`, `r29j`, `r29k`, `r29m`, `r29x`, `r29y` | ✅ |

### 1. The reviewers' data-loss case

`r29a` (`mkp29l.sh … A`). `db migrate` created `orders`, moved the 3 `legacy` documents into it, deleted them from `legacy`, and refused at `collection.items.create`. `legacy` was then empty and `orders` held the only copies. `items` held 2 documents I needed, so I moved it aside (`items_kept`) and ran `db migrate --to …_movem`, as the text says. That run refused at `collection.orders.create`. The advice for `orders` now reads "This holds also if an earlier run of this command created orders: an operation of that run may have moved documents into it from a collection it then deleted them from, and those documents are only in orders", then the move-aside route. The old "so drop it" and "writes them again" text is gone. Following the move-aside steps for `orders`: renamed it to `orders_kept`, ran `--to …_ordersm` (count 0), `collMod`, `$nor` found nothing, the step 5 list was empty, `$merge` with `"fail"` copied 3, the step 6 list was empty, counts 3 and 3, dropped `orders_kept`. Step 7 for `orders`, `--to …_movem`, moved nothing (legacy empty) and created `items` and `t_1`, which was step 3 for `items`. Steps 4 to 6 for `items`: nothing rejected, no duplicates on `t`, list empty, 2 and 2. Step 7 for `items`, `db migrate`: nothing to apply. `migration status`: all three migrations applied. `db verify` passed. `orders` holds `a`, `a`, `b` under their original `_id`s; nothing was lost.

`r29b` (`mkp29l.sh … B`, the shape of the new journey test). `db migrate` moved the 3 documents and failed building the unique index `c_1` on the two `a` values. I changed one to `a2` as the error says and ran `db migrate` again, which refused at `collection.orders.create` with the same advice as above. Move-aside steps for `orders` with `--to …_ordersm`: list empty, copy 3 and 3, `orders_kept` dropped. Step 7, `db migrate`, ran `movem` (the move found nothing in `legacy`) and built `c_1`. `db verify` passed; `orders` holds `a`, `a2`, `b`; `legacy` is empty.

### 2. A run writes documents again under the same `_id`

Regular collection, `mkp28s.sh` (`notesm` creates `notes` and writes `seed`, `_id` 31). In both projects: `db migrate` stopped at `items`; I wrote `w1` into `notes`; moved `items` aside; `--to …_itemsm` stopped at `notes`; moved `notes` aside; `--to …_notesm` created `notes`, wrote `seed` again and created `code_1` (count 1, noted for step 6).

- `r29c`, same content: the step 5 list gave `_id` 31; the two documents were the same, so the kept one is not needed. The list was not empty, so I copied with `whenMatched: "keepExisting"`. The step 6 list was empty; `notes` held 2, which is 1 noted in step 3 plus the 1 kept document the list did not show. Dropped `notes_kept`. Step 7, `--to …_itemsm`, created `items`; `items` 2 and 2; `db migrate` had nothing to apply; `db verify` passed. `notes` holds `seed` and `w1` once each.
- `r29d`, different content (the application had changed `seed`'s `body` before the stop): the list gave 31; the pair differed; I kept the one in `notes_kept` by running `deleteOne({ _id: 31 })` on `notes`, then copied with `"keepExisting"`. Step 6: list empty, 2 = 1 + 1. Same end as `r29c`, with the application's `body` kept. `db verify` passed.

Time-series, `mkts29.sh`. In both: `db migrate` refused at `collection.readings.create`; step 2 copied `readings` into time-series `readings_kept` with `$out` (3 and 3) and dropped `readings`; `--to …_readm` created `readings` and wrote reading 31 again (count 1); `$nor` reports no validator, as step 4 says.

- `r29e`, same content: list 31, the pair is the same, so I deleted it from `readings_kept` as the time-series bullet says, then ran `$unionWith`/`$out`. Step 6: list empty; `readings` holds 3 = 1 + 2; no `_id` appears twice. `db verify` passed; `readings` is still time-series.
- `r29f`, different content (`value` 99 in `readings_kept`, 0 from the run): I kept the kept one by `deleteOne({ _id: 31 })` on `readings`, then ran `$unionWith`/`$out`. Step 6: list empty, 3 = 1 + 2; 31 holds 99 once. `db verify` passed.

Controls:
- `r29g`: as `r29c`, but I copied with `"fail"` without reading the list first. It stopped on `_id` 31 with a duplicate key error after it had already copied `w1`. Following "compare as above, then copy with `keepExisting`": the list now shows both 31 and 51, both pairs are the same, and `"keepExisting"` gave 2 documents, nothing doubled.
- `r29h`: as `r29e`, but I ran `$unionWith`/`$out` without the delete. `readings` then held 4 documents, with `_id` 31 twice. This shows the time-series delete in step 5 is needed, and the step says to do it.

### 3. Findings 51 and 52

Every refusal of this round (`r29a` both stops, `r29b`, `r29i` both stops, `r29k`, `r29x` both stops) says "stop the application's writes to it until every step is done" and "apply to the documents in items_kept the changes that the operations after the create make" in the short route, before it points to the steps. None says "If an earlier run of this command created", "keep only" or "writes them again". The only sentence about an earlier run is a statement that the advice also holds then, so the user is never asked to judge who created the collection. The error reference's procedure opens with "Follow these steps for every collection the error names that holds documents you need, whoever created it". Findings 51 and 52 are fixed. Finding 53 is about how that one sentence reads.

### 4. Regression

- Round 28 case 1, move-aside route (`r29i`, `mkp27.sh`): stop at `items`, `w1` written into `notes`, `items` moved aside, `--to …_itemsm` stopped at `notes`, `notes` moved aside, `--to …_notesm`, copy back 1 and 1, step 7 `--to …_itemsm` created `items`, copy back 2 and 2, `db migrate` up to date, `db verify` passed.
- Drop route (`r29j`): dropped `items`, the next run stopped at `notes`, dropped it, the next run applied both migrations; `db verify` passed.
- Round 28 `r28e` (`r29k`: `notes` and `items` both exist with 2 documents before the first run): stop at `notes` with `--to …_notesm`, copy back 2 and 2; `db migrate` stopped at `items` with `--to …_itemsm`, copy back 2 and 2; `db migrate` up to date; three migrations applied; `db verify` passed.
- Round 28 case 3 (`r29m`, `mkp27m.sh` with `ctr/r27m2.prisma`, where `itemsm` renames `notes.code` to `ref` and changes the validator): the full route for `notes` with `--to …_notesm`, copy back with `code`, then step 7 `--to …_itemsm` dropped `code_1`, renamed the field, created `ref_1` and updated the validator. The copied document ends `{ body: "w1", ref: "w1" }`; `items` 2 and 2; `db verify` passed.
- Round 28 case 4 (`r29x`, `mkx27.sh`, `audit_extra` with 2 documents): refusal at `audit_extra` says "run the command again" and points to the extension part; `w1` written into `audit_log`; `audit_extra` moved aside; `db migrate` stopped at `audit_log`; moved it aside; `db migrate` applied both audit migrations; copy back 1 and 1, 2 and 2; both shown applied; `db verify` passed. `r29y` (empty `audit_extra`): dropped it, then `audit_log` at the next stop; the next run applied both; `db verify` passed.

## Findings

### 53. "This holds also" in the refusal has no clear referent (low)

`r29a` first stop, `r29x`: the refusal reads "If items holds nothing you need, drop it, then run the command that stopped again, as you ran it. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again. This holds also if an earlier run of this command created items: …". The sentence just before "This" is the one about operations that run again, so a reader can take "this" to mean that the dataTransform runs again, not that the advice holds. The sentence is meant to say the whole advice for `items` applies the same way when an earlier run created it. Where the migration has no dataTransform, the drop sentence ends "operations that already ran are skipped" and the reading is clearer. Nothing is lost by it: the next sentence gives the move-aside route either way. Saying "All of this advice holds also if …", or putting the sentence before the drop route, would remove the doubt. Where it lives: `madeByEarlierRunText` in `packages/3-targets/mongo/1-target/src/core/migrations/mongo-runner.ts`.

## Notes, not findings

- `r29a` second stop: the drop sentence for `orders` ends "operations that already ran are skipped", because `ordersm` has only the create. The command that stopped, `--to …_movem`, also runs `movem` again, whose dataTransform has no check and does run again. Here `legacy` was already empty, so the rerun moved nothing. The text is accurate for the migration it names, but not for every migration the rerun applies.
- `r29g`: when a `"fail"` copy stops part way, the documents it copied before stopping also show in the step 5 list on the next look. They are the same as their pair, so comparing them is quick, but the list is longer than the documents the run wrote again.

## Cleanup

MongoDB is stopped. Scratch projects and helpers stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
