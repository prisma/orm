# Manual QA — stored-name renames on MongoDB, round 28

Date: 2026-11-27. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `1e869e7330`. Earlier round: `2026-11-27-qa-stored-names-mongo-round-27.md` in this folder. This round checks commit `1e869e7330`: a stopped create with no after-check now gives advice for its own collection only, says the next run may stop at another such create and that the same steps apply there, says to drop a collection an earlier run created unless the application wrote to it since, and step 4 of the move-aside procedure removes the moved-aside copy's validator with `collMod`.

Status: done. Two new findings, both low. Following the advice at each stop, by both routes, `db migrate` succeeded in every case, every document the application wrote was kept, and `db verify` passed. Finding 49 is fixed: the later stop it described still happens, and the error and step 7 now say to follow the same steps there. Finding 50 is fixed: with step 4's `collMod`, the later migration's rename went through and the copy back succeeded. Finding 51: the short "keep only those documents and copy them back after the run" route in the error does not say that later operations of the run may change those documents, so a plain copy back can fail validation; nothing is lost. Finding 52: nothing the CLI prints tells the user whether an earlier run created the collection, which the new sentence asks them to judge.

## Setup

- `dist` was current: `packages/3-targets/mongo/1-target/dist/control.mjs` holds the new text (`may stop at another create`) and not the old (`the next run would also stop`), and no source file is newer. No build was run.
- MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end with the proxy.
- Round 18 to 27 helpers reused (`mk.sh`, `c.sh`, `cs.sh`, `p.sh`, `q.sh`, `mk18.sh`, `mkp27.sh`, `mkp27m.sh`, `mkx27.sh`, `ext27.mjs`, `long27.py`, `stop25.sh`, `proxy25.mjs`, `via20.sh`, `rehash20.mjs`, `cop26.mjs`, `ins-move.mjs`). New:
  - `chk28.mjs`: steps 4 to 6 for one moved-aside collection: `collMod` with `validator: {}` on `<coll>_kept`, the `$nor` query against the new collection's validator, the duplicates `$group` on the unique field, `$merge` with `whenMatched: "fail"`, the counts, and the drop of `_kept` when the counts add up.
  - `mkp28s.sh` with `seed28.txt`: `mkp27.sh` where `notesm` also has a data transform that writes one document (`seed`) into `notes`, so a run writes documents into the collection it creates.
- mongosh is not installed. Each `mongosh` step was run as the same server command through the Node driver; the `$currentOp` query was evaluated word for word from the CLI text by `cop26.mjs`.
- Projects `wip/qa-mongo/r28a`–`r28s`.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1 | Two application migrations, both routes, every stop followed (round 27 case 1 and finding 49) | `r28a`, `r28b`, `r28c`, `r28e` | ✅ |
| 2 | A collection an earlier run created: drop it, or keep only what the application wrote | `r28a`, `r28b`, `r28c`, `r28s` | ✅ with findings 51 and 52 |
| 3 | A later migration changes a moved-aside collection with a strict validator (finding 50) | `r28m`, `r28n`, `r28o` | ✅ |
| 4 | An extension space with two migrations | `r28f`, `r28g`, `r28h` | ✅ |
| 5 | Regression: round 27 case 3 (copy with a pipeline over 2 KB) | `r28i` | ✅ |

### 1. Two application migrations

`r28a` (`mkp27.sh`: `items` exists with 2 documents). `db migrate` ran `notesm`, which created `notes`, then refused at `collection.items.create`. The text gives advice for `items` only, then: "If an earlier run of this command created items, …, so drop it, unless the application has written documents to it since", and ends with "The next run may stop at another create in the same state, in this migration or in another migration it applies; the same steps apply to it." It no longer names `notes`.

Move-aside route (`r28a`): I wrote one document into `notes` after the stop, as an application would. Step 2: renamed `items` to `items_kept` only, as the step now says. Step 3: `db migrate --to …_itemsm` refused at `collection.notes.create`, "The failed apply changed nothing". That is the later stop the text warned of. For `notes` I followed the same steps: renamed it to `notes_kept`, ran `db migrate --to …_notesm` (created `notes` with its validator and `code_1`), ran `chk28.mjs` (nothing rejected, copy back 1 and 1), then step 7 for `notes`, the command that stopped as I ran it: `db migrate --to …_itemsm`. It created `items` and `t_1`, which completed step 3 for `items`. Steps 4 to 6 for `items`: nothing rejected, 2 and 2. Step 7 for `items`, `db migrate`: already up to date. All three documents kept; `db verify` passed.

Drop route:
- `r28b` (`items` holds nothing needed; one document written to `notes` after the stop): dropped `items`, ran `db migrate`, which refused at `notes`. The application had written to `notes`, so I kept that document: renamed `notes` to `notes_kept`, ran `db migrate` (applied both migrations), copied it back (1 and 1). `db verify` passed.
- `r28c` (nothing needed in either): dropped `items`; the next run stopped at `notes`; the application had written nothing to it, so I dropped it; the next run applied both migrations. `db verify` passed.

`r28e`, round 27's finding 49 (`notes` with 2 documents and `items` with 2 documents both exist before the first run): `db migrate` refused at `collection.notes.create` with `--to …_notesm`. Move-aside route for `notes`: renamed it, `--to …_notesm`, copied back 2 and 2. Step 7, `db migrate`, refused at `collection.items.create`; step 7 now says "If it stops at another create in the same state, …, follow the same steps for that collection". Same steps for `items` with `--to …_itemsm`: copy back 2 and 2; `db migrate` up to date. `migration status`: base, `notesm` and `itemsm` applied. `db verify` passed. Finding 49 is fixed.

### 2. A collection an earlier run created

`r28s` (`mkp28s.sh`: `notesm` also writes a `seed` document into `notes`). `db migrate` created `notes`, wrote `seed` and refused at `items`. I wrote `w1` into `notes`, moved `items` aside, ran `--to …_itemsm`, which refused at `notes`. The text says the run's documents "came from that run, and the next run writes them again", so I kept only `w1`: copied it into `notes_kept` with `$match` on its `_id`, dropped `notes`, and ran `--to …_itemsm`. That run created `notes`, wrote `seed` again, and created `items`. Copied `w1` back (1 into 1, giving 2) and `items` back (2 and 2). End: `notes` holds `seed` and `w1` once each; `items` 2; `db verify` passed.

`r28a`, `r28b` and `r28c` above cover the other cases: the application wrote to the collection (kept), and it did not (dropped). No document the application wrote was lost.

### 3. A later migration changes a moved-aside collection (finding 50)

`mkp27m.sh` with `CTR2=ctr/r27m2.prisma`: `itemsm` creates `items`, drops `code_1`, renames `notes.code` to `ref`, creates `ref_1` and updates the `notes` validator.

- `r28m`, the short route: stop at `items`; I wrote `w1` with `code` into `notes`; moved `items` aside; `--to …_itemsm` stopped at `notes`; I kept `w1` (moved `notes` to `notes_kept`) and ran `--to …_itemsm`, which applied both migrations, including the rename on the empty `notes`. `updateMany({}, { $rename: { code: "ref" } })` on `notes_kept` without step 4's `collMod` failed with "Document failed validation", as in round 27. Following step 4: `collMod` with `validator: {}`, then the rename (1 changed), the `$nor` query found nothing, the copy back gave 1 and 1. `items` 2 and 2. `db migrate` up to date; `db verify` passed; the document ends `{ body: "w1", ref: "w1" }`. Finding 50 is fixed.
- `r28n`, the full move-aside route for `notes`: `--to …_notesm`, copy back with `code`, then step 7 `--to …_itemsm` applied `itemsm`, whose rename changed the copied document. `items` 2 and 2; `db verify` passed; same end state.
- `r28o`, control for finding 51: as `r28m`, but copied `notes_kept` back without step 4. `$merge` failed with "Document failed validation"; `notes` held 0 and `notes_kept` 1, so nothing was lost.

### 4. An extension space with two migrations

- `r28f` (`audit_extra` exists with 2 documents): `db migrate` created `audit_log` and refused at `collection.audit_extra.create`. The text gives "run the command again" in place of `--to`, points to the part for an extension's migration, and ends with the "may stop at another create" sentence. I wrote `w1` into `audit_log`, moved `audit_extra` aside and ran `db migrate`, which refused at `audit_log`. I kept `w1` (moved `audit_log` aside), ran `db migrate` (both audit migrations applied), and copied both back (1 and 1, 2 and 2). Both audit migrations applied in `migration status`; `db verify` passed.
- `r28g` (`audit_log` empty and `audit_extra` with 1 document, both before the run): refused at `audit_log`; dropped it; the next run refused at `audit_extra`; moved it aside; the next run refused at `audit_log` again, which that run had created with nothing written to it since, so I dropped it; the next run applied both. Copied back 1 and 1; `db verify` passed.
- `r28h` (the `r28f` stop with `audit_extra` empty): dropped `audit_extra`; the next run stopped at `audit_log`; dropped it; the next run applied both; `db verify` passed.

### 5. Regression: a copy with a pipeline over 2 KB

`r28i` (`mk18.sh … none` with `long27.py`, connection dropped 300 ms after the `$out` was forwarded, through `stop25.sh` on port 47028). Run every 2.5 seconds, the printed query listed the copy (`$db` `r28i`, `aggregate: "measurements"`, last stage `$out`) from 10 to 15 seconds after the stop, count 0, then nothing, count 4. "since the apply started" appears 3 times and "since the apply stopped" not at all. I ran the two deletes (2 and 2) and `db migrate`. End: `measurements` holds 2, 3, 4, 5 once each, still time-series; `events` holds `e1`; the duplicates query finds nothing; `db verify` passed; the next plan: "No changes detected".

## Findings

### 51. The short route for a collection an earlier run created does not mention the later changes (low)

`r28o`: the error says, for a collection an earlier run created, "drop it, unless the application has written documents to it since: then keep only those documents and copy them back after the run". When a later operation of that run changes the collection's documents (here `itemsm` renames `notes.code` to `ref` and updates the validator), a plain copy back fails with "Document failed validation". The sentence does not say to stop the application's writes, or to apply the later changes to the kept documents first, as steps 1 and 4 of "Moving a MongoDB collection aside" do. The procedure's new first paragraph covers this case and points to step 5, so a user who follows it is fine, but the sentence in the error does not send them there; the "Follow every step" sentence belongs to the move-aside route that comes after it. Nothing is lost: the copy fails and the documents stay in the kept collection. Where it lives: `madeByEarlierRunText` in `packages/3-targets/mongo/1-target/src/core/migrations/mongo-runner.ts`.

### 52. Nothing printed tells the user whether an earlier run created the collection (low)

`r28a`, `r28s`, `r28f`: at the second stop, the advice depends on "If an earlier run of this command created notes". The first refusal no longer names the collections the stopped run created, says only "The operations that ran before the failure stay applied", and does not list them, and `migration status` shows the migration as pending. So the user has to remember whether `notes` existed before their first run. A user can work it out (a run that reached a later create made every earlier collection it created with no after-check), but nothing says so. A user who guesses wrong either drops a collection that held their documents from before, as in `r28e` on a second attempt, if they take it as made by "an earlier run" and believe nothing was written since; or keeps documents the run writes again, whose copy back then fails on `_id` with `whenMatched: "fail"`. The first is a loss. In this round I knew the history, so it did not happen. Where it lives: the removal of the `madeByRun` list in `uncheckedCreateTargetExistsRefusal`, and the procedure's new first paragraph in `docs/reference/error-reference.md`.

## Notes, not findings

- In `r28a`, the second stop came from `--to …_itemsm`, and step 7 for `notes` is that command again, which also finishes step 3 for `items`. The nesting worked, but a user has to track two procedures at once.
- "its documents came from that run" is not true of `notes` in `r28a`, which the run created empty; the "unless the application has written documents to it since" part still gives the right action.

## Cleanup

MongoDB and the proxy are stopped. Scratch projects and helpers stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
