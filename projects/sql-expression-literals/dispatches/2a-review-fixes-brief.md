# Brief: fix the slice 2a review findings (TML-3296)

You fix the findings of the two reviews of slice 2a. You work in the git worktree at the current directory, on branch `tml-3296-sql-expression-data-type`. Do not read, write or run anything outside this worktree. Do not use `/tmp`; use the gitignored `wip/` folder for scratch files.

## Read first

1. `CLAUDE.md` at the worktree root and `.agents/rules/README.md`.
2. `projects/sql-expression-literals/status.md`.
3. The two reviews: `projects/sql-expression-literals/reviews/slice-2a/system-design-review.md` (findings A01 to A14) and `code-review.md` next to it (findings F01 to F09). Each finding has a location, the issue and a suggestion.
4. `projects/sql-expression-literals/design.md` sections 1, 2, 3, 10, 10.1, 11.1, 13, 19 and 20, which you update where a decision below changes them.

## Decisions

Fix every finding as its suggestion says, except where this list says otherwise. These are decided; do not reopen them.

- **A01: the family registers `sql/expression`.** Add `dataTypes: [sqlExpressionDataType]` and `authoring.dataTypes: { [SQL_EXPRESSION_DATA_TYPE_ID]: sqlExpressionAuthoringEntry }` to the SQL family's control descriptor (`packages/2-sql/9-family/src/core/control-descriptor.ts`), and remove them from both targets' lists. First confirm that every production path that assembles data types (the control stack, the PSL interpreter, the Prisma 7 reader, the language server's `pipelineInputsFromStack`, `contract infer`) includes the family descriptor's contributions. If one does not, stop and report it. Tests that build contributions by hand from a target's lists add the family's type and entry. Update ADR 254 (a family registers only a type that is the same on every target and that nothing casts from; `sql/expression` is the only one), the target file headers, `framework-authoring.ts` comments, the upgrade fragments (third-party targets no longer append anything; remove that instruction), and design sections 1, 2, 3 and 18.3.
- **A02:** add the assembled-stack test per SQL target, with `toBe` on the registered declaration and entry and the check that no registered type names `sql/expression` in `casts` or `listCast.of`. Include the extension packs the repository ships where the test can assemble them.
- **F03: make "nothing casts from `sql/expression`" a check in code.** Put a function in `@internal/sql-contract/sql-expression` that takes the registered data types and throws when any names `sql/expression` in `casts` or `listCast.of`, naming the type and the rule. Call it once where the SQL family sees the assembled stack's data types; prefer the family instance's creation if it receives them, otherwise every place that builds a `DataTypeSupport` for SQL (`contract-psl/src/interpreter.ts`, `contract-prisma7/src/interpreter.ts`). Use the error kind that `enforceDataTypeInvariants` in `control-stack.ts` uses for pack bugs. Test that a stack with such a cast fails.
- **A04 and F06:** delete the `SQL_EXPRESSION_DATA_TYPE_ID` skip in `writingSurface`. No codec has the data type `sql/expression`, so no column does, and the cast rule already excludes the entry. Rename the test "prints text on a text column as a string, never as a sql literal" to say what it checks ("prints a text default on a text column as a string"). Do not add F06's suggested test.
- **A05:** rename `PSL_DEFAULT_TYPE_INCOMPATIBLE` to `PSL_DEFAULT_LIST_EXPECTED`. Update the code, tests, `error-reference.md`, ADR 254, the upgrade fragments' code table, the manual QA script, and design section 10.1.
- **A07:** state the rule for unprefixed tags once, in ADR 254: a tag is unprefixed when the owner of its data type is the family or a target; every other owner prefixes its tags. Link to it from ADR 129 and make the ADR index row agree. In ADR 129, replace every sentence that says a tag names the pack that owns the text with "the tag names the data type of the text", and change the H1 to "Tagged literals write values of data types" (keep the file name). For line 89, say that in TypeScript the `sql` tag runs the same checks; do not mention slices.
- **A08:** in ADR 129 and `error-reference.md`, the body is what is written between the quotes and the text is the canonical value. Do not rename `TaggedLiteralCanonicalization.body` in this slice; the plan records it for slice 2t.
- **A09:** correct ADR 254: `@default` reports these codes at the `@default` attribute. The plan records the move to the written value for slice 2t.
- **A14:** point the `sqlExpressionDataType` doc comment at ADR 254. Remove `sqlTextReadsBack` and its tests from this slice (slice 2b adds them; the plan and design section 2 must say so). Remove the two unused `authoring` exports.
- **F01:** use the reviewer's detection pattern in both fragments and in design section 20: `'(?<![\w./-])(pg|sqlite)\s*\.\s*sql\s*\\?[\x60"'']'`. Test it against the reviewer's table of cases, as `skills-contrib/record-upgrade-instructions/SKILL.md` requires.
- **F02:** fix both fragments as suggested, including the A05 rename row and the `sql`-in-a-list row.
- Every other finding (A03, A06, A10, A11, A12, A13, F04, F05, F07, F08, F09): as its suggestion says.

If a decision above turns out to be wrong against the code, stop and write the reason to `projects/sql-expression-literals/dispatches/2a-review-fixes-findings.md`. Do not decide it yourself.

## Rules

- Tests first where a finding adds or changes behaviour.
- Repository rules: `pnpm` only, never `npx`, never `vitest` directly (use `pnpm test <path>` in the package); no `any`; no bare `as` in production code; no file extensions in imports; no comments unless the code cannot say it; no re-exports outside `exports/`; test names omit "should".
- Update the manual QA script in `projects/sql-expression-literals/manual-qa.md` for changed diagnostics and record a new run.

## Verify

Run every command in `plan.md` "Done conditions for every slice". Save each output under `wip/v2/` once and read the file. Run `pnpm lint:throws` and `pnpm check:upgrade-coverage --mode pr --prev "$(git merge-base origin/main HEAD)" --head HEAD`. The publish-shell and packaging tarball tests fail on this machine because `pnpm install` refuses `@vercel/detect-agent@1.2.5`; report them but do not try to fix that. Rerun any other failing test file alone once; report it as a failure if it fails again.

## Commits

- One commit per finding or per small group of related findings, with explicit `git add <paths>`.
- `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution in any commit: no `Co-Authored-By` line and no "Generated with" line.
- Never amend, squash, rebase or force-push. Do not push. Do not open a pull request.

## When you finish or stop

Update the "Slice 2a review" section of `status.md` (what was fixed, verification results) and commit it. Report in plain English, in short sentences: each finding and what you did; each design change; each verification result with its log path; anything you could not do.
