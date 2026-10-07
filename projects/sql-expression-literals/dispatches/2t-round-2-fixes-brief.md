# Brief: fix the slice 2t round 2 review findings (TML-3367)

You fix the findings of the second review of slice 2t, on branch `tml-3367-data-type-value` in the git worktree at the current directory. Read `dispatches/2t-implementer-brief.md` for the rules, `dispatches/2t-review-fixes-brief.md` for the round 1 decisions (which stand), then the two reviews in `projects/sql-expression-literals/slice-reviews/2t-round-2/`: `system-design-review.md` (B01 to B05) and `code-review.md` (G01 to G07). Do not read, write or run anything outside this worktree; no `/tmp`; scratch under `wip/`. Run node, pnpm and git through `mise exec --`.

## First

Merge the previous slice's branch into this one: `git merge --no-edit tml-3296-sql-expression-data-type`. It carries one new commit (`656249c3d9`) that changes three expectations in `test/integration/test/date-time-defaults/psl-date-time-defaults.integration.test.ts` to `PSL_INVALID_LITERAL`, which this branch already has, so the merge should be clean. If it conflicts, keep `PSL_INVALID_LITERAL`.

## Decisions

Fix every finding as its suggestion says, except where this list says otherwise. Decided; do not reopen.

- **B01 and G06 (the same item): the print path carries the pair too.** `SqlPslBuildContext`, `control-instance.ts` and `DefaultMappingOptions`/`mapDefault` in `default-mapping.ts` take `dataTypes: DataTypeSupport` (the pair) in place of their separate `dataTypeLookup` and `dataTypeEntries` fields. Remove `ControlStack.dataTypeLookup`; every reader uses `stack.dataTypes.lookup`. Update tests, the extension upgrade fragment (the removed field), and design section 11 if it names the fields.
- **B02:** add a family arm beside `no-list-cast` for an element the list cast does not take, worded by the family with the list cast's element types as the suggested forms, so the framework's `no-cast` refusal is never built by hand with a `casts` field that is not the type's casts. Rename `ReadDefaultResult.receivingTypes` to `suggestedTypes`. Prisma 7's wording for that case is then its own and true; test it (G04 covers the sibling case; add one for this arm too).
- **B03:** rename `describeRefusal`'s `forms` parameter to `guidance` and say in the doc comment that it is what follows `write ` in the message: the admitted forms, or a rewrite such as ``it as sql`8` ``.
- **B04: defer.** Correct the slice 2b "Carried over" entry in `plan.md` so it names `@default` as well as `dataTypeValue`, and cites manual QA case 4.
- **B05:** as suggested: ADR 254 line 179 in the future tense or removed, and line 181 says that a list cast is declared on the framework's `DataType` and that reading a written list through it is the family's job.
- **G01:** already fixed on the 2a branch by `656249c3d9`; the merge above brings it. Nothing else to do.
- **G02, G03, G04, G05:** as suggested. For G03, the extension fragment gets a `default-refusals-say-what-to-write` change mirroring the app fragment's, and line 157 no longer says the messages are unchanged.
- **G07:** `no-list-cast` is approved. Record the decision and its reason under finding A08 in `dispatches/2t-findings.md` (add an "A08" entry), so the file says why a third default-only kind exists.

If a decision turns out wrong against the code, stop and write why to `dispatches/2t-round-2-fixes-findings.md`.

## Rules, verify, commits

As in `2t-review-fixes-brief.md`: tests first (B01, B02, G02, G04), repository rules, no hard-wrapped Markdown. Logs under `wip/2t-round-2-fixes/`: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:casts`, `pnpm lint:throws`, `pnpm check:error-reference`, `pnpm lint:framework-vocabulary`, `pnpm fixtures:check`, `pnpm test:packages`, `pnpm check:upgrade-coverage --mode pr --prev "$(git merge-base origin/main HEAD)" --head HEAD` after committing; in `test/integration` only `pnpm test test/authoring test/number-defaults test/date-time-defaults` plus any file whose imports you changed. Never run the full integration or e2e suites. The three tarball tests fail on the known registry refusal; report, do not fix. Small commits, explicit `git add`, `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, no AI attribution, never amend or rebase, do not push, no pull request. Commit this brief first. Add a "Slice 2t review fixes, round 2" subsection to `status.md` and commit it. Report in plain English, short sentences: each finding and what you did, each verification result with its log path, anything you could not do.
