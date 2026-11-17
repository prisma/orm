# Dispatch 4: review fixes for dispatches 2 and 3

**Review to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr1/dispatch-2-3-review.md` (read all of it; it has proposed texts), probes in `wip/stored-name-renames/review-d23/` · **Spec:** `projects/migration-statements/slices/stored-name-renames/spec.md` · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-5072cc` · **Branch:** `tml-3839-stored-name-renames` (tip `3708731cc8` plus doc commits) · **Tier:** mid (Opus, medium effort)

Work only inside the worktree. Notes in `wip/stored-name-renames/out/d4-progress.md`. The rules of dispatch 1 (`dispatches/01-table-and-column-renames.md` § Rules) hold unchanged; read them.

Fix the class, not the instance: for each finding, look for the same defect everywhere in `git diff $(git merge-base HEAD origin/main) HEAD`.

1. **R10.** Every comparison of stored names in the rename planning uses the target's comparison (`sameName`), including the filter that decides whether a stored name changed at all and the lookups against the live database. On SQLite, `db update` after a case-only rename done by hand (`Users` to `users`, and a column the same way) plans no operation and never advises removing the model's own table. A table that exists live under a name that differs from the contract's only in case is treated as the target treats it. Tests against a live SQLite database, applied, rows read back.
2. **R11 and R12.** No refusal advises a route its reader cannot take. Rule for every refusal this slice added or changed, with or without a statement:
   - The first route offered works on both `migration plan` and `db update`. For a cycle or chain of stored names or stored values, that is two plans through a stored name or value nothing uses: change the contract so the objects take unused stored names or values, plan and apply; then change it to the final ones, plan and apply. Name the objects and give the example values, as the cycle refusal already computes them.
   - A hand-written migration may be offered second, for `migration plan` users, and only where it works (the command it starts from must write a `migration.ts`).
   - A statement refusal still says to leave out the statement when leaving it out gives a plan that can be answered, and never when leaving it out leads to another refusal.
   Go through each refusal text and follow it against the planner. Record in your notes, per refusal, the route and how you checked it.
3. **R13.** The `db update` "has both names" refusal also names the case where the old name was reused after a rename by hand, and says to rename or drop the reused object, not to move rows into it.
4. **R14.** `keepTableAdvice` does not tell two models that merge into one table to each rename their table into it. In a merge it says the storage of the models is being merged and that keeping the rows is a data migration.
5. **R15.** On `db update`, when a table was already renamed and a new model takes the old name, the constraint renames of the already-renamed table come before the create, so the new table's constraints get the names the destination expects and the next plan from the destination is empty. A test against live PostgreSQL plans twice and asserts the second plan is empty.
6. **R16.** Do not change behaviour. Add an entry to `projects/migration-statements/deferred.md`: a new enum member that takes the stored value of a member removed in the same change takes that member's rows with no question, because the planner keeps a removed member whose stored value the destination still stores; the same holds for a model removed and a new model added on the same table. It needs a decision: this is a rename with no statement, paired by storage. Say what the code does today, with file and lines.
7. **R17.** No test file touched by this pull request is over 500 lines: split by functionality. New tests assert the whole operation list or the whole conflict, not the first operation or `toContain`.

Also add to `deferred.md`: `stillStoredRefusal` for an enum value rename statement refuses a rename whose old stored value a new member takes, although the rows belong to the renamed member; a member that keeps its name is planned in that case, so statements are stricter than the contract change (`enum-value-planning.ts`, give lines).

## Not in this dispatch

CLI text in `packages/1-framework`, journeys, docs other than `deferred.md`. Journeys known to fail and owned by the next dispatch: `table-map-change` (both targets) M1.05 and M2.04; `rename-table-migration` R1.05; `rename-table-migration.sqlite` R3.05 and R4.04; `enum-value-statements` E9.04 and E10.04; `enum-value-statements.sqlite` S4, S7, S9, S10. If any other journey fails, list it.

## Done when

- `mise exec -- pnpm build` and `pnpm fixtures:check` are clean.
- Typecheck, lint and `pnpm test --coverage` pass in the SQL family package, the PostgreSQL and SQLite target packages and their adapter packages.
- `pnpm lint:deps` and `pnpm lint:ratchets` pass.
- `git diff --stat $(git merge-base HEAD origin/main) HEAD -- packages/1-framework` is empty.

## Report

Plain English, short: per finding, what changed and the test that was red first; the table of refusals with each route and how it was checked; commits; checks with results.
