# Brief: fix the slice 2b review findings (TML-3288)

You fix the findings of the two reviews of slice 2b, on branch `tml-3288-sql-expression-places` in the git worktree at the current directory. Read `dispatches/2b-places-brief.md` and `2b-tooling-docs-brief.md` for the rules and the design references, then the two reviews in `projects/sql-expression-literals/slice-reviews/2b/`: `system-design-review.md` (A01 to A17) and `code-review.md` (F01 to F08). Each finding has a location, the issue and a suggestion. No `/tmp`; scratch under `wip/`. Run node, pnpm and git through `mise exec --`.

## Decisions

Fix every finding as its suggestion says, except where this list says otherwise. Decided; do not reopen.

- **A03: the infer skip is narrowed and its note warns.** Only an exact-named object (one with `map:`, whose text the database compares byte for byte) is skipped when its SQL would not read back unchanged. A wire-named object is always printed with its canonical text: it is compared by name, and `normalizeSqlBody` gives the same name for the canonical text, so nothing changes for it (add a test that proves the name is equal for a non-canonical body and its canonical form; the wire-names test may already cover it). The skip note becomes: `// prisma: skipped <kind> "<name>": its SQL cannot be written as a sql literal that reads back unchanged. It is not in this schema; add it by hand before running migration plan, or the plan will drop it.` Pin the note text and the fact that the object is absent from the emitted contract in a test. Update design section 11.2, ADR 260, the app fragment and the error reference where they describe the skip.
- **A01:** `printSqlExpressionLiteral` throws an internal error for text that does not read back; one shared predicate replaces the three copies (this also closes F07). Skip in infer and refuse in print stay where they are and call the same predicate.
- **A02:** one tag-agnostic read-back function next to `printTaggedLiteral` in the framework, exported once from `/authoring`; remove the `/control` export of `canonicalizeTaggedLiteralBody` if `/authoring` has it, and update importers.
- **A04, A05, A06, A17:** as suggested; ADR text is end state only.
- **A07:** as suggested.
- **A08, A09:** give the `@default` argument value types a `kind` discriminant and stop detecting them by property presence; rename `ParsedWrittenScalar` so it does not read as a `Result`, or drop its `ok` field, whichever the suggestion prefers; update design section 10 if it names the type.
- **A10:** the interpreter passes the spec context to every SQL attribute spec factory, and ADR 249 is true.
- **A11:** one helper builds a `BlockSpecContext`; the six sites call it.
- **A12:** invert the guard test as suggested.
- **A13: defer to slice 3.** Add one line to the slice 3 "Carried over" list in `plan.md`.
- **A14, A15, A16:** as suggested. For A15, a test asserts that both fragment copies are byte-identical to `scripts/codemods/rewrite-sql-strings.mjs` and that the codemod's output for a sample of texts equals `printSqlExpressionLiteral`.
- **F02 (the codemod skips or rewrites comments wrongly):** fix both inner scans to skip `//` and `///` comments and string contents correctly; add the tests the review names, including a multi-line text and an apostrophe in a comment; copy the fixed script into both fragments (A15's test then guards the copies). Rerun the codemod against `examples/supabase` and the Supabase pack contract at the merge base and confirm the committed result is unchanged.
- **F03:** correct the supersedes note to the PSL `@@index(expression: "...")` at line 79 of `postgres-full-text-search/app`.
- **F04:** write the planner test: a contract whose only change is a stored text becoming canonical. If the plan has no operations, keep the wording and the test pins it; if it has operations, say in both fragments and ADR 260 what the plan really does, with the test pinning that.
- **F05, F06:** as suggested.
- **F08: nothing to do in code.** The hook change rode into commit `0e83ea5e3f` because it was staged when that commit was made; history is not rewritten. The PR description will say so.
- **F01:** your verification below covers it.

If a decision above turns out to be wrong against the code, stop and write the reason to `dispatches/2b-review-fixes-findings.md`. Do not decide it yourself.

## Rules, verify, commits

Tests first where a finding adds or changes behaviour (A01, A03, A08, A09, A12, A15, F02, F04, F06). Repository rules as in the earlier briefs; Markdown prose never hard-wrapped; ADR prose per `adr-writing.mdc`. Logs under `wip/2b-review-fixes/`, each once: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:casts`, `pnpm lint:throws`, `pnpm check:error-reference`, `pnpm lint:framework-vocabulary`, `pnpm lint:skills`, `pnpm fixtures:check`, `pnpm test:packages`, `pnpm test:scripts`, `pnpm check:upgrade-coverage --mode pr --prev "$(git merge-base origin/main HEAD)" --head HEAD` after committing; in `test/integration` only `pnpm test test/cli-journeys/sql-expression-literals.e2e.test.ts test/authoring test/psl-print test/cli-journeys/infer-roundtrip-fidelity test/cli-journeys/sign-the-database.e2e.test.ts` plus any file whose imports or fixtures you change; and `pnpm test` in `packages/3-extensions/supabase`. Never the full integration or e2e suites. Known local failures: the three tarball tests. Small commits, one per finding or small group, explicit `git add`, `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, no AI attribution, never amend or rebase, do not push, no pull request. Commit this brief first. Add a "Slice 2b review fixes" subsection to `status.md` and commit it. Report in plain English, short sentences: each finding and what you did, the F04 outcome, each verification result with its log path, anything you could not do.
