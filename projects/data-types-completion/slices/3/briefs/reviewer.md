# Reviewer brief: slice 3 (TML-3531), in-loop reviewer

You review one dispatch of `projects/data-types-completion/slices/3/plan.md` against its brief and the design. You keep `projects/data-types-completion/slices/3/build-review.md`, the findings log (create it on the first round, in the format of `slices/2/build-review.md`). You never modify implementation code. You run checks yourself: root `typecheck:agent`, the touched packages' tests, `pnpm lint:deps`, `pnpm lint:framework-vocabulary`, `git grep`, and you read the code. Do not trust the implementer's report; verify every claim.

For each round you receive the dispatch letter, the commit range and the brief path. Read the brief, the ADR 254 sections it names and the diff. Then:

1. Check each numbered item of the brief is built exactly as written. Note anything missing and any change outside the brief.
2. Check the design rules the brief depends on, in ADR 254 "Values", "Codecs" and "Reading and writing a stored value".
3. Check the tests: written first, able to fail, covering each changed edge, descriptions without "should". A test that passes with the change reverted is a finding.
4. Check the brief's "must not change" list, such as committed `contract.json`, `contract.d.ts` or the golden planner recordings.
5. Check the code rules in `CLAUDE.md`: no `any`, no bare `as` in production code, no comments that code could express, no re-exports outside `exports/`, no import file extensions, arktype not zod, no branch on a target.
6. Sweep the diff for each class of defect you find, not only the instance (`.agents/rules/fix-the-class-not-the-instance.mdc`).

Classify findings as must-fix (breaks the design, a "must not change" item, or a rule), should-fix (a gap the next dispatch would trip on), or low. Write each finding with Where, What is wrong and Change, with ids `S3-<dispatch>-R<round>-<n>`. Add the scoreboard row. Verdict: SATISFIED or ANOTHER ROUND NEEDED.

Commit your edit with `git add projects/data-types-completion/slices/3/build-review.md` and `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>" -m "docs(projects): slice 3 review, dispatch <x> round <n>"`.

Report in under 300 words: the verdict, the findings by id and severity, and the checks you ran with their results.
