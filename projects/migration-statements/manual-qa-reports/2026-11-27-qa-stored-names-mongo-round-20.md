# Manual QA — stored-name renames on MongoDB, round 20

Date: 2026-11-27. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `aaec3a4157`. Earlier round: `2026-11-27-qa-stored-names-mongo-round-19.md` in this folder. This round checks commits `bce67290ab` (advice for a time-series copy that stopped while it ran, and for a create written before creates had an after-check) and `cca114012f` (the time-series rename route says to stop writes to both collections).

Status: done. No findings (numbering would start at 40). Every printed instruction, followed as written, left each document in its target exactly once.

## Setup

- `dist` was stale for one change: it had an earlier wording of the create advice ("delete this migration and plan it again"). I ran one `pnpm build` through the shared lock (96 of 105 tasks cached). Cases 1 and 2 were run again on the new build and printed the same text, byte for byte.
- MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 18 and 19 helpers reused (`mk18.sh`, `mkts2.sh`, `ins19h.py`, `rmboom.py`, `agg19.mjs`, `ctr/r17a0.ts`, `ctr/r17a1.ts`, `ctr/r19j0.prisma`, `ctr/r19j1.prisma`). New: `proxy20.mjs`, `via20.sh`, `rehash20.mjs`. Projects `wip/qa-mongo/r20a`–`r20n`.
- `proxy20.mjs` is a TCP proxy the CLI connects through (`directConnection=true`, set by `via20.sh`). In `reply` mode it forwards the first request holding `$out`, lets the server run it, and drops the connection when the answer comes back, so the `$out` has written but the CLI sees `connection 1 to 127.0.0.1:<port> closed`. In `swallow` mode it drops the connection without forwarding that request, so the copy never runs.
- Time-series validators were removed from the emitted contract before planning, as in earlier rounds.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1 | Copy interrupted after its `$out` wrote, and before it was sent | `r20a`, `r20b`, `r20c`, `r20h`, `r20i` | ✅ |
| 2 | Server error inside the copy pipeline | `r20d`, `r20e`, `r20j` | ✅ |
| 3 | Create with an empty postcheck, target exists with other options | `r20f`, `r20g` | ✅ |
| 4 | Time-series rename route, `migration plan` and `db update` | `r20k` | ✅ |
| 5 | Regression: round 19 cases 1a and 2c | `r20n`, `r20l`, `r20m` | ✅ |

### 1. A copy that fails while it runs

- `r20a` (move into time-series `measurements` with two deletes, `reply` mode): the error says the copy "was copying … when the apply stopped, and the copy may have finished", names both pending deletes, and says how to tell: look in `measurements` for the `_id` of an `events` document that a delete's filter selects. It does not say the database is unchanged. The check found `_id` 2 and 3 in `measurements`, so the copy had finished. I ran both deletes on `events` with their filters (2 and 2) and re-ran. End: `measurements` 2, 3, 4, 5 once each, `x` removed, time-series options kept; `events` e1. The printed doubles query returned nothing. Next plan: no changes.
- `r20b` (same move, `swallow` mode): the same text. The check found none of those `_id` values in `measurements`, so the copy had not run. I re-ran as it is. End: `measurements` 2, 3, 4, 5 once each; `events` e1.
- `r20h` (same as `r20a`, on the new build): I re-ran too early without the deletes. `measurements` then held 2, 3, 4 and 5 twice each; the printed query returned exactly those four, each `n: 2`.
- `r20c` and `r20i` (time-series rename route, `readings` → `sensor_readings`, copy then drop, `reply` mode): the error says the copy may have finished, that the drop of `readings` has not run, and to look in `sensor_readings` for the `_id` of a `readings` document. All three were there. I dropped `readings` as the text says and re-ran. End: `sensor_readings` 1, 2, 3 once each, granularity `hours` kept; `readings` gone. Next plan: no changes.

### 2. A server error during the copy

- `r20d`: a runtime error inside the copy (`$divide` by zero on the moved documents, MongoDB error 2). `r20e` and `r20j`: an unknown stage `$boom` in the copy (error 40324). In all three the text says "Collection measurements is as it was: an $out stage replaces it only when the whole pipeline succeeds", and never says the copy may have finished. `measurements` was empty and `events` untouched in each. In `r20d` I removed the bad stage, ran `migration.ts` with node and re-ran: 2, 3, 4, 5 once each.

### 3. A create written before creates had an after-check

- Setup: a migration creating `items` (validator, `strict`, `error`) and its index. I set the create's postcheck in `ops.json` to `[]` and recomputed `migrationHash`, as an older migration would have it. I created a plain `items` with one document.
- The refusal now says: drop `items` if it holds nothing you need; otherwise run `migration.ts` with node, which writes `ops.json` again, only if no other database has applied it, then give `items` the options of the `createCollection` call and run again.
- `r20f`: I ran `migration.ts` with node; the create got its postcheck back and a new hash. I gave `items` the validator, level and action with `collMod` and re-ran. "1 of 2 operation(s); the other 1 had nothing to do": the create was skipped, the index created, the document kept. Next plan: no changes.
- `r20g`: I dropped `items` and re-ran. Both operations ran; `items` has its validator and index. Next plan: no changes.

### 4. The time-series rename route

- `r20k`: `--rename Reading:Sample` on time-series `readings`. Under both `migration plan` and `db update` the text says "stop writes to collections "readings" and "sensor_readings"", and "Allow writes again only once it has run (applied), re-runs included", with both reasons: a document written to `readings` after the copy is dropped with it, and the `$out` stage replaces `sensor_readings`, so a document written there while the copy runs is lost. The two commands print the same advice.

### 5. Regression

- `r20n` (case 1a): stop after the copy. The text uses the "copied" form, not "may have finished". The printed query returned nothing. I finished both deletes and re-ran. End: `measurements` 2, 3, 4, 5 once each, `x` gone, time-series kept; `events` e1. Next plan: no changes.
- `r20l` (`migration plan`) and `r20m` (`db update`), case 2c: `@@map("items")` → `things`, `@map("t")` → `ttl` (indexed), enum `"low"` → `"lo"` on a scalar and a list. Nothing asked, 7 operations, both documents once each with the right values, index `ttl_1`. The next plan, or `db update`, had no operations.

## Findings

None.

## Notes, not findings

- The interrupted-copy text opens with the shared "Fix what the error names, then run the command again; operations that already ran are skipped", and later says the copy has no check and runs again. The later sentences are right and tell the user what to do first, but the opening reads as if the re-run is safe.
- The third outcome, an apply that stops right after an operation finished (a throw in the callback after it), cannot be caused from the CLI, so I did not check its text.

## Cleanup

MongoDB and the proxies are stopped. Scratch projects stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
