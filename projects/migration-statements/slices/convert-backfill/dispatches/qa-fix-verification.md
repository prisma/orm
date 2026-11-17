# Verify the QA fix round — slice 3a (TML-3477)

You are the reviewer for slice 3a. Work only in `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/tml-3474-handover-fb4cb3/wip/wt-3a`, branch `tml-3477-convert-backfill`. Do not commit; do not push.

## Read first

- Spec: `projects/migration-statements/slices/convert-backfill/spec.md`
- QA report: `projects/migration-statements/manual-qa-reports/2026-10-12-qa-slice-3a.md` (findings F1–F16)
- The fix commits: `git log b6932d58d5..HEAD` (17 commits).

## Scope

F5 and F11 are deferred. F2 goes to TML-3562 (SQLite Decimal shares the text codec). Every other finding has a fix commit.

## What to check

1. For each of F1, F3, F4, F6, F7, F8, F9, F10, F12, F13, F14, F15, F16: does the fix commit resolve what the report describes? Reproduce with the built CLI (`mise exec -- pnpm build`, then scratch projects under `wip/qa-3a-verify/`, PGlite and SQLite) where the finding is about printed output. Follow every printed advice to its end state (an applied migration, or a database unchanged with a clear message).
2. Fix the class, not the instance: for each fix, look for other places in the diff with the same defect.
3. F14 changed which type changes are asked about. Check the widening list is right on both targets: a change it plans without asking must keep every value. Try at least `Int`→`String`, `Int`→`BigInt`, `BigInt`→`Int`, `Float`→`Int`, `String`→`Int`, `Boolean`→`String`, `DateTime`→`String` on both.
4. **SQLite index-order regression check (F07 blast radius).** For every pair of the repository's SQLite contract fixtures, plan with no statements on this branch and on `19bbe0e986` (main before this slice). Output must be identical except where a change is caused by this slice's intended behaviour; list each difference and its cause. Steps 3 and 4 of the earlier blast-radius run must be byte-identical.
5. Run the package tests of every package the fix commits touch (`mise exec -- pnpm --filter <pkg> test`), `mise exec -- pnpm typecheck`, `pnpm lint:deps`, `pnpm lint:throws`, `pnpm lint:casts`, `pnpm fixtures:check`, `pnpm check:error-reference`. Save output to files under `wip/` and read the files.

Never run `pnpm test:integration`, `test:e2e` or `test:all`. Run only named integration or e2e files, as `pnpm test <file>` inside the package. Run node and pnpm through `mise exec --`. Never write to `/tmp`. Stop every server you start, by PID.

## Report

Write `projects/migration-statements/slices/convert-backfill/reviews/qa-fix-verification.md`: a table with one row per finding (resolved / not resolved / new defect), then each problem with the exact command and output. End with a verdict: ready for the PR, or the list of what must change. Keep it short and in plain English.
