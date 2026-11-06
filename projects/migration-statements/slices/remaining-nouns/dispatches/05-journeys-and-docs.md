# Dispatch 5 — journeys, docs and the pull request text for PR 1

**Slice:** [`../spec.md`](../spec.md) · **Plan:** [`../plan.md`](../plan.md) · **Branch:** `tml-3537-namespaces` · **Builds on:** dispatches 1 to 4

## Outcome

PR 1 is ready to open: every namespace row of the spec's table "What changes for users" is proven by a journey through both commands, every doc that describes statements is current, ADR 223's stale sentence is corrected, and the PR title and body are drafted.

## Do

1. **Journeys.** `test/integration/test/cli-journeys/` already has `move-statements-migration.e2e.test.ts` and `namespace-statements.e2e.test.ts`. Make sure between them, through `migration plan` plus `migrate` and through `db update`, on Postgres (PGlite), these hold, each with rows in the tables, a foreign key, a unique constraint, an index and a policy, and each ending with `db verify --schema-only` clean and a further plan empty:
   - a model moved to another namespace with `--rename Invoice:billing.Invoice`, where the schema does not exist yet;
   - a namespace renamed with `--rename billing:finance`, followed in the same run by a model rename inside it;
   - a namespace removed, refused without statements, with the refusal text containing the exact `--delete` statements that then succeed, both `--delete billing` and the per-model form;
   - `--delete billing` with `--rename billing.Invoice:Invoice` in one run keeps `Invoice`;
   - a removed namespace that also holds a table no contract declares: its own question, answered with the storage name;
   - the `public` refusal and the shared-space refusal, with the message text asserted;
   - re-running every `migration.ts` these journeys write reproduces its `ops.json` byte for byte.
   Reuse the fixtures and helpers the two existing journeys use. Do not duplicate a journey that already covers a row; extend it.
2. **Docs, read as a user with none of our context:**
   - Migration System § Statements: grammar (a side is a namespace, a model, a field; the ambiguity rule), application (move, schema rename, removed namespace, `--delete <namespace>`, undeclared tables in a removed schema), the "Rename limits in this release" list, and the `db update` origin section.
   - `docs/reference/error-reference.md`: every refusal added in dispatches 3 and 4.
   - `packages/1-framework/3-tooling/cli/README.md` and `skills/prisma-8/references/migrations.md`: the namespace forms of `--rename` and `--delete`.
   - ADR 223 line 54 (and nearby): it says emission rejects a contract with more than one domain namespace; that check was removed. Add an update note in the ADR's style, timeless, no PR numbers.
   - The two upgrade fragments under `upgrade-instructions/pending/`: `access-changes-rename` and `namespace-statements`. Read each as the app or extension author it is for.
3. **The PR text**, written to `wip/pr1-body.md` (gitignored) and reported in full. Title: `TML-3537: <one sentence in the form of the recent merged titles, see git log origin/main --oneline -10>`. Body, in this order: a grounding example (a schema diff and the command line with its output); the decision, led by what a user can now do; how it works, built up step by step (the operations, the working schema, the removed-namespace rule, `--delete <namespace>`, the access rename); what is deliberately out (enum values, value objects, variants: later PRs of this slice); the two upgrade fragments; alternatives considered last (a `moveNamespace` refusal kept; `createSchema` as a companion; refusing an undeclared schema; a different error code for an unused namespace delete). Then the line `Agent: radagast-20`, then `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. No ticket IDs other than the title's, no slice numbers, no review IDs. No hard-wrapped prose.
4. **Spec and plan:** update `spec.md`'s table rows and edge cases where the build changed a detail (the `public` finding, undeclared tables in a removed schema), and mark PR 1's dispatches done in `plan.md`.

## Do not

- Do not open the PR or push. The orchestrator runs `/drive-code-review` first.
- Do not start enum values, value objects or variants.

## Rules

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Only named files inside `test/integration` with `pnpm test <file>`; journeys with `pnpm test:journeys <file>`, each file its own argument.
- Use the shell's Node and `pnpm`. Never `npx`.
- No comments where the code can say it; no bare `as` casts in production code; no file extensions in imports.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines in commits. Stage files explicitly.
- Save slow command output under `wip/` and read the file.

## Done when

- Typecheck; lint and tests with coverage in every package touched since dispatch 1 (framework-components, cli, migration-tools, family-sql, target-postgres, adapter-postgres, target-sqlite, target-mongo, pgvector); `lint:deps`; `lint:framework-vocabulary`; `fixtures:check`; `check:error-reference`; `lint:throws`; `lint:casts`; `check:upgrade-coverage --mode pr --prev $(git merge-base HEAD origin/main) --head HEAD`; `pnpm lint:docs`.
- Inside `test/integration`, by name in groups of about 20, every file that runs `migration plan` or `db update`, including through `journey-test-helpers.ts`: list them with `git grep -l -e 'migration plan' -e 'db update' -e 'dbUpdate' -e 'migrationPlan' -- 'test/*.test.ts' 'test/**/*.test.ts'`, and every journey file under `test/cli-journeys/` with `pnpm test:journeys`.

## Report

Plain English, short sentences: which journey proves which spec row; what each doc now says that it did not; the full PR title and body; the gates with results; anything that did not hold; the commits.
