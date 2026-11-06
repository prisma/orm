# Handover: Database change policies

Written 2026-10-30 by the agent oedipus-17, ahead of a rate limit. Delete this file at project close-out.

## Read these first

1. **This session's transcript** (2026-10-27 to 2026-10-30: slice 1's finish, the review of the project spec, slice 3's spec, implementation and two review rounds):
   `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-databases-declare-changes-bee530/84504d2f-5615-458d-9d22-3ab8a0eee97e.jsonl`
   Will's own messages are the rulings: `jq -r 'select(.type=="user" and (.message.content|type)=="string") | .message.content' <file>`.
2. **The design session** where Will settled the design (2026-10-15 to 2026-10-23):
   `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-agents-db-reset-design-2a94d6/a02116db-9e86-47d5-848d-e0501dfe2e70.jsonl`
3. **Slice 3's implementer** (one persistent Opus subagent across all rounds): `…/84504d2f-5615-458d-9d22-3ab8a0eee97e/subagents/agent-aa32e74940d97d19e.jsonl` (same directory as transcript 1). Its reviewers: architect `agent-a67ce337c11a5aff6.jsonl`, code review `agent-a3ac8901f4536fed1.jsonl`.
4. In this folder: [`spec.md`](spec.md) (the project design, with a table of the decisions the agent made rather than Will), [`design.md`](design.md) (reasoning, scenarios, rejected alternatives), [`plan.md`](plan.md) (five slices), [`slices/3-policies/spec.md`](slices/3-policies/spec.md) (slice 3's contract, ending with "Decisions after the first review"), [`slices/3-policies/plan.md`](slices/3-policies/plan.md), and the two review files under `slices/3-policies/reviews/` (force-added so they survive; the folder is normally gitignored).
5. The decision record: [ADR 314 — Databases record a change policy and a data protection policy](../../docs/architecture%20docs/adrs/ADR%20314%20-%20Databases%20record%20a%20change%20policy%20and%20a%20data%20protection%20policy.md), and [ADR 307 — No recovery resets or drops a database](../../docs/architecture%20docs/adrs/ADR%20307%20-%20No%20recovery%20resets%20or%20drops%20a%20database.md).

## What the project is

On 2026-10-15 an agent deploying `prisma/asks` to a shared development database with Prisma Composer hit a "no migration path" error: a branch's migration had been applied there and then planned again, so the database's marker named a contract no migration on disk starts from. The agent decided `db update` was only for local databases and proposed resetting the database. Will's rule: **never reset a database; it can always be moved with migrations or `db update`.**

The project makes each database record how it may change, and makes every command obey it:

- **Change policy:** which strategies may move the database: `migrate` (walk the migration graph: `db migrate`, a Composer deploy) and/or `reconcile` (`db update`, `db sign`). Production records `["migrate"]`.
- **Data protection policy:** `dataLoss` and `accessWidening`, each `…-forbidden`, `…-with-consent` (default, today's behaviour) or `…-permitted`.
- **A ref declares** the policies its database should have (`migrations/<space>/refs/<name>.json` gains `policies`). **The application space's marker records** the policies in force under `meta.policies`; they govern every contract space. A marker with none takes the defaults, so existing databases behave as before.
- `db migrate --to <ref>` / `db update --to <ref>` refuse a difference with `MIGRATION.POLICY_MISMATCH`; with `--permit-policy-change` they run under the ref's policies and write them into the marker when the run succeeds (inside the transaction on Postgres, SQLite, MySQL; after the last migration on MongoDB). No error ever suggests the flag (re-run advice repeats it only if the user gave it). Nothing is written to the ledger for a policy change.
- `db update` and `db sign` need `reconcile`; `db migrate` needs `migrate`; refusal is `MIGRATION.CHANGE_POLICY_FORBIDS`. The off-graph error `MIGRATION.MARKER_MISMATCH` gives the one recovery the policy permits.

## Slices and where each stands

Linear project P-TML-1165, "Database change policies: may db update run, and may a change lose data". Every ticket is written to stand alone.

| Slice | Ticket | Repo | State |
|---|---|---|---|
| 1. Off-graph error explains itself; nothing recommends a reset | TML-3725 | orm | **Merged** (orm#30866, 2026-10-27). ADR 307. |
| 2. Composer shows the control API's migrate errors | TML-3726 | composer | Not started; needs an ORM `8.0.0-rc` release containing slice 1. Composer passes `invocation: { dbGiven: true }`. |
| 3. Refs declare policies, marker records them, change policy enforced | TML-3727 | orm | **In progress on branch `tml-3727-policies`** (see below). No PR yet. |
| 4. Data protection enforced | TML-3728 | orm | Not started. Needs per-target classification of access-widening operations. |
| 5. Composer applies and compares policies | TML-3729 | composer | Not started; needs a release containing slice 3. |

Follow-ups filed: TML-3743 (one-step rejoin; `migration plan --to` accepts snapshot-store hashes), TML-3744 (`db update` names skipped transforms), TML-3756 (SQLite coverage waiver, done), TML-3779 (MongoDB runner reports a failed schema command as `CLI.UNEXPECTED` instead of `MIGRATION.EXECUTION_FAILED`).

## Slice 3: where the work is

- **Branch:** `tml-3727-policies`, rebased onto `origin/main` on 2026-10-30, pushed to the `bot` remote (`git@github-wmadden-electric:prisma/orm.git`). Pre-rebase backup branch: `backup/tml-3727-policies-prerebase` (local only).
- **Done and reviewed twice:** the framework types and parser (`packages/1-framework/1-core/framework-components/src/control/database-policies.ts`), refs keep their fields (`advanceRef` in `migration-tools/refs`), marker writes on all four targets, runners decide marker and ledger writes separately, the control API checks (order: off-graph detection, policy comparison, change policy), the CLI flag, both error codes and the error reference, `migration status --to <ref>` differences, `db migrate --show` preview, upgrade fragments, integration tests on all four targets, ADR 314, glossary, ADR 021/218/307 notes, the Migration System doc, the `prisma-8` skill.
- **Round-2 review fixes:** items 1 to 7 below are done and committed (`87e153c606`, `cad653d277`), item 8 is half done in the `WIP:` commit `e0064d0747`, whose body has the details. Not yet run after these commits: `pnpm typecheck:agent`, `pnpm lint:deps:agent`, `pnpm check:error-reference`, per-package lint, the full package suites, and the MongoDB and MySQL policy integration files. Known gap in item 2: the hash-moved `MIGRATION.MARKER_CAS_FAILURE` from the runners carries no `reason` field yet, while the policies-moved one and `db sign`'s carry `reason: 'storageHash' | 'databasePolicies'`; make them consistent.
- **Decided at the stop:** the failed-run journey asserts an unchanged ledger. MySQL and MongoDB write the marker and the ledger only at the end of a space, so a run that fails mid-space adds no ledger row there; that is how the runners work and is correct. The MongoDB-specific test already checks the first migration's change stayed applied.

## Next steps

1. Fresh worktree from `bot/tml-3727-policies`; `pnpm install`, `pnpm build`. Read the last commit's message: if it starts with `WIP:` it lists what is left of the round-2 fixes.
2. Finish the round-2 fixes. The list (from the orchestrator's message to the implementer; the review files have the evidence):
   1. Compare `expectedDatabasePolicies` once per run, before the first space is applied (per-run input beside `perSpaceOptions` and beside `spaces` in `signSpaces`); test that an extension's DDL does not run when the policies changed.
   2. A concurrent change of policies only is reported as such (no "from X to X"); update the `MIGRATION.MARKER_CAS_FAILURE` reference entry.
   3. `CONTRACT.MARKER_ROW_CORRUPT` from an unreadable `meta.policies` advises asking the database's owner to correct it, never deleting the row or `db sign`.
   4. `markerHoldsDatabasePolicies` reports an unreadable stored value as corruption, not as "changed".
   5. `migrate` takes one discriminated target field (ref or hash) instead of `ref` plus `targetHash`.
   6. Rename MongoDB's `RecordedPolicies` / `unchangedPolicies` by role (the raw stored value the compare-and-swap matches).
   7. Trim framework exports: `DatabasePoliciesSchema` (test only), `DatabasePolicySetting` (unused), `InsertedMarker` (rename or move to the SQL family); `RunMigrationInputs` picks its policy fields from the framework type.
   8. Tests: the failed-run journey asserts the run failed inside a migration (done in the WIP commit; re-run the file); still to write: a ref without `policies` against a database with none succeeds and leaves the marker's `meta` without `policies`.
   Then add `reason: 'storageHash'` to the runners' hash-moved `MARKER_CAS_FAILURE`, run every check listed above, and reword the WIP commit (or follow it with a normal commit).
3. Re-review the fixes (resume or re-run the two reviewers; `/drive-code-review` without the walkthrough, Opus subagents).
4. Pre-push checks matching CI: per-package `lint`, `pnpm typecheck`, touched packages' tests, `pnpm lint:deps`, `pnpm check:error-reference`, `pnpm check:upgrade-coverage --mode pr` against the PR base, per-package coverage thresholds (some are 100%), the rules footprint if rules changed. Run the touched integration files one at a time (never the full suite): `cd test/integration && pnpm test test/<file>`. MySQL tests need `MYSQL_URL`; the implementer ran a private `mysqld` from `wip/mysql/data` in the old worktree (`mysqld --datadir=… --port=33061 --bind-address=127.0.0.1 --mysqlx=OFF`), stopped by PID.
5. Open the PR (title and body per `/drive-pr-description`: grounding example first, decision, narrative, alternatives last; `Agent: <name>` above the attribution line). Turn on Auto-fix at once; once Will approves, auto-merge (squash); start a background wait for merge, close or failed check; follow it to merge; set TML-3727 Done with a closing comment.
6. Then slice 4 (TML-3728), then Composer slices 2 and 5 after ORM releases (clone `git@github-wmadden-electric:prisma/composer.git` into `wip/`; deploy step is `packages/1-prisma-cloud/1-extensions/target/src/orm-migrate.ts`).
7. Close-out: verify the project DoD in `spec.md`, move anything long-lived to `docs/`, delete `projects/database-change-policies/`.

## Rulings from Will to keep

- Never propose or document resetting or dropping a database. Prisma 8 has no reset.
- `db update` is for any database whose migration history need not be kept (local, development, staging, preview, shared or not). Never call it "dev-only", "solo" or "local".
- Policies live in the marker as well as on the ref: the database must be readable on its own. The Rails model (marker names its ref) was rejected.
- `migrate` and `db update` never change a policy without explicit consent (`--permit-policy-change`). No error suggests that flag.
- CI/CD can only deploy what is committed; don't design steps a pipeline would run separately.
- The ledger records applied migrations only. Will rejected writing policy changes to it (2026-10-28): "Why the fuck are we trying to write stuff into the ledger that is not migrations?" The earlier spec sentence that did was the agent's invention.
- Don't invent problems the agreed rules already solve; don't present your own choices as Will's rulings. The project spec's "Decisions the orchestrating agent made" table lists the agent's own calls with reasons; keep that distinction.
- Error text is short: one line per field, no hand-wrapping in doc examples.
- Linear tickets must stand alone: explain every command, file and error from scratch, no "slice N" shorthand, no unverified claims. Will rejected two tickets on 2026-10-28 and 2026-10-30 for this.
- Write to Will briefly, in plain English, lead with the decision, ask questions as concrete scenarios.
- Read the design docs (ADRs in full, glossary, migration domain docs) before any design opinion, and say what you read.

## Open calls the agent made that Will may overturn

- Public codes stay `MIGRATION.POLICY_MISMATCH` and `MIGRATION.CHANGE_POLICY_FORBIDS` (the architect suggested `DATABASE_POLICY_MISMATCH`); internal names say "database policies".
- Re-run advice repeats `--permit-policy-change` when the user gave it.
- An in-sync `db update` without the flag still writes the zero-operation ledger row it wrote before this slice.
