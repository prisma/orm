# Manual QA — slice 3a, `--convert` and `--backfill` (TML-3477)

> **Be the user.** Run the built CLI against PGlite and SQLite in scratch projects. Read every message as someone who has never seen this feature. Judge what the journeys cannot: whether a refusal tells you what to type next, whether the written `migration.ts` reads like code you would write, and whether anything loses or corrupts data without you saying so.
>
> **Out of scope.** Do not re-run `pnpm test`, the journeys or CI lints. Decide from what the commands print and what the database holds, not from the source.
>
> **Spec:** `projects/migration-statements/slices/convert-backfill/spec.md`

## What this script is testing

**The problem.** `migration plan` wrote placeholder migrations on its own for every lossy type change and every required field added to an existing table. Users who did not want them got a migration they could not apply until they edited it. SQLite could not add a required field to a table with rows at all.

**What changed.**
- A lossy type change is refused and answered with `--convert` (write the conversion into a slot) or `--delete` (run the database's cast; a value it cannot cast fails the migration and points to `--convert`).
- `--backfill` writes a slot to fill existing rows of a field that became required. Without it, a new required field gets a temporary value (`''`, `0`, …), on both databases.
- `db update` refuses both flags and prints the `migration plan` command to run.
- When a column cannot become required because rows have no value, the error counts them and says what to do.

**Audiences.** End users in a terminal and in scripts; agents using the `prisma-8` skill; anyone with hand-written migrations that call `alterColumnType` (its options changed).

## Scenarios

Run each on Postgres (PGlite) and SQLite unless marked.

| # | Scenario | What it proves |
| - | -------- | -------------- |
| 1 | `age String` → `age Int` on a table with rows `'12'` and `'abc'`. `migration plan` with no flags, non-interactive | Refused; offers `--convert User.age` and `--delete User.age`; nothing written |
| 2 | Same in a real terminal; type `convert` at the prompt | The question reads clearly; the plan writes one slot; `migration.ts` reads like hand-written code |
| 3 | Fill the slot (`trim("age")::integer` on Postgres, `CAST(trim("age") AS INTEGER)` on SQLite) after fixing `'abc'`; run the printed `node` command; `db migrate` | Rows converted; `db verify --schema-only` clean; a further plan empty |
| 4 | `--delete User.age` with `'abc'` still present, through `migration plan` + `db migrate` and through `db update` | Fails with nothing changed; the advice names `--convert`; following it as printed ends in an applied conversion |
| 5 | `VarChar(10)` → `VarChar(20)` (Postgres) | Planned with no question |
| 6 | Add a required `email String` to a table with rows; no flags; both commands | Temporary `''` in old rows; column required, no default left |
| 7 | Same with `--backfill User.email`; fill the slots | Old rows get your values |
| 8 | Add a required enum field, and a required unique field, to a table with rows | No temporary value; the failure counts the rows; its advice, followed as printed, ends in an applied migration |
| 9 | Make `note String?` required with NULLs present, through `db update` and through `migration plan` + `db migrate` | The error counts the NULL rows; each printed route ends applied |
| 10 | `db update --convert User.age`, then follow the printed `migration plan` command; also against a database that does not answer | Refused in seconds, nothing created; the printed command works |
| 11 | A hand-written `alterColumnType` with the old options; then with the new options | The upgrade fragment tells you what to change; the new call works |
| 12 | Read the app upgrade fragments as a user **(judgement)** | You know what changed and what to do |
| 13 | Ask the skill how to change a field's type safely **(judgement)** | `skills/prisma-8/references/migrations.md` leads to `--convert` in the right form |
| 14 | Exploratory: 20 minutes | Anything the scenarios missed |

## Pre-flight

1. In the worktree, `git status --short` shows no source changes.
2. `mise exec -- pnpm build`.
3. Scratch projects under `wip/qa-3a/`, one per scenario, with a PGlite dev server or a SQLite file. Stop every server you start, by PID.

## Report

Write `projects/migration-statements/manual-qa-reports/<YYYY-MM-DD>-qa-slice-3a.md`: a summary table with a verdict per scenario (✅ / ⚠️ / 🛑 Blocker), then each finding numbered `F<N>` with the exact command and output. A blocker is anything that loses or corrupts data without the user saying so, or advice that does so when followed.
