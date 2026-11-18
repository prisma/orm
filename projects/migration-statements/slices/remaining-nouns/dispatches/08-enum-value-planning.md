# Dispatch 8 — the SQL planners see and plan enum value changes

**Slice:** [`../spec.md`](../spec.md) § "What changes for users" (enum value rows), § "What each statement does", Enum values; decision 2 · **Plan:** [`../plan.md`](../plan.md) § PR 2 · **Branch:** `tml-3537-enum-values` · **Builds on:** dispatch 6 (statements and subjects), dispatch 7 (`replaceStoredValue`, `removeStoredValue`)

## Outcome

On Postgres and SQLite, when a stored value of a declared enum disappears between the origin and destination contracts and a column still holds it, both commands ask about it as an enum value. `--rename Status.ARCHIVED:Status.RETIRED` rewrites the rows. `--delete Status.ARCHIVED` sets it to NULL in optional columns and removes it from lists, and is refused where a required scalar column holds it. A rename of the member name alone, with the stored value kept, plans nothing and is reported as applied.

## The rules

- **Compare stored values, not member names.** The origin and destination enums are compared by the `value` of each member, as the value set in storage holds it. A removed stored value is a loss. A member whose name changes but whose stored value stays the same is not a loss.
- **Which columns.** Every column, in every table of the destination, whose field the enum types: scalar and list columns. A column whose table is dropped or whose field is dropped is already asked about as that table or field; do not ask twice. Enum values inside value object JSON are out of scope (PR 4); if a value object member is typed by the enum, say so in the report and leave it.
- **Without an origin contract** (`db update` with no snapshot), no enum is known to have changed; nothing is asked, as today. On Postgres the new check then fails at apply if a row holds the old value; that is today's behaviour and stays.
- **One question per enum value**, not per column. The subject is the enum value (`Status.ARCHIVED`). The question names the value; the plan's operations for all its columns account for it.
- **`--rename`** plans one `replaceValue` per column. **`--delete`** plans one `removeValue` per column. A required scalar column holding the value makes `--delete` refused with `statementRefused` naming the column and pointing to `--rename` or a hand-written migration; check the database cannot be asked in advance, so this is a planning-time refusal based on the column being required, not on its rows.
- **A member that keeps its name but changes its stored value** cannot be stated (spec edge case). Ask about it with `--delete` only, and the question says to write the update by hand in `migration.ts` with `this.replaceStoredValue(...)`.
- **Order on Postgres.** The value rewrite runs after the old check is dropped and before the new check is added, in the same plan. Find how `issue-planner.ts` buckets `dropCheckConstraint` and `addCheckConstraint` and place the rewrite between them; pin the order in a test. On SQLite there is no check; order the rewrite before anything that would reject the old value.
- **Native Postgres enums** keep their existing refusal; nothing here touches them.
- **Classes.** `replaceStoredValue` is `widening`, `removeStoredValue` `destructive` (dispatch 7), so `db update` runs both.
- **Encode each value through the column's codec** before building the call, as literal defaults are (`control-adapter.ts`, `fromDataTypeValue` then `toWire`). The calls take the value as the database stores it. A value in the wrong form matches no row, the postcheck then holds, and the runner silently skips the rewrite; the dispatch 7 review proved this on SQLite with the number `1` against a TEXT column holding `'1'`. Test that case through the planner.

## Do

1. Read first: `packages/2-sql-family/9-family/src/core/migrations/statement-planning.ts` and `operation-subjects.ts`; the Postgres and SQLite planners, issue planners, strategies and `operation-subjects.ts` under `packages/3-targets/<db>/1-target/src/core/migrations/`; `check-expressions.ts` on Postgres; how PR 1 reports namespaces on the planner result. Decide where the enum comparison lives: it is contract-level and family-wide, so the SQL family is the likely owner, with targets supplying the calls.
2. Replace dispatch 6's temporary refusal in the SQL family planner with real planning.
3. **Tests first, red before each change:** family-level detection (removed value, member-name-only rename, stored value changed under the same name, value in a list column, two tables using the enum, a dropped table not asked twice); Postgres planner (rename and delete plans, check-drop / rewrite / check-add order, refusal for a required column, the hand-written advice for a changed stored value, native enum untouched); SQLite planner (the same where it applies); CLI question text and the `--delete` answer (`delete enum value "Status.ARCHIVED"`); `migration.ts` round trip.
4. **On PGlite and SQLite, through both commands** (`migration plan` + `migrate`, and `db update`): a table with rows holding the old value; rename and delete; afterwards no row holds it, `db verify --schema-only` is clean, and a further plan is empty. Put these as journeys under `test/integration/test/cli-journeys/` following the namespace journeys' shape; dispatch 9 adds the rest.
5. **Docs:** Migration System § Statements: application for enum values, and the "Rename limits" list; the error reference for any new refusal.

## Do not

- Do not handle value object JSON (PR 4) or native Postgres enums.
- Do not change the stored-value operations' shape without saying why.

## Rules

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Only named files inside `test/integration` with `pnpm test <file>`; journeys with `pnpm test:journeys <file>`.
- The machine is heavily loaded; run tests by file where you can, and re-run alone any 500 ms timeout in a file you did not touch.
- Use the shell's Node and `pnpm`. Never `npx`.
- No comments where the code can say it; no bare `as` casts in production code; no file extensions in imports; framework packages name no family or target.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines. Stage files explicitly.
- Do not push. Do not open a PR.
- Save slow command output under `wip/` and read the file.

## Done when

- Typecheck; lint and `test --coverage` in the SQL family, the Postgres and SQLite targets and adapters, the CLI (by file if load makes the full run time out); `lint:deps`; `lint:ratchets`; `fixtures:check`; `check:error-reference`; `check:upgrade-coverage --mode pr --prev $(git merge-base HEAD origin/main) --head HEAD`.
- The new journeys pass, and every existing journey under `test/cli-journeys/` whose name contains `statement`, `rename`, `delete` or `enum`.

## Report

Plain English, short sentences: where the comparison lives and why, the question and refusal texts, the Postgres order and how it is pinned, the journeys and what each proves, the test that was red first for each change, the gates with results, anything the brief did not cover, and the commits.
