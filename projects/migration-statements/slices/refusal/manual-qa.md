# Manual QA — slice 2, the refusal and `--delete` (TML-3476)

> **Be the user.** Run the built CLI against real databases in a scratch project, read every message as someone who has never seen this feature, and judge what the journeys cannot: whether a refusal tells you what to type next, whether the interactive questions make sense, and whether anything loses data without you saying so.
>
> **Out of scope.** Do not re-run `pnpm test`, the journeys or CI lints. Decide from what the commands print and what the database holds, not from the source.
>
> **Spec:** `projects/migration-statements/slices/refusal/spec.md` · **Project spec:** `projects/migration-statements/spec.md` · **Engine:** `wip/prisma-cli` README § statements (prisma/prisma-cli#337)

## What this script is testing

**The problem.** A plan that dropped a table or column ran after one yes/no consent for the whole plan (`--confirm <database>`), or, on `migration plan`, with no consent at all unless it was an automatic baseline.

**What changed.** Both commands refuse any plan that loses data until the user has said what each operation means. Non-interactively the refusal lists every operation with the flag that answers it (`--delete Legacy`, `--rename Legacy:<new name>`); in a terminal each operation is a question the user answers by typing `delete` or `rename Legacy:Archive`. `--confirm` no longer consents to data loss. Before `db update` drops a row-level-security policy or disables row-level security it asks the same way with `allow`. Operations that lose no data (`SET NOT NULL`, safe type widenings, MongoDB index and validator changes) no longer count as destructive.

**Audiences.** End users in a terminal (the interactive path is the one the journeys cannot drive), scripts and agents (the refusal), extension authors (the upgrade fragment), agents using the `prisma-8` skill.

## Scenarios

| # | Scenario | What it proves | Isolation |
| - | -------- | -------------- | --------- |
| 1 | Postgres, terminal: remove a model and rename another, run `migration plan` with no flags, answer the questions by typing | The question text is understandable; `delete` and `rename X:Y` both work typed; a wrong answer is explained and re-asked; the written plan matches the answers | tmpdir, real TTY |
| 2 | The same non-interactively (`< /dev/null` or `--no-interactive`) | The refusal lists every operation and the exact flags; pasting them works; nothing was written by the refused run | tmpdir |
| 3 | SQLite, `db update` interactive, then `--confirm <database>` only, then `--delete` | `--confirm` alone is refused with `CLI.CONSENT_REQUIRED`, which names the leftover `--confirm` and the flags that answer; `--confirm` with every question answered is `CLI.CONSENT_UNUSED`; `--delete` applies; a second run with the same statements fails and says why | tmpdir, real TTY |
| 4 | A stray or misspelled `--delete`, and `--delete` on a dry run | A stray `--delete` with every question answered is `CLI.CONSENT_UNUSED`; a misspelled one next to an unanswered question is named in the `CLI.CONSENT_REQUIRED` refusal; nothing is written or applied. On a dry run a matching `--delete` is accepted and its question marked `(answered)`, and one that matches nothing is `MIGRATION.STATEMENT_ANSWERS_NO_QUESTION` | tmpdir |
| 5 | Postgres, drop a policy through `db update` | The dry run lists it under access widening and asks nothing; the apply asks with `allow`; `--allow User` applies | tmpdir |
| 6 | Add a required field to a populated table, Postgres and MongoDB; tighten a column to NOT NULL with and without NULLs | No question; the NULL case fails clearly without losing data | tmpdir |
| 7 | `db update --db <url>` with no snapshot, dropping a model | The refusal names the table by its storage name and says the origin is unknown; `--delete <storage name>` applies | tmpdir |
| 8 | A field on a renamed model: `--rename Profile:User` with `Profile.nickname` dropped | The refusal suggests `--rename 'User.nickname:User.<new name>'`; that form resolves; the `Statements applied` block names things the way you typed them | tmpdir |
| 9 | MongoDB: drop a collection through both commands; `--rename` | Refused until `--delete Event`, and the question says how to keep the documents by hand (rename the collection in `mongosh` before a plan that drops it is applied; a migration written by `migration plan` still drops it); `--rename` refused with advice that loses nothing | tmpdir |
| 10 | Read the app and extension upgrade fragments as their audiences **(judgement)** | A script author knows what to replace `--confirm` with; a planner author knows every field and type to add | read-only |
| 11 | Ask the skill how to delete a field and how to answer a refusal **(judgement)** | `skills/prisma-8/references/migrations.md` leads to `--delete`, and to `--rename` when the user meant a rename | read-only |
| 12 | Exploratory: 20 minutes | Two `--delete`s, `--delete` for a model whose field is also dropped, an auto-baseline plan with a drop, `--json` in a TTY (does it still prompt to stderr?), `--yes`, Ctrl-C at a question (exit 3), a placeholder plan with a drop | tmpdir |

## Pre-flight

1. `git branch --show-current` is `tml-3476-statement-refusal`; `git status --short` shows no source changes.
2. `pnpm install --frozen-lockfile` and `pnpm build`. The engine is the preview build of prisma/prisma-cli#337 through the root `pnpm.overrides`; confirm `node_modules/@prisma/cli-engine/package.json` says 0.7.0.
3. Scratch projects under `wip/qa/`, one per scenario, from the built CLI's `prisma orm init`. Postgres through `@prisma/dev`; SQLite files; MongoDB through `mongodb-memory-server`. Scenarios 1 and 3 need a real terminal (`script`, `expect`, or run them yourself in a pty); the plain line reader fails on a wrong answer where clack re-asks, note which renderer you got.

## Report

Write `projects/migration-statements/manual-qa-reports/<date>-qa-slice-2.md`: a verdict per scenario (✅ ⚠️ 🛑), every finding numbered with the exact command, output and what you expected, and a note of anything the script did not cover. A finding is a blocker when an error's advice loses data if followed, or when data is lost with no statement.
