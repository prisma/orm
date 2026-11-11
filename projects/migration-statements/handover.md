# Handover: migration statements project (TML-3474), 2026-11-11

From radagast-20 to the next agent. Read this file first, then the project files it points to. Work in a fresh worktree from `origin/main`.

**Transcript of the session that wrote this:** `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-pollyanna-30-context-6ee51c/c36a46aa-1a80-4437-9820-017dc570fc74.jsonl`. It is long; search it for a topic rather than reading it from the top. Will's own messages are the `"type":"user"` lines that are not tool results.

## The project in one paragraph

Drive project "Destructive changes need stated intent" ([TML-3474](https://linear.app/prisma-company/issue/TML-3474)). The migration planner cannot tell intent from a diff: a renamed model looks like a drop plus a create. So `prisma migration plan` and `prisma db update` refuse any change that loses data until the user states what they mean, on the command line or at the interactive prompt, as a statement in contract vocabulary: `--rename old:new`, `--delete X`, `--allow X`, `--convert X`, `--backfill X`. Statements resolve against the origin and destination contracts; families turn them into operations. The project spec, plan, deferred list and design notes are in `projects/migration-statements/` on `main`. Read `spec.md` (purpose, decisions, cross-cutting requirements, project DoD) and `plan.md` (slices) first.

## Where it stands

| Slice | What | State |
| --- | --- | --- |
| 1 | `--rename` for models and fields, SQL | Merged (prisma/orm#30638) |
| 2 | Refusal, `--delete`, `--allow`, interactive prompt | Merged (prisma/orm#30648) |
| 3a | `--convert`, `--backfill` on Postgres and SQLite | Merged (prisma/orm#30695) |
| 4a | Renames and deletes on MongoDB | Merged (prisma/orm#30691) |
| 4p | TypeScript MongoDB contracts get the PSL validator | Merged (prisma/orm#30733, #30773, #30779) |
| 3b | Namespaces, enum values, value objects, variants on SQL | Merged in four PRs (#30823, #30849, #30869, #30929) |
| 4b PR 1 | MongoDB top-level fields: document check on validator changes, type changes with casts, `--convert`, `--backfill`, temporary values | **[prisma/orm#30970](https://github.com/prisma/orm/pull/30970): approved by Will, in the merge queue** |
| 4b PR 2 | MongoDB value object fields, embedded model fields, enum values, variants | Not started; spec approved |
| Alongside | Write-up on a syntax for naming storage objects (`@@map`-only changes) | Not started; goes to Will for a decision; does not block close-out |
| Close-out | Per `close-project.md` | Not started |

## Immediate next step: get PR #30970 merged

- Branch `tml-3538-mongo-value-object-statements`, pushed through the `bot` remote, head `f154cb340c`. Will approved it and asked for it to be merged when ready. Auto-merge was re-enabled and it re-entered the merge queue (position 3, awaiting checks) on 2026-11-11.
- It left the queue once with `checks_timed_out`: in the queue run, **integration shard 3/4 hung for over an hour with no result** while every other job passed. Every PR check passes. The cause is unknown: it could be a hang in one of this PR's integration tests or an unrelated stuck runner. Cancelling the stuck run (to read its log) was refused by the permission classifier.
- If it is dropped again for the same reason, find the test: run the shard locally exactly as CI does, after `pnpm build`: `cd test/integration && mise exec -- pnpm test --shard=3/4 --reporter=verbose > <log> 2>&1` in the background. (macOS has no `timeout` command; don't wrap it in one.) Will has said running the tests you need locally is fine; the rule against full suites is about not overloading his machine. The PR's own new integration files are under `test/integration/test/mongo/target-runner/` (`runner-*.test.ts`) and the journeys `convert-backfill.mongo`, `type-changes.mongo`, `data-transform-scaffolds.mongo`.
- A queue removal turns auto-merge off. After a fix, re-enable auto-merge and confirm `mergeQueueEntry` is non-null. Pushing while queued removes it from the queue.
- Auto-fix (CI monitor) is on for this PR in the desktop app.

## The design of 4b, as Will ruled it

Read `projects/migration-statements/slices/mongo-convert-backfill/spec.md` (on the PR branch; on `main` once #30970 merges) and ADR 188 as changed in that PR. The rulings that shaped it, all 2026-11-06 to 2026-11-11:

- **A migration is only self-contained operations**, each a precheck, an execute and a postcheck about itself. No check-only operation, no check the runner adds that is not in `ops.json`, no migration-level precondition. A migration that stops partway leaves earlier operations applied, like any MongoDB migration; postchecks let a re-run skip them and the re-run finishes it. Do not add special handling or reporting for partial applies. (An early `checkDocuments(...)` operation was built, then removed on this ruling.)
- **`checkDocuments` is only an option** on `setValidation` and `collMod`: the validator change checks that the documents fit its own validator as its precheck, and fails with the count, one `_id`, the reasons and advice. Left out, `ops.json` is unchanged; the planner always writes `true`.
- **`--delete` on a type change runs the database's cast** (the same rule as SQL slice 3a). On MongoDB that is `$convert`, only for pairs on an explicit list in `bson-convert.ts` whose result keeps what values mean (`string` to `bool` is off the list: `"false"` would become `true`). Casts select only values of the types they are planned from.
- **Names Will accepted with the approval:** `castField`, `fillField`, `rawAggregate`, `rawUpdateMany`, the warning kind `documentsNotRewritten`. Enum values are in slice 4b.
- **CLI changes are fine when they are genuine, family-blind improvements**, not overfitted parameters on generic paths. PR #30970 includes seven: planner warnings in `migration plan`, `plannerWarnings` as the `--json` field in all three commands (upgrade fragment `cli-json-planner-warnings`), "existing data" wording for temporary values, re-run advice that keeps the user's flags, failed-cast advice, the type change question, the applied count.

## 4b PR 2: what to build

Per the spec's PR 2 row: the path walk (value object fields, embed relations with a list step for one-to-many, variant branches), then rename, delete, fill and backfill of keys inside value objects and embedded models (`renameStoredKey`, `removeStoredKey`, `fillStoredKey`, SQL's names and shape with the root field in the column's place, JSONPath like SQL), enum value rename and delete including inside value objects (`replaceStoredValue`, `removeStoredValue`; values that trade places go through a temporary value as SQL does; object and array enums refused), variant convert, rename that changes the discriminator value, and delete (`deleteDocuments`). It removes MongoDB's refusals of `enumValue`, `valueObjectField` and discriminator value changes, and the embedded-model refusals PR 1 added. Every operation self-contained (see above). Notes for PR 2 from the PR 1 reviews are at the end of the spec.

Follow `/drive-process`: plan into dispatches, one Opus implementer and one Opus reviewer per dispatch, `/drive-code-review` (both passes, no walkthrough) and full manual QA **on the exact commit you push**, fix, then the PR. The PR 1 dispatch briefs are in `slices/mongo-convert-backfill/dispatches/` on this branch as examples of the brief format.

## After 4b

1. The storage-naming write-up (`plan.md`, "Alongside"): a critical discussion and a survey of how established tools name tables on the command line, for Will to decide. `--rename table/users:app_users` was an off-the-cuff example, not a decision.
2. Close-out (`plan.md`, "Close-out"; the `drive-process` skill's `close-project.md`): verify every project DoD item with evidence, final retro, the project ADR, amend ADR 001, ADR 028 and the Data Contract and Migration System subsystem docs (they still describe `@hint(was:)`), migrate long-lived docs into `docs/`, strip references to `projects/migration-statements/`, delete the folder, sliced commits.

## Outside the project (Linear)

- TML-3791: the framework's runner failure type holds SQL-only facts the CLI reads. Not now.
- TML-3809: the Prisma 6 MongoDB upgrade guide on the docs site should say what to do when the first validator change fails.
- TML-3815: Postgres offers `--delete` for a type change it has no cast for. **Will is fixing this himself.**

## How Will wants the work done

These are in the auto-memory index (`/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm/memory/MEMORY.md`) and `~/.claude/CLAUDE.md`; the ones that mattered most here:

- Design with Will, then execute without interrupting him. A follow-up question or "agreed" is not a go; never start building while he is still shaping a design.
- Never change the framework domain; stop and tell him. CLI code is framework code: changes there must be genuine and family-blind.
- Run `/drive-code-review` and full manual QA on the commit you push; per-dispatch checks do not count.
- Fix known flaws without asking; don't raise things he cannot act on.
- Plain English, short sentences, ISO 24495-1. No review IDs or bare ticket numbers in reports. No question UI; ask in message text.
- Git: act as the `wmadden-electric` bot, push through the `bot` remote, commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, no AI attribution lines, no history rewrites, run node and pnpm through `mise exec --`, no `/tmp`, no bare `git stash`.
- Subagents run on Opus. A long-running implementer fills its context; start a fresh one with a complete brief rather than resuming past ~900k tokens.
- Put `Agent: <name>` in every PR description.

## Worktrees left behind

Under `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c`: `wip/wt-4b` (PR #30970's branch; gitignored review artifacts under `projects/migration-statements/slices/mongo-convert-backfill/reviews/`), `wip/wt-pr4` and `wip/wt-pr2` (merged 3b branches), `wip/wt-handover` (this branch). The root worktree is on a stale branch. None of them is needed; start fresh from `origin/main`.
