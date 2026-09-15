# Dispatch 5: manual QA fixes

**Slice plan:** `projects/prisma7-contract-source/slices/03-contract-to-psl-and-convert/plan.md` (added after the QA run)
**Model tier:** Fable (implementer). **Time-box:** one session.

## Task

Resolve every finding in `projects/prisma7-contract-source/manual-qa-reports/2026-09-15-qa-runner-convert.md`, so that a user following only the README through the cutover sees output that agrees with itself and next actions that name real commands. Adjacent Prisma 8 defects are fixed here with a regression test each (project rule), not worked around.

## Scope

In, one commit per numbered item:

1. **F-3.** The `contract convert` source-load failure's next action names `contract convert`, not `contract emit`. The shared `resolveContractSource` must take the command name (or the caller supplies the next-action text); `contract emit`'s wording is unchanged. Test: the CLI unit test for the convert failure asserts the next action; the emit test still asserts its own.
2. **F-2.** Next-action lines that print a literal `{bin}` (`→ Apply the migration: {bin} db migrate`, `→ Check every space against the database: {bin} migration status`). Find where the `{bin}` token is meant to be substituted (grep `{bin}` across `packages/1-framework/3-tooling/cli` and `packages/1-framework/1-core/errors`), find why these two paths miss it, and fix the class, not the two instances (`.agents/rules/fix-the-class-not-the-instance.mdc`). Regression test: rendering one of those messages contains the resolved bin name and no `{bin}`.
3. **F-1.** `migration plan --name baseline` prints "Planned baseline + 0 operation(s)" and then a 13-operation create preview with an "apply it" hint. Determine whether the preview is the baseline's recorded schema (by design) or a real contradiction. If by design, the summary and hint must say so (the preview is what the baseline records; nothing to apply) and the test that covers baseline planning asserts the wording; if a defect, fix it with a regression test. Say which in the report, with the code path.
4. **F-6.** `db sign` prints `from: none` beside `(was <hash>)` when a marker existed. Find the two fields' sources; make them agree; regression test.
5. **F-7, F-8.** `contract emit --format human` ends with two bare absolute paths duplicating earlier lines; the `Overwriting existing file:` warning has no glyph or indent. Fix both in the human presentation with tests that render the output (`docs/CLI Style Guide.md` is the reference for the glyphs).
6. **F-4, F-5, F-9, README.** In the CLI README's `contract convert` section: state that `contract.json`/`contract.d.ts` are written beside the new `contract.prisma` (so app imports must move, or `--output` must keep the old location); list the spellings a converted file uses that a hand-written Prisma 8 file might not (`@@map` on every model, unique indexes as `@@index(unique: true, map:)`, junction models with `a`/`b` fields, explicit `onUpdate`, `temporal.timestamp(...)` for `@updatedAt`, `Timestamp(n)` for other precisions); name `migration ref list`; explain `<timestamp>_baseline` as the directory `migration plan` prints; state what `db sign` does to the `db` ref and why the guide's `migration ref set` step is still run (or, if it is a true no-op after `db sign`, say so plainly and tell the user they may skip it; check the code before writing either). Keep the phase 4 and 5 order.
7. **Re-run QA steps 4, 5, 6, and 8** yourself in `wip/qa-convert/` (the scratch app exists) and append a "Re-run after dispatch 5" section to the report with commands and outputs.

Out: anything not in the report. Any change to the printer's spellings.

## Completed when

- [ ] Each finding F-1 to F-9 has a line in the report's re-run section saying fixed (with the evidence) or documented (with the README anchor).
- [ ] Every fix has a test that fails on the old output.
- [ ] Package `test`, `typecheck`, `lint` for every touched package; `pnpm --filter integration-tests test cli-journeys/prisma7-source test/prisma7-source`; `pnpm --filter prisma7-adoption test`; `pnpm lint:docs`; `pnpm lint:framework-vocabulary` (count equals threshold); `pnpm lint:throws`; `pnpm lint:casts`; root typecheck; `pnpm check:error-reference`.

## Halt conditions

- A fix needs `@prisma/cli-engine` (external). Report the constraint and do the best the envelope allows.
- F-1 turns out to be migration-planner behaviour whose change would alter planning semantics. Report; do not change semantics.

## References

- The QA report; `docs/CLI Style Guide.md`; `.agents/rules/cli-error-handling.mdc`; `.agents/rules/fix-the-class-not-the-instance.mdc`; the migration and sign commands under `packages/1-framework/3-tooling/cli/src/orm/`.
- Rules, commits, heartbeat, return shape: as dispatch 1. Do not push.
