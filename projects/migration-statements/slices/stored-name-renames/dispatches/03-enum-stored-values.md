# Dispatch 3: enum stored values

**Slice plan:** `projects/migration-statements/slices/stored-name-renames/plan-pr1.md`, row 3 · **Spec:** `projects/migration-statements/slices/stored-name-renames/spec.md` (read all of it; for this dispatch: the enum rows of "The rule" and "Refused in this slice", "Freed and reused", "Text and code that goes away or changes") · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-5072cc` · **Branch:** `tml-3839-stored-name-renames` (tip `f8383611bd` plus doc commits) · **Tier:** mid (Opus, medium effort)

Work only inside the worktree. Notes in `wip/stored-name-renames/out/d3-progress.md`. The rules of dispatch 1 (`dispatches/01-table-and-column-renames.md` § Rules) hold unchanged; read them.

## Inputs

- `wip/stored-name-renames/code-map.md` sections 1(c), 2 (last paragraphs), 4 (SQL enum rows): `valueChanges`, `orderChanges`, `keptData`, `temporaryValue`, `planEnumValueRewrites`, `stillStoredRefusal`, `mergingRefusal`, `cycleRefusal` in `packages/2-sql-family/9-family/src/core/migrations/enum-value-planning.ts`, and `stored-value-calls.ts`.
- Design review findings P06 and P03 in `projects/migration-statements/slices/stored-name-renames/reviews/design/principal-engineer-review.md`.
- How dispatch 1 builds a refusal with or without a statement: `renameRefused` in `storage-renames.ts`. Follow the same shape.

## Outcome

On PostgreSQL and SQLite, for `migration plan` and `db update`, an enum member with the same name in the origin and destination enum whose stored value changed has its stored value replaced in every column the enum types, with no question, **such that rows are rewritten only for a member the two contracts both name, and no member's rows are merged into another's or overwritten before they are read**.

1. A changed stored value of a member that keeps its name plans `replaceStoredValue`, exactly as an enum value rename statement for that member plans it today, in the order the existing code computes. A chain (`B` from `"b"` to `"c"`, `A` from `"a"` to `"b"`) is planned in that order.
2. A value freed by a member and taken by a new member (`A` from `"a"` to `"b"`, new member `C = "a"`) is planned: `A`'s rows are rewritten and `C` starts with none. The statement-only check that refuses when the destination still stores the old value does not apply to a member that keeps its name. Keep it for statements unless you can show it is wrong there too; if you think it is, say so in the report and do not change it.
3. Refused, with a conflict of kind `unsupportedOperation`, no `refusedStatement`, and text that names the enum, the members and the stored values and never says "statement":
   - a cycle (`A = "a"`, `B = "b"` become `A = "b"`, `B = "a"`), with the by-hand route a cycle of statements is given today, written so that every step can be followed (the route must start from a command that writes a `migration.ts`; check with `handWrittenMigrationAdvice` and dispatch 2's fix of the same class);
   - a member taking the stored value of a member the destination removes, or of a member that keeps it (a merge).
   A cycle or merge that involves a statement keeps today's statement refusal.
4. No `KeepDataEdit`, `keepData` or `swapsValues` is produced for a member that keeps its name, because that change is never asked about now. Remove the code in the SQL family that only served that, with its tests. Do not change `packages/1-framework`: the framework type `KeepDataEdit.swapsValues` and the CLI advice code stay as they are, even if nothing sets them now. List in the report what in `packages/1-framework` is now unreachable from the SQL family, with file and lines.
5. Everything an enum value rename statement handles today works the same for a member that keeps its name: a nullable column, a column default equal to the old stored value, the check constraint that lists the values, an array column of the enum on PostgreSQL, an enum used inside a value object, numeric stored values, a native PostgreSQL enum (member change refused as today, ADR 286). Add a test for each that the statement path has a test for, and say which had none.
6. With no origin contract, nothing is planned for enum values, as today.

## Not in this dispatch

CLI text in `packages/1-framework`, journeys, docs. If a journey fails because of your change, list it with the failure; do not rewrite it. Journeys already known to fail and owned by dispatch 4: `table-map-change` (both targets) M1.05 and M2.04, `rename-table-migration` R1.05, `rename-table-migration.sqlite` R3.05 and R4.04.

## Done when

- `mise exec -- pnpm build` and `pnpm fixtures:check` are clean.
- Typecheck, lint and `pnpm test --coverage` pass in the SQL family package, the PostgreSQL and SQLite target packages and their adapter packages (the adapter packages hold `stored-value-planning.integration.test.ts`, which runs the rewrites against a database; extend it so the replaced values are read back).
- `pnpm lint:deps` and `pnpm lint:ratchets` pass.
- The enum journeys are run by name (`enum-value-statements.e2e`, `.sqlite.e2e`) and every failure is listed with its cause.
- `git diff --stat $(git merge-base HEAD origin/main) HEAD -- packages/1-framework` is empty.

## Report

Plain English, short: what is now true; the tests that were red first; each refusal's text; what in `packages/1-framework` is now unreachable; journeys that fail and why; anything the spec got wrong; commits; checks run with results.
