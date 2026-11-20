# Dispatch 6: the ADR, the docs and the upgrade notes

**Slice plan:** `projects/migration-statements/slices/stored-name-renames/plan-pr1.md`, row 5 · **Spec:** `projects/migration-statements/slices/stored-name-renames/spec.md` (read all of it first) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-5072cc` · **Branch:** `tml-3839-stored-name-renames` (tip `d39671a5e1`) · **Tier:** mid (Opus, medium effort)

Work only inside the worktree. Notes in `wip/stored-name-renames/out/d6-progress.md`. The rules of dispatch 1 (`dispatches/01-table-and-column-renames.md` § Rules) hold. This dispatch changes documents and comments only: no source behaviour, no tests. A reviewer and another implementer may be working on source and journey files at the same time, so touch only the files named here; if another file needs a change, list it in your report.

## Inputs

- The spec, all of it; most of all "Architecture record", "Upgrade notes the fragments must carry", "Where the rule does not apply", "Refused in this slice", "`db update` and a database that does not match the origin".
- The code as built: `packages/2-sql-family/9-family/src/core/migrations/storage-renames.ts`, `statement-planning.ts`, `enum-value-planning.ts`, `operation-subjects.ts`. **Document what the code does, not what the spec planned**; where they differ, the code wins and you list the difference in your report.
- `wip/stored-name-renames/code-map.md` section 8 "Docs" and "Upgrade instructions": the lines that describe the old behaviour. It is a lead; line numbers have moved.
- The skills `write-architecture-docs`, `record-upgrade-instructions` (`skills-contrib/`), and the rules `.agents/rules/adr-writing.mdc`, `adr-examples-must-match-code.mdc`, `prefer-psl-in-design-docs.mdc`, `no-transient-project-ids-in-code.mdc`, `doc-maintenance.mdc`.
- ADR 264, ADR 188, ADR 224, and two recent ADRs for the house form.

## Scope of this pull request

It changes PostgreSQL and SQLite only. MongoDB changes in the next pull request and MySQL plans no rename. Every document must be true at the end of this pull request: say what PostgreSQL and SQLite do now, and leave the MongoDB and MySQL paragraphs describing what those targets do today. The ADR is the exception: it records the decision for both families and says plainly which targets have it built.

## Outcome

1. **A new ADR, number 324, "The same coordinate is the same object"**, under `docs/architecture docs/adrs/`, added to `ADR-INDEX.md`. Before writing, check that 324 is still free on `origin/main` (`git ls-tree origin/main "docs/architecture docs/adrs/"`) and report if it is not. It opens with a concrete example (a PSL `@@map` change and the plan it gives), states the decision, then covers: what a coordinate is for a model, a field and an enum member; the pairing order; storage is renamed only when all of it moves; what the pair plans, and the order of operations; the one check over all renames and each refusal; `db update` against a database that does not match the origin (the four rows); where the rule does not apply (no origin contract, storage not `managed` on both sides, MySQL, a native PostgreSQL enum type's `@@map`, discriminator values, namespace moves); why (the contract is where the user states intent, the contracts hold the whole answer, a rename keeps data); alternatives last (a statement that names storage, with the `storage/` prefix form; a declaration in the schema such as `renamed_from`; keeping the question). No project, slice, review or ticket identifiers. Examples must be real PSL and real CLI output; take the output from the journeys under `test/integration/test/cli-journeys/`.
2. **ADR 264** gets dated update notes, not a rewrite, at the three places the spec names.
3. **`docs/architecture docs/subsystems/7. Migration System.md`**: the paragraphs on `keepDataAdvice` for a `@@map` change, enum members that keep their names on SQL, the case check, and "Rename limits in this release" are rewritten to the end state for the SQL targets.
4. **`docs/reference/error-reference.md`**: `MIGRATION.STATEMENT_INVALID` text about `@map`, `MIGRATION.TABLE_NAME_CASE_CHANGED` (now reached only without an origin contract), and `MIGRATION.PLANNING_FAILED` if it lists causes. Run `pnpm check:error-reference`.
5. **`skills/prisma-8/references/migrations.md`** and **`packages/1-framework/3-tooling/cli/README.md`** (statements paragraph): the rule, in user words, with the refusals and the two-plan route.
6. **Project files** under `projects/migration-statements/`: `design-notes.md` first principle reworded as the spec says; `storage-naming.md` checked against the code; `deferred.md` entries the change makes stale are struck or corrected, and the entry for `KeepDataEdit.swapsValues` added if absent; `plan.md` rows for this slice; `manual-qa.md` lines that describe the old behaviour.
7. **The upgrade fragment** under `upgrade-instructions/pending/<name>/app/instructions.md` (and `extension/` if the skill says one is needed), carrying the spec's five notes, each with a before and after a user can act on. Check `upgrade-instructions/pending/mongo-rewrites-inside-documents/app/instructions.md` for lines this change makes false for SQL. Do not edit anything under `upgrade-instructions/releases/`.
8. **Stale comments**: the two PostgreSQL planner comments about `db update` passing `fromContract: null` (`packages/3-targets/postgres/1-target/src/core/migrations/planner.ts`), if still there. Correct or delete; do not add new comments.
9. **Sweep.** Search the repository (outside `upgrade-instructions/releases/`, `wip/`, and `projects/**/reviews/`) for text that still says a stored-name or stored-value change on PostgreSQL or SQLite is a drop and a create, needs a statement, or must be done by hand. Fix each in the files above; list any other file.

## Done when

- `mise exec -- pnpm lint:docs`, `pnpm check:error-reference`, `pnpm check:upgrade-coverage --prev $(git merge-base HEAD origin/main)`, `pnpm lint:rules:symlinks` pass, and `pnpm lint` passes in any package whose file you touched.
- No Markdown paragraph you wrote or edited is hard-wrapped.
- Read each document you changed from the top as a teammate with no context: one name per thing, the code's names, no coined terms. "Coordinate" is used as the spec's Terms section defines it and is defined where first used.

## Report

Plain English, short: each file changed and what it now says; where the code differs from the spec; files outside the list that need a change; the commits; the checks with results.
