# Manual QA run — slice 1, model rename hints

- **Commit:** `b8b667ebcd55609bdbb69902ae98ecac0574c69a` (branch `tml-3422-intent-hints-model-rename`).
- **Runner:** Claude Opus, 2026-10-01.
- **Build:** `pnpm build` in the worktree (exit 0). While the run was in progress, another agent began editing tracked sources in the worktree (`packages/2-sql/9-family/...`, `packages/3-targets/3-targets/{postgres,sqlite}/src/core/migrations/...`) and rebuilding `dist`. To run against the commit and not a moving tree, I made a detached checkout of the commit at `wip/qa/tree` (`git worktree add --detach`), ran `pnpm install --frozen-lockfile` and `pnpm build` there (turbo: 87/87 cached, exit 0), and ran every step below with that checkout's CLI, `wip/qa/tree/node_modules/.bin/prisma` (`--version` → `8.0.0-rc.14`). Scenario A was run once against the main worktree's build and then rerun in full against the isolated build; only the rerun is reported.
- **Apps copied:**
  - `examples/prisma-8-demo` → `wip/qa/prisma-8-demo` (Scenarios A, C, D, E) and `wip/qa/prisma-8-demo-b` (Scenario B). `node_modules` links were repointed to the isolated checkout, because a copy one directory deeper breaks pnpm's relative links.
  - `packages/3-extensions/supabase` → `wip/qa/supabase-ext` (F2). pgvector ships no tables, so a model hint cannot be added to it.
- **Database:** in-process Postgres from `@prisma/dev` (PGlite, Postgres 17.5), started with the `createDevDatabase` script from `examples/prisma7-adoption/scripts/db-start.ts`. Three instances: A/C/D/E, a fresh one for A8, and one for B. Postgres.app on :5432 refuses connections from agent processes; Homebrew Postgres has no pgvector.
- **Model renamed:** `Tag` (table `tag`) → `Label` (table `label`) with `@@hint(was: "tag")`. `tag` has rows (3), a unique field (`label`), an incoming foreign key (`post_tag.tagId`), and a primary key. It had no index, so I added `@@index([label])` to the base schema before the first `db update` (B: before the first migration, see B setup). Base and renamed schemas: `wip/qa/base.prisma`, `wip/qa/renamed-hint.prisma`, `wip/qa/renamed-nohint.prisma`.
- **Output mode:** the CLI prints NDJSON whenever stdout is not a TTY. "Human mode" below means `--format human --no-color`.

## Scenario A — end user, PSL, `db update` project

Setup: `drop-db`, emit base schema, `db update --json` (21 additive operations), `scripts/seed.ts` (3 tags, 4 `post_tag` rows).

| Step | Result | Evidence | Notes |
| --- | --- | --- | --- |
| A1 | PASS | `prisma contract emit --json` with and without the hint line, both exit 0, both `"storageHash":"8b3761ad…62d7"`. Hinted `contract.json` keys: `[… 'capabilities', 'extensions', 'hints', 'meta', '_generated']`; `hints` = `{"namespaces": {"public": {"tables": {"label": {"was": "tag"}}}}}`. Unhinted has no `hints` key. | No `defaultControlPolicy` in the demo; `hints` sits directly before `meta`. Placement after `defaultControlPolicy` confirmed in F2 (supabase). |
| A2 | PASS | `prisma db update --json` → exit 0, no `DESTRUCTIVE` anywhere in output. Operations: `renameTable.tag \| Rename table "tag" to "label" \| widening`; `Rename primary key "tag_pkey" to "label_pkey"` widening; `Rename unique constraint "tag_label_key" to "label_label_key"` widening; `Rename index "tag_label_idx_2e736223" to "label_label_idx_2e736223"` widening. | |
| A3 | PASS | `pg_constraint`: `label\|label_pkey\|p`, `label\|label_label_key\|u`, `post_tag\|post_tag_tagId_fkey\|f\|label`. Index `label_label_idx_2e736223`. `select label from label` → `demo, orm, typescript`; `to_regclass('public.tag')` → null; join `post_tag`→`label` → 4 rows. | `label` owns no foreign key, so `<New>_<col>_fkey` was not exercised by this model. Supplementary run renaming `Post`→`Article` (`@@hint(was: "post")`): 5 widening ops, `post_userId_fkey`→`article_userId_fkey`, `post_pkey`→`article_pkey`, `post_userId_idx_…`→`article_userId_idx_…`, `post_priority_check_…`→`article_priority_check_…`; explicitly named `post_title_search_724b05e5` kept its name; `post_tag_postId_fkey` now references `article`; 3 rows; `db verify --schema-only` clean. |
| A4 | PASS | `prisma db update --json` → exit 0, `ops= 0`, summary `Database already matches contract across 2 space(s), signature updated`. | |
| A5 | PASS | `prisma db verify --schema-only --json` → exit 0, `"summary":"Database schema satisfies contract"`, `"issues":[]`. | |
| A6 | PASS | Hint line removed; emit exit 0 (no `hints` key); `db update --json` → exit 0, `ops= 0`. | |
| A7 | PASS | `CREATE TABLE "tag" (id int)`, emit, `db update --json` → exit 2, `"code": "MIGRATION.PLANNING_FAILED"`, `"why": "MIGRATION.HINT_CONTRADICTED: the rename hint on table \"label\" (was \"tag\") cannot apply: namespace \"public\" has both \"tag\" and \"label\"."`. Constraint/index dump before and after identical. Hand-made table dropped. | The next action ends: `If "tag" should be dropped, remove the hint and state the drop with a deleted hint on a model mapped to "tag".` This slice rejects `deleted` (see D4). The JSON error envelope has no `exitCode` field; the process exits 2. |
| A8 | PASS | Fresh database, hinted schema: `prisma db init --db <fresh> --format human` → exit 0, `Create table "label"`, `Add unique constraint on "label" (label)`, `Create index "label_label_idx_2e736223" on "label"`; no rename operation; `grep -ic hint` on the output → 0. DB: `label_pkey`, `label_label_key`, `label_label_idx_2e736223`. | Index name from `db init` equals the name A2's rename produced, so a renamed and a freshly created database agree. |

## Scenario B — end user, PSL, migration history project

Setup (fresh database, copy `prisma-8-demo-b`): `db migrate` applied the 4 shipped migrations (marker `06b2dc…`). The copy has no `migrations/app/refs/db.json` (it is not tracked), so `migration plan` first refused with `MIGRATION.PLAN_ORIGIN_UNKNOWN`. Emitted the base schema (+ `@@index([label])`), ran `db update` (`✔ Advanced ref "db" → e346d4…`), then `migration plan --from 06b2dc… --name add-tag-label-index` (1 op: `Create index "tag_label_idx_2e736223" on "tag"`) so the graph has an edge to the db ref, `db migrate` (no-op), and the seed.

| Step | Result | Evidence | Notes |
| --- | --- | --- | --- |
| B1 | PASS | `prisma migration plan --name rename-tag --format human` → exit 0, wrote `migrations/app/20261001T1900_rename_tag`. Output: the 4 rename operations, then `ℹ Hints applied` and `- rename hint on table "label" (was "tag"): renamed and recorded in this migration; you can remove the hint.` | |
| B2 | PASS | `migration.ts`: `return [...this.renameTable({ schema: 'public', table: 'tag', to: 'label' })];`. `ops.json`: `renameTable.tag`, `primaryKey.public.label.tag_pkey.rename`, `unique.public.label.tag_label_key.rename`, `index.public.label.tag_label_idx_2e736223.rename`, all `widening`. | |
| B3 | PASS | `prisma migration plan --name rename-tag-json --json` → exit 0. `consumedHints`: `[{"hint": {"kind": "renamed", "coordinate": {"namespaceId": "public", "entityKind": "table", "entityName": "label"}, "from": "tag"}, "text": "rename hint on table \"label\" (was \"tag\"): renamed and recorded in this migration; you can remove the hint."}]`. Directory `20261001T1901_rename_tag_json` deleted. | `warnings` also carried the expected fork warning (`The default origin ref 'db' points at e346d4…, which already has a migration leading to 8b3761…`). |
| B4 | PASS | `node migrations/app/20261001T1900_rename_tag/migration.ts` → `Wrote ops.json + migration.json to …`, exit 0. `cmp` against the copies saved after B1: `ops identical`, `migration.json identical`. | `--help` on the file explains it. |
| B5 | PASS | `prisma db migrate --format human` → exit 0, app space applied the 4 renames, marker `8b3761…`. DB: `label_pkey`, `label_label_key`, `label_label_idx_2e736223`, `post_tag_tagId_fkey → label`; rows `demo,orm,typescript`; no `tag` table; 4 joined `post_tag` rows. | |
| B6 | PASS | Hint still in emitted contract (`grep -c '"hints"'` → 1). `prisma migration plan --from 20261001T1900_rename_tag --format human` → exit 0, `✔ No changes detected`, from = to = `8b3761…`, no `Hints applied`. JSON: `noOp: true`, `consumedHints` absent, no directory written. | |
| B7 | PASS | `prisma migration show 20261001T1900_rename_tag` → exit 0, 4 ops and DDL. `prisma migration check` → exit 0, `✔ All checks passed`. `grep -rl hint` in the migration directory → no match. `migrations/snapshots/8b3761…/contract.json` has no `hints` key; emitted `src/prisma/contract.json` has it. | Also checked: no `contract_json` row in `prisma_contract.contract` carries a `hints` key, in either the B or the A database. |

## Scenario C — end user, TypeScript DSL

Uses `prisma.config.contract-ts.ts` (`prisma/contract.ts`, which has only `User` and `Post`). Renamed `User` → `Member`: `model('Member', …)`, `.sql({ table: 'member', hint: { was: 'user' } })`.

| Step | Result | Evidence | Notes |
| --- | --- | --- | --- |
| C1 | PASS | `prisma contract emit --config prisma.config.contract-ts.ts` → exit 0. `hints` = `{"namespaces": {"public": {"tables": {"member": {"was": "user"}}}}}`. Printed that contract to PSL (`contract print`) and emitted the PSL: same `hints`, same `storageHash`, same top-level key order. | |
| C2 | FAIL | `hint: { was: 'member' }`; `prisma contract emit --config prisma.config.contract-ts.ts --format human` → exit 2: `✘ [CONTRACT.SOURCE_LOAD_FAILED] Failed to resolve contract source` / `why: @@hint(was: "member") names the table's current name; the hint is spent, remove it.` / `→ Ensure contract.source.load resolves to ok(Contract) or returns structured diagnostics.` | Expected code `CONTRACT.HINT_INVALID`; actual code `CONTRACT.SOURCE_LOAD_FAILED`. `HINT_INVALID` appears nowhere in the JSON envelope. The message text is correct. The next action is advice for config authors, not for someone who wrote a spent hint. Artefacts: `artefacts/C2/`. |
| C3 | PASS | `tsc` (declaration emit off) on copies of the contract: control → exit 0; `hint: { deprecated: true }` → `error TS2353: Object literal may only specify known properties, and 'deprecated' does not exist in type 'TableHint'.`; `hint: { was: 'x', deleted: true }` → `error TS2322: Type 'true' is not assignable to type 'undefined'.` | The `deleted` error does not say that `deleted` is unsupported. |

## Scenario D — `contract print` and the language server

| Step | Result | Evidence | Notes |
| --- | --- | --- | --- |
| D1 | FAIL | `prisma contract print --output printed-a1.prisma` on the A1 schema → exit 0. Printed model ends `@@index([label], name: "label_label_idx")` / `@@hint(was: "tag")` / `@@map("label")`. Re-emitting the printed file: `hints` identical, `storageHash` identical. Same order from the TS contract (C1): `@@hint(was: "user")` then `@@map("member")`. | Expected: `@@hint(was: "<old>")` after `@@map`. Actual: `@@hint` is printed before `@@map`. The round trip itself is correct. Artefacts: `artefacts/D1/`. |
| D2 | PASS | Drove `prisma lsp --stdio` with a small JSON-RPC client (`wip/qa/lsp-client.mjs`). Completion after `@@` in `model Label` → `["base","check","control","discriminator","fullTextIndex","hint","id","index","map","rls","unique"]`; `hint` item has `"detail":"Tells the migration planner the intent behind a change to this model's table that a diff cannot infer."`. Signature help at `@@hint(` → label `@@hint(was?: string, deprecated?: boolean)`, parameter docs `was`: `The storage name this table had before it was renamed, as @@map would have spelled it.`, `deprecated`: `Reserved. Not yet supported.` | The text is in the completion item's `detail` field, not `documentation`. A live diagnostic on an empty `@@hint(` read `@@hint needs one of was, deleted or deprecated.`, which names `deleted`. |
| D3 | PASS | `@@hint(deprecated: true)`; `prisma contract emit` → exit 2, `PSL_HINT_INVALID: @@hint(deprecated:) is reserved and not yet supported. Remove the model from the schema and run db update, or mark it deleted once no application version reads it.` at `contract.prisma:80:3`. | The second sentence tells the user to "mark it deleted", which D4 shows is rejected. |
| D4 | PASS | `@@hint(deleted: true)`; `prisma contract emit` → exit 2, `PSL_INVALID_ATTRIBUTE_SYNTAX: Attribute "hint" received unknown argument "deleted"` at `contract.prisma:80:10`. | `@@hint()` gives `PSL_HINT_INVALID: @@hint needs one of was, deleted or deprecated.`, which lists `deleted` as an option. |

## Scenario E — consent change for non-data drops

Setup: `drop-db`, base schema (with `@@index([label])` on `Tag`), `db update`, seed.

| Step | Result | Evidence | Notes |
| --- | --- | --- | --- |
| E1 | PASS | Removed `@@index([label])`; emit; `prisma db update --json` (stdin `/dev/null`) → exit 0, `dropIndex.tag.tag_label_idx_2e736223 \| Drop index "tag_label_idx_2e736223" \| widening`, no `DESTRUCTIVE`. Repeated under a real TTY (`script`): no prompt, `✔ Applied 1 operation(s)`. | |
| E2 | FAIL | Removed `Task.description`; emit; `prisma db update --json` → exit 2, `"code": "CLI.CONSENT_REQUIRED"`, `"summary": "\"Apply 1 destructive operation(s) to template1? Data they remove cannot be recovered:\n  - Drop column \"description\" from \"task\"\" requires explicit consent, and the session is not interactive. Grant it by passing --confirm template1."`. Under a TTY it prompts `Type template1 to confirm.`. `--confirm template1` → exit 0, `dropColumn.task.description … destructive`. | Expected a `DESTRUCTIVE_CHANGES` refusal; the user-visible code is `CLI.CONSENT_REQUIRED`. `DESTRUCTIVE_CHANGES` is the control-API code that the CLI turns into `CLI.CONSENT_REQUIRED`. Behaviour (column drop named, `--confirm <database>` required) matches; only the code differs, so the script's expectation may be what needs to change. Artefacts: `artefacts/E2/`. |
| E3 | PASS | Read `upgrade-instructions/pending/intent-hints-model-rename/app/instructions.md`. It covers: `db update` without consent for non-data drops (matches E1), table/column drops still asking (matches E2), the `migration plan` baseline consent change, the warning not to re-run old `migration.ts` files that call the seven drop methods, required `ContractDefinition.hints` (`hints: []`), and forwarded planner warnings. Nothing contradicts A to E. | |

## Scenario F — extension author

| Step | Result | Evidence | Notes |
| --- | --- | --- | --- |
| F1 | FAIL | Migration System doc, line 137: `A destination named by --to is a snapshot, so it carries none. An extension's own contract.json may carry hints, but they have no effect: …`. CLI README § `migration plan` (lines 1099, 1109, 1119): `A destination named by --to is a snapshot and carries no hints; hints apply only when the destination is the emitted contract.json.` `grep -i "extension.*hint\|hint.*extension"` over the CLI README → no match. | Expected both documents to say an extension's hints have no effect. The Migration System doc does; the CLI README does not. Both state that `--to` destinations carry no hints, which matches B7 (snapshots have no `hints`). Artefacts: `artefacts/F1/`. |
| F2 | PASS | `wip/qa/supabase-ext`: added `@@hint(was: "x")` after `@@map("audit_log_entries")` in `src/contract/contract.prisma`; `pnpm run build:contract-space` → exit 0. `hints` = `{"namespaces": {"auth": {"tables": {"audit_log_entries": {"was": "x"}}}}}`, placed between `defaultControlPolicy` and `meta`. `contract.json` with `hints` removed equals the original; `contract.d.ts` unchanged; `storageHash` unchanged. Tests on the copy: 16 files / 63 tests passed; the other 2 files failed only to import `../../../2-sql/...` (a path that breaks in a copy); with that path made resolvable they passed (39 tests). | The emit also prints the existing `PN_EXACT_NAME_BODY_COMPARISON` warning for 15 objects, unrelated to hints. |

## Summary

**Counts:** 26 PASS, 4 FAIL, 0 BLOCKED (30 steps).

**FAIL steps:**

- **C2:** a spent TypeScript hint fails with the correct message, but under the code `CONTRACT.SOURCE_LOAD_FAILED`, not `CONTRACT.HINT_INVALID`, and the next action is aimed at config authors.
- **D1:** `contract print` writes `@@hint(was: …)` before `@@map`, not after it. The round trip (same hints, same hash) is correct.
- **E2:** a column drop is refused under `CLI.CONSENT_REQUIRED`, not `DESTRUCTIVE_CHANGES`. The behaviour is right. The script probably names the internal control-API code.
- **F1:** the CLI README does not say that hints in an extension's own `contract.json` have no effect. The Migration System doc does.

**BLOCKED steps:** none. D2 ran against `prisma lsp --stdio` with a scripted client.

**Things a user would notice that the script did not ask about:**

- **Advice points to an unsupported feature.** Three user-facing texts tell the user to use a `deleted` hint, which this slice rejects (`unknown argument "deleted"`):
  - the A7 contradiction next action;
  - the `@@hint(deprecated:)` diagnostic;
  - the `@@hint()` diagnostic, `needs one of was, deleted or deprecated`.
- **`db update` does not say the hint was used.** Unlike `migration plan`, it prints no `Hints applied` block or "you can remove the hint" line, so a `db update` user is never told the hint is spent.
- **A fresh copy of `prisma-8-demo` has no `db` ref**, because `migrations/app/refs/db.json` is not tracked. `migration plan` refuses with `MIGRATION.PLAN_ORIGIN_UNKNOWN` until `db update` creates it. Scenario B's setup only works because of the `db update` step.
- **The CLI prints NDJSON step events whenever stdout is not a TTY,** even without `--json`. Getting human output in a pipe needs `--format human`. `--json` output is NDJSON, not one JSON document.
- **Doubled progress lines.** `db update` prints `Introspecting database schema` / `Planning migration` twice per run in both human and JSON output.
- **No-op runs claim a change.** `db update` with nothing to do reports `Database already matches contract …, signature updated`.
- **Missing exit code in error JSON.** Error envelopes (A7, E2) have no `exitCode`, while success envelopes do.
- **Odd advice in `db migrate`.** When an edge is missing it says a rename `may additionally need a hint in the planned migration`. Hints now live in the schema, not the migration.
- **Cryptic type error.** `hint: { was: 'x', deleted: true }` fails with `Type 'true' is not assignable to type 'undefined'`, which does not say `deleted` is unsupported.
- **Run environment.** Another agent edited and rebuilt tracked sources in this worktree during the run. I ran everything from an isolated checkout at `wip/qa/tree`, which is a registered git worktree. Remove it with `git worktree remove --force wip/qa/tree` when done. No step was slow: the slowest was the supabase test run at about 46 seconds.

## Run 2

- **Commit:** `b6dd7f1fdc` (branch HEAD when the run started; one commit past `d8670c4ab8`: `Keep the migrate advice family-blind: say a rename, not a table rename`).
- **Build:** fresh detached worktree at `wip/qa/tree`, then `pnpm install --frozen-lockfile`, `pnpm build` (exit 0), and `pnpm install --frozen-lockfile --offline`. CLI: `wip/qa/tree/node_modules/.bin/prisma` (`8.0.0-rc.14`). The worktree was removed with `git worktree remove --force` at the end.
- **Apps:** the same copies as run 1 (`wip/qa/prisma-8-demo`, `wip/qa/prisma-8-demo-b`), linked to the new checkout, with a new `@prisma/dev` database.
- **Steps:** only C2, D1, D3, A7 (with the empty `@@hint()`), E2, F1, and the `db migrate` missing-path advice. The script at this commit already carries the corrected E2 and F1 expectations.

| Step | Result | Evidence | Notes |
| --- | --- | --- | --- |
| C2 | PASS | `hint: { was: 'member' }`; `prisma contract emit --config prisma.config.contract-ts.ts --format human` → exit 2: `✘ [CONTRACT.HINT_INVALID] @@hint(was: "member") names the table's current name; the hint is spent, remove it.` JSON: `"code":"CONTRACT.HINT_INVALID"`, `"meta":{"model":"Member","was":"member"}`, `"nextActions":[]`. | The config-author next action is gone. |
| D1 | PASS | `contract print` of the A1 PSL schema: `@@index([label], name: "label_label_idx")` / `@@map("label")` / `@@hint(was: "tag")`. Of the C1 TypeScript contract: `@@map("member")` / `@@hint(was: "user")`. Re-emitting the printed PSL: same `hints`, same `storageHash`. | |
| D3 | PASS | `@@hint(deprecated: true)` → exit 2, `PSL_HINT_INVALID: @@hint(deprecated:) is reserved and not yet supported. Remove the model from the schema and run db update.` | The message now ends after `run db update.`. `@@hint(deleted: true)` still gives `Attribute "hint" received unknown argument "deleted"`. |
| A7 | PASS | `label` applied by `db update`, then `CREATE TABLE "tag" (id int)`, then `db update --format human` → exit 2: `✘ [MIGRATION.PLANNING_FAILED]` / `why: MIGRATION.HINT_CONTRADICTED: the rename hint on table "label" (was "tag") cannot apply: namespace "public" has both "tag" and "label".` / `→ A rename hint applies only while the old name exists and the new one does not. If "tag" was already renamed, remove the hint. If "tag" is a different table that should stay, remove the hint and give the model another table name.` `grep -ci deleted` on the human and JSON output → 0. Database dump before and after identical; hand-made table dropped. `@@hint()` → `PSL_HINT_INVALID: @@hint needs was.` | My first attempt created `tag` while the real `tag` still existed, so `CREATE TABLE` failed and the rename went through. That was a setup error on my part, not a product fault. The reported run is the corrected one. |
| E2 | PASS | `Task.description` removed; `db update --json` (no `--confirm`) → exit 2, `"code": "CLI.CONSENT_REQUIRED"`, summary `"Apply 1 destructive operation(s) to template1? Data they remove cannot be recovered:\n  - Drop column \"description\" from \"task\"\" requires explicit consent, … Grant it by passing --confirm template1."`, `meta: {'consentToken': 'template1'}`. Under a TTY (`script -F`): prompt `Apply 1 destructive operation(s) to template1? … - Drop column "description" from "task" Type template1 to confirm.` Column still present afterwards. | |
| F1 | PASS | CLI README line 1119 (§ `migration plan`, `Hints applied`): `Hints in an extension's own contract.json have no effect: the planner never runs for an extension's contract space, whose migrations are built in advance.` Line 1099: `A destination named by --to is a snapshot and carries no hints; …`. Migration System doc line 137 unchanged and still states both. | Matches B6/B7 from run 1. |
| Extra: `db migrate` missing path | PASS | In `prisma-8-demo-b` (marker `8b3761…`), emitted a schema with `Task.description` removed, then ran `prisma db migrate --format human` → exit 2, `✘ [MIGRATION.PATH_UNREACHABLE] Current contract has no planned migration path`. The new advice line: `→ A rename is stated with @@hint(was: "<old name>") on the model in the schema and planned with migration plan; re-adding a required field without a safe default, or a type change that needs data, may leave a placeholder in the planned migration.ts to fill in`. | The first advice line, `Plan the missing edge: prisma migration plan --from 8b3761… --to 07c08c… --name <slug>`, names the emitted contract by hash. A probe showed `migration plan --to <hash of the emitted contract>` fails with `MIGRATION.REF_NOT_FOUND` (`No contract matching "4410…" exists in the migration graph or refs index.`) when that contract has no snapshot yet. Even if it resolved, the README says a `--to` destination carries no hints. So a user who follows the advice for a hinted rename cannot plan it. Probably older than this slice; reported because it sits next to the new rename advice. |

### Run 2 summary

**Counts:** 7 PASS, 0 FAIL, 0 BLOCKED.

- All four run 1 failures (C2, D1, E2, F1) now pass. The `deleted` hint advice is gone from all three places (A7, D3, `@@hint()`).
- **Noticed but not asked:** `db migrate`'s `Plan the missing edge` advice names the emitted contract with `--to <hash>`. That command fails with `MIGRATION.REF_NOT_FOUND` while the contract has no snapshot. It would also drop the hints, so it conflicts with the new rename advice right below it. Planning without `--to` (the default destination) is the path that works.
- **Still open from run 1, not re-checked:**
  - `db update` prints no `Hints applied` line.
  - Fresh demo copies have no `db` ref.
  - Progress lines are doubled.
  - A no-op `db update` reports "signature updated".
  - Error envelopes have no `exitCode`.
  - The `deleted: true` type error is cryptic.
