# Dispatch 1 — the access question uses family-neutral words

**Slice:** [`../spec.md`](../spec.md) § "The access question" · **Plan:** [`../plan.md`](../plan.md) · **Branch:** `tml-3537-namespaces` (create it from `tml-3537-remaining-nouns-spec`)

## Outcome

`db update` asks about a change to who can read or write a model's data in words that fit every database family, and the names of the type, the field, the JSON key and the option say "access changes", not "access widening".

## What Will ruled (2026-10-19)

"The CLI can't be postgres- or sql-specific." The question "would widen who can read and write its rows" names rows, which only SQL has. The accepted fix: the question says "its data"; the framework's doc comments drop the row-level-security examples; `accessWidening` is renamed `accessChanges`, because it also lists changes that do not widen access, such as dropping a policy.

## Do

1. **Question text** (`packages/1-framework/3-tooling/cli/src/control-api/statements/plan-questions.ts`, around line 379): `${label} would widen who can read and write its data.` / `… would change who can read and write its data.` Update the tests that assert the text.
2. **Rename** `accessWidening` to `accessChanges` on `MigrationPlanSubjects` (`packages/1-framework/1-core/framework-components/src/control/migration-statements.ts`) and at every reader: the CLI (`db-run.ts`, `migrate.ts`, `migration-plan.ts`, `orm/db/update.ts`, `orm/db/migration-blocks.ts`, `utils/formatters/migrations.ts`, `testing/fixture-client.ts`), the migration package (`planner-types.ts`, `planner.ts`, `strategies/plan-from-diff.ts`, `strategies/resolve-recorded-path.ts`), the SQL family (`operation-subjects.ts`, `plan-helpers.ts`), the Postgres, SQLite and MongoDB planners and their `operation-subjects.ts`. Rename `accessWideningOf` and any other helper named after it the same way. `MigrationAccessChange` already has the right name; keep it.
3. **Public surface.** The `db update --dry-run --json` key `accessWidening` becomes `accessChanges`. The programmatic option `acceptAccessWidening` (`control-api/types.ts`, `db-update.ts`, `client.ts`, `db-run.ts`) becomes `acceptAccessChanges`. Both are breaking changes for apps: add an app upgrade fragment under `upgrade-instructions/pending/` that renames the option and the JSON key, following the shape of an existing fragment there, and make sure it is validated by execution as the others are.
4. **Doc comments.** `MigrationAccessChange`, `MigrationPlanSubjects`, `plan-questions.ts` and `control-api/types.ts` describe the change in family-neutral words. The Postgres examples (row-level security, policies) move to the Postgres target's `operation-subjects.ts`, where the entries are produced.
5. **Docs that mention the names or the wording:** `packages/1-framework/3-tooling/cli/README.md` (line 965 area), `docs/architecture docs/subsystems/7. Migration System.md` § Statements (lines 173–196 and 236), `skills/prisma-8/references/migrations.md`, and `docs/releases/v8.0.0-rc.17.md` only if it documents the option as current.
6. **Tests first.** Each change starts from a failing test: the question text, the JSON key, the option name, and a type-level test that the old names no longer exist on the public types.

## Do not

- Do not change what the question asks about or when it is asked.
- Do not add a backwards-compatible alias for the old names.
- Do not touch anything in the namespace work; that is dispatches 2 to 5.

## Rules

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run only named files inside `test/integration` with `pnpm test <file>`.
- Use the shell's Node (`node -v` is 24, which satisfies `engines.node`) and `pnpm`. Never `npx`.
- No comments where the code can say it; no bare `as` casts in production code; arktype, not zod; no file extensions in imports.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines (no `Co-Authored-By: Claude`, no "Generated with Claude Code"). Stage files explicitly; never `git add -A`.
- Do not push. Do not open a PR.
- Save slow command output to a file under `wip/` and read the file; do not re-run commands to grep different lines.

## Done when

- Every gate in the plan's "Gate for every dispatch" passes: typecheck; lint and tests with coverage in every touched package; `lint:deps`; `lint:framework-vocabulary`; `lint:throws`; `lint:casts`; `check:upgrade-coverage --mode pr --prev $(git merge-base HEAD origin/main) --head HEAD`; `pnpm lint:docs` if it exists.
- `git grep -n "accessWidening\|acceptAccessWidening\|read and write its rows"` over `packages/`, `docs/`, `skills/`, `test/` and `examples/` finds nothing except release notes of shipped versions.
- Every integration and e2e file that mentions `accessWidening`, `acceptAccessWidening` or `--allow` passes, run by name.

## Report

A short plain-English report: what changed, the test that was red first for each change, the gates run with their results, anything you found that the brief did not cover (do not fix it unless it blocks you; name it), and the commits.
