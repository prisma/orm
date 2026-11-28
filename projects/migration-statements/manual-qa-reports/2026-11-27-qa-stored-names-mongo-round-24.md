# Manual QA — stored-name renames on MongoDB, round 24

Date: 2026-11-27. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `28c7cf33fd`. Earlier round: `2026-11-27-qa-stored-names-mongo-round-23.md` in this folder. This round checks commit `28c7cf33fd` (a stopped time-series copy leaves an unsure user to settle the collections by hand, and a create with no after-check offers moving the collection aside on every database).

Status: done. Findings 45 and 46 are fixed. The comparison query is gone; following the new advice lost no document in any case, and each document ended in its target once. The move-aside route works on a database that permits only migrations, on one that also permits `reconcile`, and in an extension space, and in each it ends with the migration shown as applied. Two minor findings, 47 and 48.

## Setup

- `dist` was current: the target package was built at 16:04, the commit is from 16:08, no source file is newer, and `dist/control.mjs` holds the new texts (`settled which documents`, `_kept`). No build was run.
- MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end with the proxies.
- Round 18 to 23 helpers reused (`mk18.sh`, `mkts2.sh`, `mkren21.sh`, `mkren23.sh`, `stop21.sh`, `fin21r.sh`, `fin22m.sh`, `mkp23.sh`, `proxy20.mjs`, `via20.sh`, `rehash20.mjs`, `agg21.mjs`). New: `mkp24.sh` (`mkp23.sh` with `ctr/r24u.prisma`, where `items` has a unique index on `t` in place of a plain one) and `ext24.mjs` (a Mongo extension descriptor with a contract space `audit` whose one migration creates `audit_log`, with a validator, and has no after-check). Projects `wip/qa-mongo/r24a`–`r24o`.
- Time-series validators were removed from the emitted contract before planning, as in earlier rounds.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1 | A stopped time-series copy, following the new advice | `r24a`–`r24f` | ✅ |
| 2 | The move-aside route, by change policy, with validators | `r24g`–`r24j` | ✅ (see finding 47) |
| 3 | An extension space on a database that permits only migrations | `r24k`, `r24l` | ✅ (see finding 48) |
| 4 | Regression: round 23 case 3 | `r24m`–`r24o`, with `r24a`, `r24b`, `r24d` | ✅ |

### 1. A stopped time-series copy

The text no longer prints a comparison query. Both count conclusions now say they hold only "if nothing wrote to or deleted from either collection since the apply stopped". When the user cannot be sure of that, or the count is any other number, it says: "delete nothing from either collection, and do not run the command again, until you have compared collections measurements and events by hand and settled which documents each should keep". The duplicates query stays.

- `r24a` (move into time-series `measurements`, two groups, stop after `$out` committed): count 4, the finished number. I ran both deletes as the text says (2 and 2) and re-ran. End: `measurements` 2, 3, 4, 5 once each, `x` gone, time-series kept; `events` e1. Duplicates query: nothing. Next plan: no changes.
- `r24b` (the same, stop before `$out` was sent): the text is the same byte for byte apart from the port. Count 0, so I re-ran as it is. Same end state as `r24a`.
- `r24c` (stop after commit, then `_id` 3's `v` set to 33 and `_id` 8 inserted in `events`): the count is still 4, so a user who knows of the writes takes the "cannot be sure" branch. I settled by hand: deleted 2, 4, 5 from `events` (their copies are in `measurements`), replaced `measurements`' `_id` 3 with the new form (`v` 33, `x` removed as the copy's stage does) and deleted it from `events`, and left `_id` 8 in `events` for the re-run. The re-run copied 8 and the deletes removed it. End: `measurements` 2, 3 (v 33), 4, 5, 8 once each; `events` e1. Duplicates query: nothing. Next plan: no changes.
- `r24d` (stop after commit, then `_id` 3 deleted from `measurements`): count 3, "any other number", which sends the user to settle by hand. I deleted 2, 4, 5 from `events`, left 3 there and re-ran; the re-run copied 3. End: 2, 3, 4, 5 once each. Next plan: no changes.
- `r24e` (the delete of the second group stopped by a failing step between the deletes) and `r24f` (rename route `raw-readings` to `sensor-readings`, stop after commit): both texts carry the new "If you cannot be sure … settled which documents each should keep" sentence in place of the old comparison. Following the sure branch (finish the delete; drop `raw-readings`) gave the expected end state in both.

### 2. The move-aside route

On both policies the refusal now reads: "If items holds documents you need, rename it in mongosh, for example with db.getCollection("items").renameCollection("items_kept"), and run the command again … Then copy the documents back, for example with db.getCollection("items_kept").aggregate([{ $merge: { into: "items" } }]), and drop collection items_kept. The documents you copy back must satisfy any validator collection items has after the run." The sentence saying no recovery exists is gone.

- `r24g` (`mkp23.sh r24g migrate`, migrate only): the text offers the move-aside route and does not name `db sign`, `reconcile` or `--permit-policy-change`. I renamed, ran `db migrate` (it created `items` with its validator and index `t_1`), copied back with the printed `$merge` and dropped `items_kept`. The document was kept. `migration status`: "Up to date", both migrations marked applied. `db verify` passed. A second `db migrate` did nothing.
- `r24h` (migrate only, `items` also holding a document whose `level` is `medium`, outside the enum): the printed `$merge` failed with "Document failed validation" after copying the valid documents, so `items` held 1 and 3 and `items_kept` still held all three. I fixed the document in `items_kept`, ran the same `$merge` again (it is safe to repeat, since it matches on `_id`) and dropped `items_kept`. All three kept. `migration status` up to date, both applied; `db verify` passed.
- `r24i` (`migrate,reconcile`, `items` given its own validator requiring `t` beforehand): the text offers the move-aside route first, then "Or, without moving the documents, … run db sign …". I followed the move-aside route: after the run `items` has the migration's validator, not the old one, and the document was kept. `migration status` up to date, both applied; `db verify` passed.
- `r24j` (migrate only, `mkp24.sh`: the migration creates a unique index on `t`, and two documents share `t`): the `$merge` failed with a DuplicateKey error after copying one, so `items_kept` held both. Nothing was lost, but the text names only the validator (finding 47).

### 3. An extension space

The CLI reaches this case: a descriptor with a `contractSpace` in the config's `extensions` (`ext24.mjs`) is pinned under `migrations/audit/` by `contract emit`, and `db migrate` runs it. In `r24k` I applied the app's base migration under a ref with `change: ["migrate"]`, added the extension, created `audit_log` with one document and ran `db migrate`. The refusal ends "The apply stopped in contract space "audit"", offers the move-aside route, and does not name `db sign`. Following it: rename, `db migrate`, `$merge` back, drop. The document was kept. `migration status`: both spaces up to date, the audit migration applied. `db verify` passed. The refusal's first route says to "run its migration.ts with node", but an extension's migration has no `migration.ts` (finding 48).

`db verify` prints "Schema warnings" naming `audit_log` and `others` in this project. `r24l`, where the extension was applied normally with no stop, prints the same, so it is not from this change.

### 4. Regression

Round 23 case 3 repeated round 22 cases 1 and 5.

- Round 22 case 1. `r24m` (stop after commit, then `_id` 9 inserted into `measurements`): count 5, "any other number", settle by hand. I deleted 2, 3, 4, 5 from `events` and re-ran. End: 2, 3, 4, 5, 9 once each. The delete-from-target case is `r24d` and the write-to-source case is `r24c`, both above. Next plan: no changes.
- Round 22 case 5. The move both ways is `r24a` and `r24b` above. `r24n` (rename route `readings` to `sensor_readings`, stop after commit): count 3; I dropped `readings` and re-ran. `r24o` (stop before `$out` was sent): the same text apart from the port; count 0; re-ran as it is. End for both: `sensor_readings` 1, 2, 3 once each, granularity `hours` kept, duplicates query nothing, next plan no changes.

## Findings

### 47. The move-aside route names the validator but not the unique indexes the migration creates

The text says the documents copied back "must satisfy any validator collection items has after the run". In `r24j` the migration creates a unique index on `t`, and the kept documents share a `t`. The printed `$merge` then fails with a DuplicateKey error after copying some documents. The same partial copy happens when a document fails the validator (`r24h`). Nothing is lost while the user keeps `items_kept`, and the `$merge` can be run again once the documents are fixed. But the text does not say either thing, and its last step is "drop collection items_kept", so a user who drops it after a failed copy loses the documents not yet copied. Suggested fix: say the documents must satisfy the collection's validator and its unique indexes, and that if the copy fails, fix the documents in `items_kept` and run the copy again before dropping it.

### 48. In an extension space, the first route tells the user to run a `migration.ts` that does not exist

The refusal starts every route list with "If no other database has applied this migration, run its migration.ts with node, which writes its ops.json again". An extension's migration ships in its package; its pinned directory under `migrations/audit/` holds only `migration.json` and `ops.json` (`r24k`), and writing it again is not the user's to do. The text predates this commit, but this commit makes the extension case get the same refusal. The harm is small: the user finds no file and moves to the next route. Suggested fix: leave out that route when the space is not the application's.

## Notes, not findings

- "Settled which documents each should keep" does not say what state the re-run expects. A user can work it out from the next sentences ("the copy has no check, so it runs again, and it would add the documents still in collection events"): leave in the source only the documents still to be moved. I did that in `r24c`, `r24d` and `r24m`.
- In `r24c` the count still showed the finished number after the writes. Only the "nothing wrote to or deleted from either collection" condition keeps a user from running the deletes, which would remove the new `_id` 8 and the update to `_id` 3. The text states that condition before each count conclusion.

## Cleanup

MongoDB and the proxies are stopped. Scratch projects and helpers stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
