# Manual QA — stored-name renames on MongoDB, round 21

Date: 2026-11-27. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `5276d05039`. Earlier round: `2026-11-27-qa-stored-names-mongo-round-20.md` in this folder. This round checks commits `4bb0f3471f` (the move and rename routes give one reason for stopping writes to an `$out` target, and say "re-runs included") and `5276d05039` (an interrupted time-series copy is judged by document counts read before it, and a create with no after-check gets its own refusal).

Status: done. Three findings, 40 to 42. Every case that follows the printed text with writes stopped left each document in its target exactly once. Finding 40 loses a document when a write reaches the source collection after the apply stops, which the move route's wording allows.

## Setup

- `dist` was current: it was built at 14:47, no source file is newer, and it holds the new texts. No build was run.
- MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 18 to 20 helpers reused (`mk18.sh`, `mkts.sh`, `mkts2.sh`, `ins19h.py`, `rmboom.py`, `proxy20.mjs`, `via20.sh`, `rehash20.mjs`, `ctr/r17a0.ts`, `ctr/r17a1.ts`, `ctr/r18g0.ts`, `ctr/r18g1.ts`, `ctr/r19j0.prisma`, `ctr/r19j1.prisma`). New: `stop21.sh` (one `db migrate` through `proxy20.mjs`), `mkren21.sh` (time-series rename route with copy then drop), `fin21r.sh`, `mkc21.sh` (create with its postcheck emptied and the hash recomputed), `collmod21.mjs`, `agg21.mjs`. Projects `wip/qa-mongo/r21a`–`r21t`.
- `agg19.mjs` no longer works: the text now prints the `countDocuments()` command first, and its pattern takes the first "for example with". `agg21.mjs` picks the `aggregate` query.
- Time-series validators were removed from the emitted contract before planning, as in earlier rounds.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1 | Copy interrupted after `$out` committed, and before it was sent | `r21a`–`r21g` | ✅ |
| 2 | A third count: a hand write between the stop and the check | `r21h`, `r21i` | ⚠️ findings 40, 41 |
| 3 | Create with no after-check finds its collection | `r21j`, `r21k`, `r21l` | ⚠️ finding 42 |
| 4 | Stop-writes wording, `migration plan` and `db update` | `r21o`, `r21p`, `r21q` | ✅ (see finding 40) |
| 5 | Regression: round 19 cases 1a and 2c | `r21r`, `r21s`, `r21t` | ✅ |

### 1. An interrupted copy

- `r21a` (move into time-series `measurements` with two groups and two deletes, `reply` mode): the text says the copy "was copying … when the apply stopped", that the error does not show whether it finished, that both deletes have not run, and: "Before the copy, collection measurements held 0 documents, and the copy was to add 4 documents of collection events." It prints `db.getCollection("measurements").countDocuments()` and three branches: 4 means finished, 0 means not finished, any other number means something else wrote or the command already re-ran. The re-run sentence now reads "an operation with no check, such as a copy in a dataTransform, runs again", which fixes the round 20 note. The count was 4. I ran both deletes (2 and 2) and re-ran. End: `measurements` 2, 3, 4, 5 once each, `x` gone, time-series options kept; `events` e1. The printed doubles query returned nothing. Next plan: no changes.
- `r21b` (same move, `swallow` mode): the same text, byte for byte apart from the port. The count was 0. I re-ran as it is. End: `measurements` 2, 3, 4, 5 once each; `events` e1. Next plan: no changes.
- `r21c` (time-series rename route `readings` → `sensor_readings`, copy then drop, `reply`): the whole-collection form: "held 0 documents, and the copy was to add 3 documents of collection readings", "delete the documents of collection readings or drop it yourself". The count was 3. I dropped `readings` and re-ran. End: `sensor_readings` 1, 2, 3 once each, granularity `hours` kept; `readings` gone. Next plan: no changes.
- `r21d` (same, `swallow`): count 0, re-ran as it is. Same end state.
- `r21e` (same, `reply`): count 3. I took the other choice the text gives, deleting the documents of `readings` (3) without dropping it, and re-ran. The plan's drop removed it. Same end state.
- `r21f` and `r21g` (the move, with `measurements` made beforehand with the same time-series options and holding a document with `_id` 2, the `_id` of a source document): the create was skipped by its after-check. The text says "held 1 document, and the copy was to add 4", so 5 means finished and 1 means not finished. In `r21f` (`swallow`) the count was 1, judged unfinished; I re-ran as it is. In `r21g` (`reply`) the count was 5; I ran both deletes and re-ran. Both ended the same way: `measurements` holds the earlier `_id` 2 document (`v` 99) and the moved 2, 3, 4, 5 once each; `events` e1. Next plan: no changes.

### 2. A third count

- `r21h`: after a `reply` stop I inserted `_id` 9 into `measurements` by hand. The count was 5, neither 0 nor 4. The text says: "If it holds any other number, something else wrote to collection measurements or collection events, or the command was already run again: delete nothing until you have found out which." It names the causes. It gives no way to find out and no next step (finding 41). I checked by hand that `_id` 2 to 5 were in `measurements`, took the copy as finished, ran the deletes and re-ran. End: 2, 3, 4, 5, 9 once each.
- `r21i`: after a `reply` stop I inserted into `events` a document that the first delete's filter selects (`_id` 8, `v` 8). The count was 4, the "finished" number: a write to the source does not change the target's count, although the "any other number" sentence names writes to `events` as a cause. I followed the finished branch and ran the deletes: the first deleted 3, `_id` 8 among them. After the re-run, `_id` 8 is in neither collection. Finding 40.

### 3. A create with no after-check

- Setup (`mkc21.sh`): a migration creating `items` (validator, `strict`, `error`) and its index, with the create's postcheck set to `[]` in `ops.json` and the hash recomputed. A plain `items` holding one document.
- Headline: "Operation collection.items.create stopped: collection items already exists, and this migration's create has no after-check that lets a run skip it". The `why` says the runner cannot tell whether an earlier run made `items`, then gives three routes, and ends "The failed apply changed nothing."
- Route 1, `r21j`: I ran `migration.ts` with node; the create got its postcheck back. The next run gave the other refusal ("already exists without the options this migration creates it with"), which says to give `items` the options of the `createCollection` call. Route 1's own text, "the creation is then skipped if items has the options …", leads there. I gave `items` the validator, level and action with `collMod` and re-ran: "1 of 2 operation(s); the other 1 had nothing to do". The document was kept and `t_1` was created. Next plan: no changes.
- Route 2, `r21k`: I dropped `items` and re-ran. Both operations ran, giving `items` its `strict` validator and index `t_1`. Next plan: no changes.
- Route 3, `r21l`: "Otherwise leave the migration as it is, and apply the operations of this migration that did not run by hand." I gave `items` its options and created `t_1` by hand. `db migrate` then refused again with the same text, and `migration status` showed the migration still pending. The text says nothing more. `prisma db sign` fixed it: after signing, `migration status` showed it up to date, `db migrate` said "Already up to date", and `db verify` passed. Finding 42.

### 4. The stop-writes wording

- Move route (`--rename Measurement:Reading` from shared `events` into time-series `measurements`), `r21o` (`migration plan`) and `r21p` (`db update`): the two print the same text. It says "Stop writes to collection "measurements" too, for the whole apply, re-runs included: an $out stage replaces the collection with what it read, so a document written there while the copy runs is lost." "retries included" no longer appears. The sentence before it still says "Stop writes to each collection the documents move out of until the apply ends" (finding 40).
- Time-series rename routes (`--rename Reading:Sample`), `r21q`, under both commands: the two print the same text. The `db update` route and the `migration plan` route both say "Allow writes again only once it has run (applied), re-runs included". Each gives the same two reasons, ending "an $out stage replaces collection "sensor_readings" with what it read, so a document written there while the copy runs is lost". Round 20 had "a copy with an $out stage" and "the $out stage". Both now read "an $out stage", as `4bb0f3471f` intends.

### 5. Regression

- `r21r` (case 1a): stop after the copy. The text uses the "copied … have not finished" form, not the count form. The printed doubles query returned nothing. I finished both deletes and re-ran. End: `measurements` 2, 3, 4, 5 once each, `x` gone, time-series kept; `events` e1. Next plan: no changes.
- `r21s` (`migration plan`) and `r21t` (`db update`), case 2c: `@@map("items")` → `things`, `@map("t")` → `ttl` (indexed), enum `"low"` → `"lo"` on a scalar and a list. Nothing asked, 7 operations, both documents once each with the right values, index `ttl_1`. The next plan, or `db update`, had no operations.

## Findings

### 40. A write to the source after the stop is deleted without being copied, and the move route allows it

The move route says to stop writes to the collections documents move out of only "until the apply ends", while the `$out` target and the time-series rename routes say "re-runs included". An apply that stops has ended, so a user can take the text to allow writes to `events` again. In `r21i`, a document written to `events` after the stop, of a kind the delete's filter selects, left the count of `measurements` at the "finished" number. The advice then said to run the deletes, and the delete removed that document, which was never copied. The "any other number" sentence names writes to `events` as a cause it can show, but a write to the source never changes the target's count.

Suggested fix: make the move-out sentence say "until the apply finishes, re-runs included", as the others do. Separately, either drop "or collection events" from the "any other number" sentence, or have the advice also compare the source count the filters select now with the count read before the copy.

### 41. The "any other number" branch gives no way to find out and no next step

"delete nothing until you have found out which" stops there. The round 20 text told the user to look in the target for the `_id` values of source documents that the filters select. A short version of that, plus "then follow the branch that applies", would let the user go on. Without it, `r21h` needed knowledge the text does not give.

### 42. The by-hand route for a create with no after-check leaves the migration pending for good

Route 3 says to leave the migration and apply its remaining operations by hand. After that, `db migrate` refuses the same way every time, because the migration is still pending. `prisma db sign` records the database at the contract and clears it (`r21l`), but the text and `docs/reference/error-reference.md` do not mention it. Suggested fix: end route 3 with "then sign the database with prisma db sign", or whatever command the project intends for recording a migration applied by hand.

## Notes, not findings

- Route 1 of the unchecked-create refusal takes two runs when the collection lacks the options: the first re-run gives the other create refusal, which says to give it the options. This is correct, and route 1's "skipped if items has the options" points there, but it could say "give items those options, then run the command again" directly.
- With a target that already held a document with a moved document's `_id` (`r21f`, `r21g`), the doubles query would list that `_id` even when nothing was copied twice. The text only sends the user to that query after a re-run that came too early, so this did not mislead here.
- The `$boom` stop in case 1a still opens with update wording ("Documents the update changed before the error stay changed"), as in round 20.

## Cleanup

MongoDB and the proxies are stopped. Scratch projects stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed. The untracked `projects/migration-statements/slices/stored-name-renames/dispatches/52-mongo-round-34-fixes.md` appeared while this round ran; I did not write it.
