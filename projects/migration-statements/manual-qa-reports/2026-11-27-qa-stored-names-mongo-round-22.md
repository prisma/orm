# Manual QA — stored-name renames on MongoDB, round 22

Date: 2026-11-27. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `f96aec3ede`. Earlier round: `2026-11-27-qa-stored-names-mongo-round-21.md` in this folder. This round checks commits `840ecd9cb1` (writes to both collections stay stopped until the apply succeeds, and the advice says to compare the collections before deleting from the source when that is not sure) and `f96aec3ede` (the by-hand route for a create with no after-check ends with `db sign`).

Status: done. Findings 40 and 41 are fixed. Finding 42 is fixed for a database with no change policy, but not for one whose policy permits only migrations: two findings, 43 and 44. Every case that followed the printed text left each document in its target exactly once, and no document was lost.

## Setup

- `dist` was current: the target package was built at 15:15, no source file is newer, and it holds the new texts. No build was run.
- MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 18 to 21 helpers reused (`mk18.sh`, `mkts.sh`, `mkts2.sh`, `mkren21.sh`, `mkc21.sh`, `stop21.sh`, `fin21r.sh`, `proxy20.mjs`, `via20.sh`, `rehash20.mjs`, `collmod21.mjs`, `agg21.mjs`, `ctr/r18g0.ts`, `ctr/r18g1.ts`). New: `cmp22.mjs` (the printed comparison: for each source document a filter selects, the target holds it with the same `_id` and the same value in each field the copy does not change; with `delete`, deletes only those from the source), `ren22.py` (makes the move's first group rename `v` to `value` as well as drop `x`), `fin22m.sh` (re-run, then the move's end state, the printed doubles query and the next plan). Projects `wip/qa-mongo/r22a`–`r22n`.
- Time-series validators were removed from the emitted contract before planning, as in earlier rounds.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1 | Findings 40 and 41: a write to the source after the stop, and a count that matches neither case | `r22a`, `r22b`, `r22c` | ✅ |
| 2 | The comparison when the copy changes fields | `r22a`, `r22d`, `r22e`, `r22m` | ✅ (see finding 44) |
| 3 | Finding 42: the by-hand route ending in `db sign` | `r22f`, `r22g` | ⚠️ finding 43 |
| 4 | Stop-writes wording on the move route, `migration plan` and `db update` | `r22h`, `r22i` | ✅ |
| 5 | Regression: copy interrupted after the commit and before it is sent | `r22j`, `r22k`, `r22l`, `r22n` | ✅ |

### 1. A write to the source, and other counts

- `r22a` (move into time-series `measurements` with two groups and two deletes, `reply` mode, the round 21 `r21i` case): the "finished" branch now says "Writes to collections measurements and events must still be stopped: those deletes also remove any document written to collection events since the copy, which the copy did not take. If you cannot be sure that nothing wrote to either collection since the apply stopped, keep collection events as it is and compare the two collections …". After the stop I inserted `_id` 8 (`v` 8, `x` 80) into `events`. The count was 4, the finished number. Since something had written, I took the comparison branch: `02` to `05` were copied, `08` was not. I deleted only `02` to `05` from `events` and re-ran. End: `measurements` 2, 3, 4, 5, 8 once each, `x` removed from 2, 3 and 8, time-series kept; `events` e1. The printed doubles query returned nothing. Next plan: no changes. Finding 40 is fixed.
- `r22b` (`reply`, then `_id` 9 inserted into `measurements`): count 5. The "any other number" branch now reads "something else wrote to or deleted from collection measurements, or the command was already run again. Delete nothing from collection events until you compare the two collections: … Delete only those from collection events yourself, then run the command again." It no longer names writes to `events`, and it gives a next step. The comparison found `02` to `05` copied; I deleted them and re-ran. End: 2, 3, 4, 5, 9 once each. Next plan: no changes. Finding 41 is fixed.
- `r22c` (`reply`, then `_id` 3 deleted from `measurements`): count 3. The comparison found `02`, `04`, `05` copied and `03` not. I deleted only those three and re-ran; the re-run copied `03`. End: 2, 3, 4, 5 once each. Next plan: no changes.

### 2. The comparison when the copy changes fields

- `r22a` to `r22c`: the first group's copy removes `x`. Comparing every field but `x` worked, as above.
- `r22d` (the first group's copy renames `v` to `value` and removes `x`, `reply`, then `_id` 8 written to `events`): count 4. Comparing every field but `v` and `x` for the first group found `02` to `05` copied and `08` not. I deleted only those and re-ran. End: `measurements` 2 and 3 with `value` 2 and 3, 4 and 5 with `w`, 8 with `value` 8, once each; `events` e1. Doubles query: nothing. Next plan: no changes. Comparing every field instead, as a reader who missed "the copy does not change" would, judges `02` and `03` not copied (finding 44).
- `r22e` (`measurements` made beforehand with the same time-series options and holding `_id` 2 with `v` 99; `swallow`; then `_id` 9 inserted into `measurements`): the text says "held 1 document, and the copy was to add 4". The count was 2. The comparison found nothing copied, because the target's `_id` 2 has `v` 99, not 2, so it deleted nothing. After the re-run: the earlier `_id` 2 (`v` 99), 9, and the moved 2, 3, 4, 5 once each; `events` e1. The value check is what keeps the earlier `_id` 2 from counting as a copy. The doubles query lists `_id` 2, as round 21 noted for this setup.
- `r22m` (time-series rename route `readings` → `sensor_readings`, `reply`, then `_id` 7 written to `readings`): the whole-collection form reads "each document of collection readings that collection sensor_readings also holds, with the same _id and the same value in each field the copy does not change, was copied". Count 3. The comparison found 1, 2, 3 copied and 7 not. I deleted those three and re-ran; the copy took 7 and the drop removed `readings`. End: `sensor_readings` 1, 2, 3, 7 once each, granularity `hours` kept. Next plan: no changes.

In every case the comparison as printed deleted only documents that were copied.

### 3. A create with no after-check

- `r22f` (`mkc21.sh`: first migration creates `items` with validator and index `t_1`, its postcheck emptied and the hash recomputed; a plain `items` with one document; no marker): the refusal's route 3 now reads "Otherwise leave the migration as it is, apply the operations of this migration that did not run by hand, then run db sign with the name of this migration's directory: it checks that the database matches the contract this migration leads to and records the database there, so the next run starts after this migration. db sign refuses a database whose change policy does not include reconcile." I gave `items` the options with `collMod`, created `t_1` by hand, and ran `prisma db sign 20261127T0423_init`: "signed … (no marker before)", ref `db` advanced. `migration status`: up to date. `db migrate`: "Already up to date". `db verify` passed. The document was kept. Finding 42 is fixed for this database.
- `r22g` (a first migration applied with a ref declaring `change: ["migrate"]` and `--permit-policy-change`, so the marker records `change: migrate`; a second migration creating `items` the same way, with a plain `items` holding one document): `db migrate` gave the same refusal. I applied the options and the index by hand and ran `db sign 20261127T0424_items`. It refused: "This database's change policy permits only migrations … The marker records change: migrate, so db sign may not sign it." Its next step was `prisma db migrate --to 8b0f7ec…`. That gave the unchecked-create refusal again. `migration status` showed the migration still pending. Finding 43.

### 4. The stop-writes wording

- `r22h` (`migration plan --rename Measurement:Reading`, from shared `events` into time-series `measurements`) and `r22i` (`db update` with the same rename) print the same text apart from the progress lines. Both say "Stop writes to each collection the documents move out of until the apply succeeds, re-runs included: the delete also removes a document of those models written there after the copy, and that document was not copied." and "Stop writes to collection "measurements" too, for the whole apply, re-runs included: an $out stage replaces the collection with what it read …". "until the apply ends" no longer appears.

### 5. Regression

- `r22j` (move, `reply`): count 4. I ran both deletes (2 and 2) and re-ran. End: `measurements` 2, 3, 4, 5 once each, `x` gone, time-series kept; `events` e1. Doubles query: nothing. Next plan: no changes.
- `r22k` (move, `swallow`): the same text as `r22j` byte for byte apart from the port. Count 0; re-ran as it is. Same end state.
- `r22l` (rename route, `reply`): count 3. The new text in the whole-collection form says "deleting the documents of collection readings or dropping it also removes any document written to collection readings since the copy". I dropped `readings` and re-ran. End: `sensor_readings` 1, 2, 3 once each, granularity `hours` kept; `readings` gone. Next plan: no changes.
- `r22n` (rename route, `swallow`): count 0; re-ran as it is. Same end state.

## Findings

### 43. On a database whose change policy permits only migrations, the by-hand route for a create with no after-check has no way to finish

Route 3 tells the user to apply the remaining operations by hand and then run `db sign`. Its last sentence says `db sign` refuses a database whose change policy does not include `reconcile`, but says nothing about what to do on such a database. In `r22g` the user follows route 3 to the end. `db sign` refuses, and its own next step is `db migrate --to <hash>`, which gives the same unchecked-create refusal. The two messages send the user to each other, and the migration stays pending. A database that permits only migrations is the likely case for a shared or production database, where route 1 ("if no other database has applied this migration") also does not apply, so the user can only take route 2 (drop the collection), which loses its data.

The runner reads the marker's policies before it runs, so it knows which case it is in. Suggested fix: on such a database, leave out route 3, or say plainly that the database's change policy does not allow it, and which of the other routes remain. Separately, `db sign`'s refusal here could avoid advising the `db migrate` that just failed. The advice must not suggest changing the policy.

### 44. The comparison gives no query, and does not say where to find the fields the copy changes

The comparison step is correct: in every case above, following it deleted only documents that were copied. But it is the one step in this text with no example command, while the count and the doubles check each have one. It also relies on "the same value in each field the copy does not change", and the user must read the copy's pipeline in `migration.ts` to know which fields those are; the text names the `$match` filters but not where the copy is. If the user compares every field instead (`r22d`), each changed document is judged not copied and kept in the source, and the re-run copies it a second time. That is not data loss, and the doubles query would show it, but it is the result the step exists to prevent. Suggested fix: say that the fields the copy changes are those its pipeline in the migration's `migration.ts` sets or removes, and, where the copy changes no field, give a short example command for the comparison.

## Notes, not findings

- The move route's two stop-writes sentences use different wording for the same span: "until the apply succeeds, re-runs included" for the source, and "for the whole apply, re-runs included" for the `$out` target. Both read correctly.
- The new "If collection readings is gone, run the command again" sentence appears only when the drop was running when the apply stopped. I did not reach that case in this round.

## Cleanup

MongoDB and the proxies are stopped. Scratch projects and helpers stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
