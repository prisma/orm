# Handover — Migration statements (TML-3474)

From beowulf-40, 2026-10-08. Read this first, then `spec.md`, `plan.md` and `deferred.md` in this folder.

## What the project is

`prisma migration plan` and `prisma db update` used to drop a renamed table, and lost data after a single yes/no. The project makes the user state what each change means, on the command line or at a prompt:

```text
$ prisma migration plan --name tidy --rename Profile:User
✖ [CLI.CONSENT_REQUIRED] 1 subject needs a statement, and the session is not interactive.
  why: Drop table "Legacy" would lose the data of model "Legacy".
→ Pass --rename 'Legacy:<new name>'
→ Pass --delete Legacy
```

A **statement** is a verb plus values (`--rename old:new`, `--delete Model.field`, `--allow Model`). The planner never guesses a rename. A plan that loses data is refused until each data-losing operation is answered.

## State on 2026-10-08

| Piece | Ticket | PR | State |
| --- | --- | --- | --- |
| Slice 1: `--rename` for models and fields, Postgres and SQLite | TML-3475 | prisma/orm#30638 | merged, Done |
| Engine: statements in the shared CLI engine (`@prisma/cli-engine` 0.7.0) | — | prisma/prisma-cli#337 | merged, 0.7.0 on npm |
| Slice 2: refuse data loss; `--delete`, `--allow`; interactive prompt | TML-3476 | prisma/orm#30648 | merged, Done |
| Slice 3: `--convert`, `--backfill`, remaining renames (SQL) | TML-3477 | — | not started |
| Slice 4: the same statements on MongoDB | TML-3478 | — | not started |

Nothing is uncommitted or unpushed. Will is publishing the ORM and the CLI himself; do not publish.

## What to do next

**Will has not yet chosen between slice 3 and slice 4.** Recommended: slice 4 first. MongoDB is the only database where a rename has no clean path (it refuses `--rename` and gives manual steps), and a validator that newly requires a field leaves existing documents unwritable with no warning (deferred.md, "A MongoDB validator that requires a new field"). Slice 3 adds capability on databases that already work. Ask Will which, in one line, then follow `/drive-process`: write the slice spec and plan under `slices/<name>/`, dispatch implementers, review, manual QA, PR.

Slice 4 must delete the temporary MongoDB-only member `renameStatements` (`{ refused: true; keepDataByHand }`) in `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts`, its CLI reads (`git grep -n "keepDataByHand\|renameStatements" packages/1-framework/3-tooling/cli/src`), and its doc mention. `plan.md` still calls it `refusesRenameStatements`, its earlier name.

After both slices: the close-out list at the end of `plan.md`.

## Where the code is

- Statement parsing and resolution: `packages/1-framework/3-tooling/cli/src/control-api/statements/`. `plan-questions.ts` turns the planner's data-loss and access-widening lists into engine questions and re-plans after a typed rename.
- Verb declarations shared by both commands: `packages/1-framework/3-tooling/cli/src/orm/statement-verbs.ts`.
- Framework types: `packages/1-framework/1-core/framework-components/src/control/migration-statements.ts`.
- SQL family mapping: `packages/2-sql/9-family/src/core/migrations/statement-planning.ts` and `operation-subjects.ts`.
- Targets: `packages/3-targets/3-targets/{postgres,sqlite}/src/core/migrations/`; MongoDB under `packages/2-mongo-family/` and `packages/3-mongo-target/`.
- Engine: prisma/prisma-cli `packages/cli-engine/src/execution/{prompts,statement-flags}.ts`; ADR 0006 there.
- Docs: Migration System subsystem doc § Statements; CLI Style Guide consent section; `docs/reference/error-reference.md`.

## Decisions Will made (do not reopen)

- Consent is a statement answered with a verb, not a copied token. The engine knows no verbs; each command declares its own with an arity.
- `destructive` means "can lose rows or values". `SET NOT NULL`, safe type widenings, MongoDB index and validator changes are `widening`.
- Dropping a row-level-security policy or disabling RLS stays `widening` but gets its own `--allow` question on `db update`.
- A model that keeps its name but changes `@@map` gets no statement in this project; the refusal gives manual steps. A future syntax for naming storage objects (Will's `table/users:app_users` was an off-the-cuff example, not a decision) needs a critical discussion and a survey of prior art first.
- PR CI skips integration tests deliberately (cost). Before queueing a behaviour change, find the integration journeys that run the changed commands and run them locally: `pnpm --filter integration-tests test <paths>`.

## Open follow-ups outside the slices

- prisma/prisma-cli#338: drop two conformance exceptions once `@prisma/composer-cli` and `@prisma/orm-toolchain` release against engine 0.7.0.
- prisma/prisma-cli#339: apply the unused-`--confirm` rule to every command (two commands accept `--confirm` without using it).
- TML-3516 (SQLite autoincrement fails the first `db update` schema check), TML-3517 (the advice when `SET NOT NULL` fails on NULLs).
- The smaller items in `deferred.md`.

## Context to read

- beowulf-40's transcript (this session: handover from turing-38, engine design, slice 2): `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-migration-statements-handover-413a1f/e892b085-7419-4d23-94bc-6a44f4af1645.jsonl`. Will's messages are the `user` entries whose content is a string; grep for them first.
- turing-38's transcript (slice 1), extracted to text: `/Users/will/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-413a1f/wip/turing-38-transcript.txt`.
- Review files from slice 2 and the engine slice are gitignored and exist only in the old worktree: `/Users/will/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-413a1f/projects/migration-statements/slices/{refusal,engine-statement-prompt}/reviews/`.
- Slice 2's manual QA report (committed): `manual-qa-reports/2026-10-08-qa-slice-2.md`.

## How Will works

- Write briefly and in plain words. He has not read briefs or tickets; explain every reference.
- Decide routine calls yourself; ask only for design decisions. Do not use the question UI.
- A direct instruction from Will overrides a rule in a handover, including this one.
- All subagents run on Opus (`model: "opus"`). You write specs, plans and PR text yourself.
- Commits: `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, subject `TML-NNNN: …`. Push through the `bot` remote. No attribution lines in commits, PRs or comments; put `Agent: <name>` in PR descriptions.
- PR descriptions: open with a representative example and what it replaces, then the decision, then a step-by-step narrative, alternatives last.
