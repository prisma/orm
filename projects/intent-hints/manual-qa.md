# Manual QA — slice 1, model rename hints

**What this script is testing.** The end-user surface of a model rename stated with `@@hint(was:)`: the attribute in PSL and the TypeScript DSL, what `contract emit`, `migration plan`, `db update`, `db init` and `contract print` do with it, the `Hints applied` block, the spent-hint behaviour, the contradiction refusal, and the consent change for non-data drops. Both audiences: end users through `examples/`, extension authors through `packages/3-extensions/` (hints in an extension's own contract have no effect, and the upgrade fragment tells them what changed).

**Pre-QA gate.** On the branch: `pnpm build`, `pnpm typecheck`, `pnpm fixtures:check` green (the gate runs recorded in the slice's review folder satisfy this). Do the run on a copy of the example app under `wip/qa/`, never in `examples/` itself, so no tracked file changes. Use the branch's built CLI (`pnpm --filter <app> exec prisma ...` or the app's own scripts), not a published one.

**Runner records.** `projects/intent-hints/manual-qa-reports/<YYYY-MM-DD>-<runner>.md`: one row per step with PASS / FAIL / BLOCKED and the exact output that decided it; artefacts (schema files, JSON output) under `manual-qa-reports/artefacts/<step>/` when a step fails.

## Scenario A — end user, PSL, `db update` project (no migration history)

Start from a copy of `examples/prisma-8-demo` (or the simplest Postgres example with a PSL schema and a dev database the app's README describes; PGlite is acceptable). Bring the database to the current schema with `db update` first.

| Step | Do | Expect |
| --- | --- | --- |
| A1 | Pick a model with rows (seed a few if the demo has none), a unique field, a foreign key from another model, and an index. Rename the model in the schema and add `@@hint(was: "<old table name>")`. Run `contract emit`. | Emit succeeds. `contract.json` has a top-level `hints` section with `namespaces.<ns>.tables.<NewName>.was = "<old>"`, placed between `defaultControlPolicy` (if present) and `meta`. `storage.storageHash` is the same as after emitting the identical schema with the hint line removed (emit once without, note the hash, then with). |
| A2 | `db update --json` with no `--confirm`. | Exit 0. No consent prompt and no `DESTRUCTIVE_CHANGES`. The first operation is the table rename; every operation is `widening` on Postgres. |
| A3 | Query the database. | Rows are present under the new table name. The primary key, unique and foreign key constraints are named after the new table (`<New>_pkey`, `<New>_<col>_key`, `<New>_<col>_fkey`) unless the schema named them explicitly. The referencing model's foreign key points at the new table. |
| A4 | `db update --json` again, hint still in the schema. | Exit 0, `plan.operations` empty. |
| A5 | `db verify --schema-only`. | Exit 0, clean. |
| A6 | Delete the `@@hint` line, emit, `db update --json`. | Still empty plan. The hint was optional once spent. |
| A7 | Put the hint back, and also restore the old table by hand (`CREATE TABLE "<old>" (id int)`), emit, `db update --json`. | Exit non-zero, `MIGRATION.PLANNING_FAILED`, `why` contains `MIGRATION.HINT_CONTRADICTED` and both table names. Nothing changed in the database. Drop the hand-made table afterwards. |
| A8 | On a fresh empty database, with the hinted schema, run `db init`. | The new table is created; the hint produces no error and no rename; no mention of the hint in the output. |

## Scenario B — end user, PSL, migration history project

Start from a copy of an example that keeps `migrations/` (the demo does). Make sure the `db` ref matches the dev database (`db update` on the base schema, which advances it).

| Step | Do | Expect |
| --- | --- | --- |
| B1 | Same rename and hint as A1; `contract emit`; `migration plan --name rename-<model>` in human mode. | A migration directory is written. Output shows the operations, then a block titled `Hints applied` with one line: `rename hint on table "<New>" (was "<old>"): renamed and recorded in this migration; you can remove the hint.` |
| B2 | Open the written `migration.ts`. | `operations` is exactly `...this.renameTable({ schema: '<schema>', table: '<old>', to: '<New>' })` (schema omitted when the model is in the unbound namespace). `ops.json` lists the rename and the companion constraint and index renames. |
| B3 | `migration plan --json` with the same inputs into a new name. | `consumedHints` has one entry `{ hint: { kind: 'renamed', coordinate: {...}, from: '<old>' }, text: '<same line as B1>' }`. Delete that second directory. |
| B4 | Re-run the first `migration.ts` with node (the file prints how) and diff `ops.json` and `migration.json` against the planned versions. | Byte-identical. |
| B5 | `migrate`. Then the A3 database checks. | Rows and renamed objects present. |
| B6 | `migration plan --from <that migration dir>` with the hint still in the schema. | `No changes detected`; no `Hints applied` block. |
| B7 | `migration show <dir>` and `migration check`. | Both fine; the migration carries no `hints` anywhere, and `migrations/snapshots/<to-hash>/contract.json` has no `hints` key while the emitted `contract.json` does. |

## Scenario C — end user, TypeScript DSL

Use an example with a TS contract (the demo has `contract-base.ts`-style fixtures; otherwise the smallest TS example).

| Step | Do | Expect |
| --- | --- | --- |
| C1 | Rename a model and add `.sql({ table: '<New>', hint: { was: '<old>' } })`. Emit. | Same `hints` section as PSL would produce for the same schema. |
| C2 | Set `hint: { was: '<the model's own table name>' }`. Emit. | Emit fails with `CONTRACT.HINT_INVALID` and the message `@@hint(was: "<name>") names the table's current name; the hint is spent, remove it.` (the PSL text). |
| C3 | Try `hint: { deprecated: true }` and `hint: { was: 'x', deleted: true }` in the editor or `tsc`. | Both are type errors. |

## Scenario D — `contract print` and the language server

| Step | Do | Expect |
| --- | --- | --- |
| D1 | `contract print` on the hinted contract from A1 or C1. | The printed schema shows `@@hint(was: "<old>")` after `@@map` on the model; re-emitting the printed schema yields the same `hints` section. |
| D2 | In an editor with the language server (or the LS test harness if no editor is available), type `@@` inside a model and open completion; then `@@hint(` for signature help. | `hint` is offered with the documentation `Tells the migration planner the intent behind a change to this model's table that a diff cannot infer.`; signature help lists `was` and `deprecated` with their documentation. Mark BLOCKED if no editor or harness is reachable, and say why. |
| D3 | Write `@@hint(deprecated: true)` and emit. | Diagnostic `PSL_HINT_INVALID`: `@@hint(deprecated:) is reserved and not yet supported. ...` |
| D4 | Write `@@hint(deleted: true)` and emit. | The kit's own message: `Attribute "hint" received unknown argument "deleted"`. |

## Scenario E — consent change for non-data drops

| Step | Do | Expect |
| --- | --- | --- |
| E1 | In a `db update` project, remove an `@@index` from a model (no hint involved). Emit, `db update --json` with no `--confirm`. | Exit 0, no consent prompt; the index drop is `widening`. |
| E2 | Remove a scalar field instead. Emit, `db update --json` without `--confirm`. | Refused with `CLI.CONSENT_REQUIRED` naming the column drop and the `--confirm <database>` token; the human form asks for the database name. |
| E3 | Read `upgrade-instructions/pending/intent-hints-model-rename/app/instructions.md`. | It describes E1, the `migration plan` baseline consent, the re-emit warning, the required `ContractDefinition.hints`, and the forwarded planner warnings, and nothing it says contradicts what A to E showed. |

## Scenario F — extension author

| Step | Do | Expect |
| --- | --- | --- |
| F1 | Read `docs/architecture docs/subsystems/7. Migration System.md` § planner hints and `packages/1-framework/3-tooling/cli/README.md` § `migration plan`. | The subsystem doc says a hint in an extension's own `contract.json` has no effect; both say `--to` destinations carry no hints; the CLI README's `migration plan` section carries the one-sentence extension note too; the text matches what B6/B7 showed. |
| F2 | In a copy of `packages/3-extensions/pgvector` (or any extension with a PSL or TS contract), add `@@hint(was: "x")` to one of its models and run its `build:contract-space`. | The emitted contract carries the section; nothing else changes; no error. (Record whether the extension's tests still pass on the copy.) |

## Out of scope for this script

Field hints, `deleted`, the `migration plan` refusal for destructive operations (slices 2 to 4), Mongo.
