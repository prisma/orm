# Handover: Database change policies

Written 2026-11-11 by the agent eratosthenes-31, ahead of a rate limit. It replaces the 2026-10-30 handover by oedipus-17. Delete this file at project close-out.

## Where things stand, in one paragraph

Slice 1 is merged. Slice 3 is finished and waits only for Will's review: [prisma/orm#30926](https://github.com/prisma/orm/pull/30926), branch `tml-3727-policies`, head `51aebff741`. At that head, CI passes, the PR has no merge conflicts, every review thread is resolved and Auto-fix is on. Slices 4 (orm), 2 and 5 (composer) have not started. Will wants to talk the whole project through with Serhii next; the documents to give Serhii are listed under "Read these first".

## Read these first

1. **This session's transcript** (eratosthenes-31, 2026-10-30 to 2026-11-11: checking the old handover, the framework exemption, finishing slice 3, seven review rounds, manual QA, the PR, the ADR rewrite, CodeRabbit fixes, three merges of main):
   `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-database-change-policies-59f270/92b3ef91-3ae3-42f6-b183-fdb935e8a31c.jsonl`
   Its subagents are in the folder of the same name, under `subagents/`. Will's own messages are the rulings: `jq -r 'select(.type=="user" and (.message.content|type)=="string") | .message.content' <file>`. This file is outside your worktree. If your worktree rules stop you reading it, ask Will to copy it in. Do not skip it.
2. **Earlier transcripts**, under the macOS user `will` (ask Will to copy them if you cannot read them):
   - slice 1 and the start of slice 3 (oedipus-17): `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-databases-declare-changes-bee530/84504d2f-5615-458d-9d22-3ab8a0eee97e.jsonl`
   - the design session where Will settled the design (2026-10-15 to 2026-10-23): `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-agents-db-reset-design-2a94d6/a02116db-9e86-47d5-848d-e0501dfe2e70.jsonl`
3. **Design documents.** Read the copies on branch `tml-3727-policies`, because main has older ones. These are also the documents to give Serhii, in this order:
   1. [`design.md`](design.md): the incident, why there are two policies, scenarios, prior art, rejected alternatives.
   2. [ADR 320 — Databases record a change policy and a data protection policy](../../docs/architecture%20docs/adrs/ADR%20320%20-%20Databases%20record%20a%20change%20policy%20and%20a%20data%20protection%20policy.md). It was numbered 314, then 319, and is now 320: main took 314 for another ADR on 2026-11-11, and approved PR #30483 takes 319.
   3. [`spec.md`](spec.md): the project requirements, with a table of decisions the agents made rather than Will.
   4. [`plan.md`](plan.md): the five slices.
   5. [`slices/3-policies/spec.md`](slices/3-policies/spec.md) and the review files in `slices/3-policies/reviews/` (force-added; the folder is normally gitignored).
   6. [ADR 307 — No recovery resets or drops a database](../../docs/architecture%20docs/adrs/ADR%20307%20-%20No%20recovery%20resets%20or%20drops%20a%20database.md), and section "Database policies" of the [Migration System doc](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md).

## What the project is

On 2026-10-15 an agent deploying `prisma/asks` to a shared development database with Prisma Composer got "no migration path": a branch's migration had been applied there and then planned again, so the database's marker named a contract no migration on disk starts from. The agent decided `db update` was only for local databases and proposed resetting the database. Will's rule: **never reset a database; it can always be moved with migrations or `db update`.**

The project makes each database record how it may change, and makes every command obey it:

- **Change policy:** which strategies may move the database. `migrate` walks the migration graph (`db migrate`, a Composer deploy). `reconcile` plans and applies the difference to a contract (`db update`, `db sign`). Production records `["migrate"]`.
- **Data protection policy:** `dataLoss` and `accessWidening`, each `…-forbidden`, `…-with-consent` (the default, which is the old behaviour) or `…-permitted`.
- **A ref declares** the policies its database should have: `migrations/<space>/refs/<name>.json` gains an optional `policies`. **The application space's marker records** the policies in force, under `meta.policies`. They govern every contract space. A marker with none takes the defaults, so existing databases behave as before.
- `db migrate --to <ref>` and `db update --to <ref>` refuse a difference with `MIGRATION.POLICY_MISMATCH`. With `--permit-policy-change` (control API: `permitPolicyChange`) they check the run against the ref's policies and write them into the marker when the run succeeds: inside the run's transaction on Postgres, SQLite and MySQL; in the application marker's guarded write on MongoDB. A run whose only difference is the policies writes them and nothing else. No error ever suggests the flag; re-run advice repeats it only when the user gave it. The ledger gets nothing for a policy change.
- `db update` and `db sign` need `reconcile`; `db migrate` needs `migrate`. The refusal is `MIGRATION.CHANGE_POLICY_FORBIDS`. A database with no marker has no policy, so `db init` and adopting a database with `db sign` are never refused.
- The off-graph error `MIGRATION.MARKER_MISMATCH` and the `migration status` warning give the one recovery the change policy permits.
- Concurrency: the runner compares the policies the command checked with the marker before the first space, under its lock (SQLite: inside its exclusive transaction). MongoDB has no lock, so its application marker write matches each policy setting with `$expr`/`$setEquals`. A concurrent change fails with `MIGRATION.MARKER_CAS_FAILURE`, whose `reason` is `storageHash`, `databasePolicies` or `markerChanged`.
- Unreadable `meta.policies` is `CONTRACT.MARKER_ROW_CORRUPT` (advice: ask the database's owner to correct it; never delete the marker). An invalid `policies` in a ref file is `MIGRATION.INVALID_REF_FILE`.
- **Data protection is stored, compared and changed, but not enforced yet.** That is slice 4. The docs and the skill say so.

## Slices

Linear project P-TML-1165. Every ticket is written to stand alone.

| Slice | Ticket | Repo | State |
|---|---|---|---|
| 1. The off-graph error explains itself; nothing recommends a reset | TML-3725 | orm | Merged (orm#30866, 2026-10-27). |
| 2. Composer shows the control API's migrate errors | TML-3726 | composer | Not started. Needs an ORM `8.0.0-rc` that contains slice 1 (already released). Composer passes `invocation: { dbGiven: true }`. |
| 3. Refs declare policies, the marker records them, the change policy is enforced | TML-3727 | orm | PR #30926, awaiting Will's review. |
| 4. Data protection enforced | TML-3728 | orm | Not started. Needs each target to say which operations widen access, judged from their structure. |
| 5. Composer applies and compares policies | TML-3729 | composer | Not started. Needs an ORM release containing slice 3. |

Follow-ups filed: TML-3743 (a one-step command to bring an off-graph database back onto the graph; `migration plan --to` accepting snapshot-store hashes), TML-3744 (`db update` names the data transforms it skips), TML-3779 (the MongoDB runner reports a failed schema command as `CLI.UNEXPECTED`).

## Slice 3 (PR #30926): what to do with it

- **Branch:** `tml-3727-policies` on the `bot` remote (`git@github-wmadden-electric:prisma/prisma.git`, which GitHub redirects to prisma/orm). Everything is committed and pushed. Never rebase or force-push; merge `main` in (`git fetch origin main && git merge FETCH_HEAD`).
- **Auto-fix is on.** The desktop app sends CI failures, conflicts and review comments as events. Fix them, run the checks for the touched packages, commit and push.
- **When Will approves:** turn on auto-merge (squash) at once. The merge queue runs the integration tests; if the entry drops, find the failure in the queue run, fix it, and turn auto-merge back on. After the merge, TML-3727 closes by itself.
- **Not checked locally:** MySQL and MariaDB live tests (no server on this machine). CI ran them and they passed at `51aebff741`, including the merged marker write that keeps `meta` and sets `meta.policies` with `JSON_SET(meta, '$.policies', JSON_EXTRACT(?, '$'))`, which binds its values twice because MariaDB rejects a row alias.
- **Side effect reported to Will, not changed:** a policy-only run with `--permit-policy-change` on a database with no marker creates the marker at the empty contract.
- **Known flaky test on main, not ours:** `packages/3-targets/postgres/2-adapter/test/migrations/json-wildcard.integration.test.ts` times out at 500 ms under load. Rerun the job; do not change it.
- **CodeRabbit "Docstring Coverage"** asks for docstrings everywhere. The repo forbids that; ignore it.

## Next steps

1. Fresh worktree from `bot/tml-3727-policies` (or from `origin/main` once #30926 merges). Run `pnpm install` and `pnpm build` through `mise exec --`.
2. Keep #30926 green until Will approves, then land it as above.
3. Will's discussion with Serhii may change the design. If it does, update ADR 320, the spec and the plan before building more.
4. **Slice 4 (TML-3728)**, after #30926 merges, through the Drive process (`/drive-process`): slice spec, plan, Opus implementer, `/drive-code-review` without the walkthrough, fixes, manual QA, then the PR. Content: `db update` applies the three levels of each data protection setting to its questions; `db migrate` refuses, with `MIGRATION.DATA_PROTECTION_FORBIDS`, a run containing a destructive operation under `data-loss-forbidden` or an access-widening one under `access-widening-forbidden`; each target supplies the function that finds access-widening operations in a recorded `ops.json`; `migration plan --to <ref>` checks the plan against the ref's declared data protection. Then remove the "not yet enforced" notes from the docs and the skill.
5. **Composer slices 2 and 5**, after the ORM releases that contain slices 1 and 3. Clone `git@github-wmadden-electric:prisma/composer.git` into `wip/`. The deploy step is `packages/1-prisma-cloud/1-extensions/target/src/orm-migrate.ts`.
6. **Close-out** per `close-project.md`: verify the project's definition of done in `spec.md`, move anything long-lived to `docs/`, file the follow-ups in `design.md` that have no ticket yet, then delete `projects/database-change-policies/`.

## Checks before every push

Per-package `pnpm lint`, `pnpm typecheck` and `pnpm test --coverage` in each touched package (some coverage thresholds are 100%); `pnpm build` (full, never one package); `pnpm lint:deps`; `pnpm check:error-reference` when error codes change; `pnpm lint:ratchets` and `pnpm check:upgrade-coverage --mode pr` (CI-only checks). Run integration files one at a time (`cd test/integration && pnpm test test/<file>`), never a whole suite. The policies journeys are in `test/integration/test/utils/database-policies-journey.ts` and the per-target files that use it. Run node, pnpm and git commits through `mise exec --`. Commit as the bot with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`.

## Rulings from Will to keep

- **Framework exemption (2026-10-30):** database policies are a new framework concept and are exempt from the "never change the framework domain" rule: the module `packages/1-framework/1-core/framework-components/src/control/database-policies.ts`, the runner options, the marker conflict kind and `RefEntry.policies`. Do not raise the rule again for this concept. Still keep code that builds error text out of the framework.
- **Execution mode:** design with Will at the start, then execute through Drive without interrupting him; his input is only the design and final verification. Make engineering decisions yourself and explain any that truly need him once, with a recommendation.
- Never propose or document resetting or dropping a database.
- `db update` is for any database whose migration history need not be kept (local, development, staging, preview, shared or not). Never call it "dev-only", "solo" or "local".
- Policies live in the marker as well as on the ref, so the database can be read on its own. The Rails model (the marker names its ref) was rejected.
- `db migrate` and `db update` never change a policy without explicit consent (`--permit-policy-change`). No error suggests that flag.
- A CI/CD pipeline can only deploy what is committed; do not design steps a pipeline would have to run separately.
- The ledger records applied migrations only; never write policy changes to it.
- Do not present your own choices as Will's rulings. The project spec's table of agent decisions keeps that distinction.
- ADRs (2026-11-02): a grounding example first (code or CLI output), then the decision, a narrative, alternatives last; no Linear tickets, milestones or temporary states.
- Linear tickets must stand alone: explain every command, file and error, no slice shorthand.
- Write to Will briefly, in plain English, leading with the decision. Never use the question UI.

## Calls the agents made that Will may overturn

- Public codes are `MIGRATION.POLICY_MISMATCH` and `MIGRATION.CHANGE_POLICY_FORBIDS`; internal names say "database policies".
- Re-run advice repeats `--permit-policy-change` when the user gave it.
- An in-sync `db update` without the flag still writes the zero-operation ledger row it wrote before.
- The framework's control entry point exports a parser, `parseDeclaredDatabasePolicies`, not an arktype schema (exporting the schema crashed a language-server test that mocks the module).
