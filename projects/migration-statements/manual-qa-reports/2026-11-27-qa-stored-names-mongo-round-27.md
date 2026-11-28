# Manual QA — stored-name renames on MongoDB, round 27

Date: 2026-11-27. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `5c7fc58cdb`. Earlier round: `2026-11-27-qa-stored-names-mongo-round-26.md` in this folder. This round checks commit `5c7fc58cdb` (a stopped create with no after-check names every collection the next run stops at, including those the stopped run made and, for an extension, those of later migrations, and copy counts hold only if nothing wrote since the apply started).

Status: done. Two new findings, both low. When a run stops at a later migration's create, the refusal now names the collection an earlier migration of the same run created, and following the steps kept every document by both routes; `db verify` passed. The same holds for an extension space with two migrations, in both directions. The printed `$currentOp` query lists a copy whose command is 3.8 KB. Round 26's cases 1 and 2 still pass. Finding 49: a stop in an earlier application migration does not name a collection a later migration of the run creates that already exists, so the drop route stops again at a collection the error did not name. Finding 50: when a later migration of the run changes the documents of a collection an earlier migration created, the copy moved aside keeps the earlier migration's validator, and MongoDB refuses the edit step 4 asks for.

## Setup

- `dist` was current: `dist/control.mjs` was built at 17:20, no source file is newer, and it holds the new texts (`the next run would also stop`, `since the apply started`). No build was run.
- MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end with the proxies and helper processes.
- Round 18 to 26 helpers reused (`mk.sh`, `c.sh`, `cs.sh`, `p.sh`, `q.sh`, `mk18.sh`, `mkp26.sh`, `proxy25.mjs`, `stop25.sh`, `via20.sh`, `rehash20.mjs`, `stripsnap.mjs`, `cop26.mjs`, `app26.mjs`). New:
  - `mkp27.sh`: base migration (`others`) applied; then migration `notesm` creates `notes` (validator, unique `code_1`), and `itemsm`, planned from `notesm`, creates `items` (validator, unique `t_1`). Both creates have their after-check emptied. `items` is put in place with 2 documents. Contracts `ctr/r27a1.prisma`, `ctr/r27a2.prisma`.
  - `mkp27m.sh`: `mkp27.sh` with `CTR2=ctr/r27m2.prisma`, where `itemsm` also renames the stored field `notes.code` to `ref`.
  - `ext27.mjs`: a Mongo extension with contract space `audit` of two migrations: the first creates `audit_log`, the second `audit_extra`, each with a validator and no after-check. `mkx27.sh` applies the app's base migration, adds the extension to the config and pins `migrations/audit/` with `contract emit`.
  - `long27.py`: adds round 26's sleeping stage and a no-op `$match` holding a 3,000-character string to the copy of `mk18.sh`'s time-series move; the copy operation is then 3,788 characters. `slow27.py` adds only the sleeping stage, as in round 26.
- mongosh is not installed. Each `mongosh` step was run as the same server command through the Node driver; the `$currentOp` query was evaluated word for word from the CLI text by `cop26.mjs`.
- Projects `wip/qa-mongo/r27a`–`r27m`.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1 | A run that stops at a later migration's create, by the move-aside and drop routes | `r27a`–`r27e`, `r27m` | ✅ with findings 49 and 50 |
| 2 | The same for an extension space with a later migration | `r27f`–`r27h` | ✅ |
| 3 | A copy with a pipeline over 2 KB, and the printed `$currentOp` query | `r27i` | ✅ |
| 4 | Regression: round 26 cases 1 and 2 | `r27j`, `r27k`, `r27l` | ✅ |

### 1. A run that stops at a later migration's create

`r27a`: `db migrate` ran `notesm`, which created `notes`, then refused at `collection.items.create`. `migration status` still shows `@db` at base, with `notesm` and `itemsm` pending, so the next run does start again from the marker, as the text says. The text says: "Whether you drop items or move it aside, the next run would also stop at the create of collection notes, which the run that stopped created in this migration or an earlier one, so it holds only documents written since. Before that run, move each of them aside as below if it holds documents you need, or drop it if it holds nothing you need." The move-aside route names `db migrate --to 20261127T0626_itemsm`.

Move-aside route (`r27a`): I wrote one document into `notes` after the stop, as an application would. Step 2: renamed `items` to `items_kept` and `notes` to `notes_kept`. Step 3: `db migrate --to 20261127T0626_itemsm` applied both migrations; `items` and `notes` were created with their validators and `t_1` and `code_1`, both empty. Step 4: the `$nor` and `$group` queries found nothing in either. Step 5: `$merge` with `whenMatched: "fail"`. Step 6: counts 2 and 2, 1 and 1; dropped both `_kept` collections. Step 7: `db migrate`, the command as run, had nothing left to do. All three documents kept; all three migrations applied; `db verify` passed.

Drop route:
- `r27b` (`items` emptied, so it holds nothing needed; one document written to `notes` after the stop): dropped `items`, moved `notes` to `notes_kept`, ran `db migrate`. It applied both migrations without stopping. Copied `notes_kept` back (1 and 1), dropped it. `db verify` passed.
- `r27c` (both hold nothing needed): dropped both, ran `db migrate`. It applied both migrations without stopping; `db verify` passed.
- Control, `r27d`: dropped only `items` and left `notes`. The next run stopped at `collection.notes.create`, the collection the first error named.

`r27e`, the stop one migration earlier (finding 49): `notes` and `items` both exist before the first run. `db migrate` refused at `collection.notes.create`, in `notesm`, and the text does not mention `items`. Taking its drop route, "If notes holds nothing you need, drop it, then run the command again", the next `db migrate` stopped at `collection.items.create`.

`r27m`, a later migration that changes the earlier collection's documents (finding 50): `itemsm` creates `items`, then drops `code_1`, renames `notes.code` to `ref`, creates `ref_1` and updates the `notes` validator. The refusal is as in `r27a`. I wrote one document with `code` into `notes`, moved both aside and ran `db migrate --to itemsm`. Step 4's `$nor` query over the new `notes` validator found that document, correctly. Applying the rename to it, `db.notes_kept.updateMany({}, { $rename: { code: "ref" } })`, failed with "Document failed validation": `notes_kept` still has the validator `notesm` gave it, which requires `code` and forbids other fields. With `bypassDocumentValidation: true` the rename went through, the `$nor` query found nothing, the copy back gave 2 and 2, 1 and 1, `db migrate` had nothing left, and `db verify` passed. The document ends with `ref: "w1"`.

### 2. An extension space with a later migration

- `r27f` (`audit_extra` exists with 2 documents): `db migrate` created `audit_log` and refused at `collection.audit_extra.create`. The text names `audit_log` as created by the run that stopped, says "run the command again" in place of `--to`, and points to the part for an extension's migration. I wrote one document into `audit_log`, moved both aside, ran `db migrate` (both migrations applied, both collections empty), found nothing with the `$nor` queries, copied back (1 and 1, 2 and 2) and dropped the `_kept` collections. Both audit migrations applied; `db verify` passed.
- `r27g` (`audit_log` empty and `audit_extra` with 1 document, both before the run): refused at `collection.audit_log.create`, and the text says "the next run would also stop at the create of collection audit_extra, which this migration or a later one of the extension also creates and which already exists." Drop route: dropped `audit_log`, moved `audit_extra` aside, ran `db migrate` (no stop), copied back 1 and 1. `db verify` passed.
- `r27h` (the `r27f` stop with `audit_extra` empty): dropped both named collections and ran `db migrate`; it did not stop; `db verify` passed.

### 3. A copy with a pipeline over 2 KB

`r27i` (`mk18.sh` time-series move with `long27.py`: an 8-second sleep per document and the 3,000-character `$match`, connection dropped 300 ms after the `$out` was forwarded). The stop text prints the query. Run verbatim right after the stop, it listed the copy (`$db` `r27i`, `aggregate: "measurements"`, last stage `$out`, read from `command.pipeline`, so the pipeline was there in full). The count was 0. The server's `currentOp` command filtered on `command.aggregate` returned nothing at the same moment, which matches the error reference's warning about `db.currentOp()` cutting long commands. I ran the query every 2.5 seconds; it listed the copy for 14 seconds, then nothing; the count was then 4. Every count condition in the text says "since the apply started" (three times), and neither `src/`, `dist/` nor the error reference has "since the apply stopped" any more. I ran the two deletes (2 and 2) and `db migrate`. End: `measurements` holds 2, 3, 4, 5 once each, still time-series; `events` holds e1; the duplicates query finds nothing; `db verify` passed; the next plan: "No changes detected".

### 4. Regression

- Round 26 case 1 (`r27j`, `mkp26.sh`): `db migrate --to production` refused at `collection.items.create`; the text names `notes` as "this migration also creates and which already exists" and keeps `--to production` in its closing line. Moved both aside, `db migrate --to 20261127T0631_two`, checks found nothing, copied back 2 and 2, 3 and 3, dropped the `_kept` collections, `db migrate --to production` applied `three` only (`items` documents have `name`, index `name_1`), `four` stayed pending. A plain `db migrate` then applied `four`, and `db verify` passed.
- Round 26 case 2, wait route (`r27k`, with `app26.mjs` running a 30-second read on `measurements` and a slow `$out` into `measurements` in `r27k_other`): the query listed only the copy of `r27k`, not the read and not the other database's copy, for about 16 seconds, then nothing; count 4. Deletes 2 and 2, command again. End as in case 3; `db verify` passed; no changes.
- Round 26 case 2, `killOp` route (`r27l`, with the read running): the query listed only the copy; `killOp` returned "attempting to kill op"; the query then listed nothing while the read still ran; count 0, no temporary collection left. I ran the command again as it is. End as in case 3; `db verify` passed; no changes.

## Findings

### 49. A stop in an earlier application migration does not name existing collections of later migrations in the run (low)

`r27e`: `notesm` creates `notes`, `itemsm` creates `items`, both with no after-check, and both collections exist before `db migrate`. The run stops at `notes`. For an application migration the runner looks for other existing collections only up to the end of the stopped migration, so the text does not name `items`. That fits the move-aside route, whose `--to notesm` stops before `itemsm`. But the drop route says "drop it, then run the command again", and that run goes on to `itemsm` and stops at `items`, which the error did not name. Step 7 of the move-aside route, the command as run, stops there too. Nothing is lost: the second refusal gives the same choices. Where it lives: `uncheckedCreateRefusal` in `packages/3-targets/mongo/1-target/src/core/migrations/mongo-runner.ts`, where `end` is the end of this migration for the application space, and the error reference's sentence "the later ones of this migration whose collection already exists".

### 50. A collection created by an earlier migration of the run cannot be edited in step 4 when a later migration changes its documents (low)

`r27m`: `notesm` creates `notes`; `itemsm` creates `items` and then renames the stored field `notes.code` to `ref`. The run stops at `items`; the text names `notes` and says to move it aside "as below". After step 3 (`--to itemsm`), step 4 asks the user to apply each change the later operations make to the moved documents. But `notes_kept` is the collection `notesm` created, so it keeps that migration's strict validator, which requires `code` and forbids `ref`. `updateMany` with `$rename` fails with "Document failed validation". The steps give no way past it: `bypassDocumentValidation`, a `collMod` that relaxes the kept collection's validator, or making the change in the copy back's pipeline all work, and none is mentioned. Step 4 also speaks of "every operation of this migration after the create", while here the changes come from a later migration than the one that created `notes`. Nothing is lost: the documents stay in `notes_kept`, and step 4's `$nor` query shows which ones do not fit. This only happens for collections the stopped run created in an earlier migration, which is what this commit adds. Where it lives: "Moving a MongoDB collection aside" steps 2 and 4 in `docs/reference/error-reference.md`.

## Notes, not findings

- In `r27k` and `r27l` I first ran `migration plan` through `c.sh`, which emits a contract with the time-series collection's validator, and `db verify` then failed with "missing: measurements/validator". That is my harness: these projects need `cs.sh`, which strips that validator as in earlier rounds. Re-emitted with `cs.sh`, `db verify` passed for `r27i`, `r27k` and `r27l`, and the plan was "No changes detected".
- The `db sign` route in the `r27a` refusal speaks of "this migration" only, although `notesm`'s operations also ran in the stopped run. `db sign` with `itemsm`'s directory records the database at `itemsm`'s contract, which covers both, so following it would work. Not tested further.

## Cleanup

MongoDB, the proxies and the helper processes are stopped. Scratch projects and helpers stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
