# Manual QA — slice 1, rename statements (TML-3475)

> **Be the user.** Run the published CLI against real databases in a scratch project, read every message as someone who has never seen this feature, and judge what the journeys cannot: whether the errors tell you what to type next, whether the output explains itself, and whether anything loses data.
>
> **Out of scope.** Do not re-run `pnpm test`, the journeys, or CI lints. Do not read the source to decide whether behaviour is right; decide from what the commands print and what the database holds.
>
> **Spec:** `projects/migration-statements/slices/renames/spec.md` · **Project spec:** `projects/migration-statements/spec.md`

## What this script is testing

**The problem.** Renaming a model or field in the contract source used to plan a dropped table plus a created one, and rows were lost after one consent prompt.

**What changed.** `prisma migration plan` and `prisma db update` accept `--rename <old>:<new>` for models and fields, in contract names. The planner renames the table or column and every constraint and index named after it, and reports `Statements applied`. A statement it cannot resolve or apply fails before anything is written. `db update` finds the old contract through the snapshot of the database's marker. Drops that lose no data (indexes, constraints, checks, policies, defaults, native enum types, disabling RLS) no longer ask for consent. MongoDB refuses every statement in this release.

**Audiences.** End users of the CLI (scenarios 1 to 7). Extension authors who implement a migration planner (scenario 8). Agents using the `prisma-8` skill (scenario 9).

## Scenarios

| # | Scenario | What it proves | Isolation |
| - | -------- | -------------- | --------- |
| 1 | Rename a model and a field through `migration plan`, then `migrate`, on Postgres | Rows survive; names, constraints, indexes, check and policy follow; output explains itself | tmpdir |
| 2 | The same through `db update` on SQLite, then run it again | No prompt; rows survive; the second run fails with a message that says why | tmpdir |
| 3 | Type the statements wrong, once each way | Each error says what was searched, what was found, and what to type instead | tmpdir |
| 4 | `db update --db <url>` with a statement and no snapshot | The error names the hash and directory and tells you about `--advance-ref` | tmpdir |
| 5 | A model that keeps its name but changes `@@map`, with a field statement | The refusal tells you a safe route; nothing is dropped | tmpdir |
| 6 | Drop an index only, through `db update`, on Postgres | No consent prompt for a drop that loses no data | tmpdir |
| 7 | `--rename` on a MongoDB project | Refused; nothing planned; the advice does not lead to data loss | tmpdir |
| 8 | Read the extension upgrade instructions as a planner author **(judgement)** | You know exactly what to change in a planner you maintain | read-only |
| 9 | Ask the skill how to rename a field **(judgement)** | `skills/prisma-8/references/migrations.md` leads to `--rename` in the right form, and to the hand-written route as the fallback | read-only |
| 10 | Exploratory: 20 minutes of statement combinations | Anything the scenarios missed: case-only renames, two statements on one model, a relation field, `@@map` kept, `--to`, `--from @empty` | tmpdir |

## Pre-flight

1. `git branch --show-current` is `tml-3475-statement-renames`; `git status --short` shows no source changes.
2. `mise exec -- pnpm install --frozen-lockfile` and `mise exec -- pnpm build`.
3. Create scratch projects with `prisma init` from the built CLI (or copy `test/integration/test/fixtures/cli/cli-e2e-test-app`), one per scenario, under `wip/qa/`. Postgres: a local `@prisma/dev` server or PGlite through the dev server, as the journeys use. MongoDB: `mongodb-memory-server`.

## Scenario details

### 1. Postgres, `migration plan` then `migrate`

Contract "from": `Profile { id Int @id; name String @unique; handle String; @@index([handle]) }`, a `Post` with a foreign key to `Profile`, a check on `Profile`, an RLS policy. Plan and migrate it, insert three rows. Change to "to": model `User`, field `fullName` (keep the unique and index on it). Run `prisma migration plan --name tidy --rename Profile:User --rename User.name:User.fullName`.

- Read the human output. Do the operations read as renames, all `widening`? Does `Statements applied` say what it did with operation counts?
- Open the written `migration.ts`. Is it what you would have written by hand (`renameTable`, `renameColumn`)?
- `prisma migrate`, then query the database: rows present, constraint and index names, policy, check, foreign key from `Post`.
- `prisma migration plan` again: nothing to plan. `prisma db verify --schema-only`: clean.

### 2. SQLite, `db update` twice

Same contracts without the check and policy. `prisma db update` on "from", insert rows, swap to "to", `prisma db update --rename Profile:User --rename User.name:User.fullName`. No prompt; rows survive. Run the same command again: it fails. Does the message make it obvious that the rename already happened?

### 3. Wrong statements

On the scenario 1 project before migrating the rename, try: `--rename Profile.name:User.fullName` (old model named on the field side); `--rename Profile:Nope`; `--rename Profile` (no colon); `--rename Profile:User.fullName` (model to field); `--rename User:Profile` (backwards). For each: is the error code right, does the message quote what you typed, name what it searched and found, and tell you what to type instead? Was anything written under `migrations/`?

### 4. `--db` without a snapshot

On a fresh SQLite project, `prisma db update --db <path>` (no `--advance-ref`) on "from", swap to "to", `prisma db update --db <path> --rename Profile:User`. Read the error. Does it explain why the old contract is unknown and that `--advance-ref <name>` on the earlier run would have kept it?

### 5. `@@map` changes, model name kept

"From": `model User { ...; @@map("users") }`. "To": `@@map("app_users")` and a field renamed. `prisma migration plan --rename User.name:User.fullName`. Is it refused? Does the advice (rename the table by hand with `renameTable` first) lead to a migration that keeps the rows? Follow it and check.

### 6. A drop that loses no data

Postgres project with `@@index([handle])`. Remove the index from the contract and run `prisma db update` with no flags in a terminal. No consent prompt should appear. Compare with removing a field: that still asks.

### 7. MongoDB

Mongo project with a `Profile` collection holding documents. Rename the model in the contract. `prisma db update --rename Profile:User`. Refused with `MIGRATION.PLANNING_FAILED`; nothing planned. Read the advice: does following it keep the documents? Do not run without `--rename` to find out; the advice must say what would happen.

### 8. Extension upgrade instructions (judgement)

Read `upgrade-instructions/pending/migration-statement-renames/extension/instructions.md` as the author of a third-party SQL target's planner. Oracle: after reading, you can list every type you must change and what to put there, and you know which call shapes the detection misses.

### 9. Skill replay (judgement)

Read `skills/prisma-8/references/migrations.md` as an agent asked "rename the `email` field on `User` to `emailAddress` without losing data". Oracle: the text leads to `--rename User.email:User.emailAddress` on `migration plan` or `db update`, warns that MongoDB refuses it, and keeps hand-editing `migration.ts` as the fallback.

## Report

Write `projects/migration-statements/manual-qa-reports/<YYYY-MM-DD>-<runner>.md`: one section per scenario with what you ran, what you saw (paste outputs), and a verdict (✅ / ⚠️ / 🛑 Blocker). File every 🛑 and ⚠️ as a numbered finding with the exact command and output.
