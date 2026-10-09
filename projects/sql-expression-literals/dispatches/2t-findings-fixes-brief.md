# Brief: resolve the slice 2t findings (TML-3367)

You continue slice 2t on branch `tml-3367-data-type-value` in the git worktree at the current directory. Read `projects/sql-expression-literals/dispatches/2t-implementer-brief.md` for the rules, then `dispatches/2t-findings.md`. The two findings are decided as follows. Do not reopen them. Do not read, write or run anything outside this worktree; no `/tmp`; scratch under `wip/`. Run node, pnpm and git through `mise exec --`.

## Decision 1: the framework reader reports an unknown tag (option A)

Delete the tag check from `readTaggedLiteral` in `contract-psl/src/psl-column-resolution.ts`, so it only canonicalizes. An unknown tag reaches `lowerDataTypeDefault` through `readWrittenValue`, and its `unknown-tag` arm reports `PSL_UNKNOWN_LITERAL_TAG` at the written value with the same message as today. If nothing but canonicalization is left in `readTaggedLiteral`, fold it into its callers and remove the name. Tests: the existing unknown-tag tests in `contract-psl/test/interpreter.defaults.tagged-literal.test.ts` and `interpreter.defaults.data-types.test.ts` keep passing with the same code, message and span; add a case where the unknown tag is a list element, reported at that element. Correct design.md section 4 and 10 where they describe the pre-check.

## Decision 2: `oneOf` keeps the diagnostics of the function the author named

In `psl-parser/src/attribute-spec/combinators/one-of.ts`: when the argument is a function call whose callee is a plain identifier, and exactly one alternative is a `funcCall` whose `name` equals that identifier, `oneOf` returns that alternative's result unchanged, success or failure. In every other case its behaviour is unchanged. Reason: the author named the function, so the diagnostics are about its arguments; `Expected one of` would hide them. Write this rule in the `oneOf` doc comment in one sentence and in design.md section 6 (replace the sentence that says `dataTypeValue` must not be an arm of `oneOf` with the rule, and keep the requirement that it is used inside a `funcCall`). Update ADR 231's `oneOf` paragraph if it describes the old behaviour.

Tests first, in `psl-parser/test/attribute-spec-combinators.data-type-value.test.ts` or the existing `oneOf` test file: a `oneOf(funcCall('nanoid', { positional: [dataTypeValue('pg/int4', support)] }), str())` given `nanoid("8")` reports `PSL_VALUE_TYPE_INCOMPATIBLE` with the `pg/int4 has no cast from …` message at the span of `"8"`; given `other(1)` still reports `Expected one of: …`; given `nanoid(8)` returns the typed value; two `funcCall` alternatives with the same name fall back to `Expected one of`. Then run every psl-parser, contract-psl and Mongo contract-psl test and fix any `@default` test whose expected message changed from `Expected one of` to the function's own diagnostic; each such change is an improvement, keep the new message and assert the whole diagnostic.

This changes user-visible messages for a `@default` function call with wrong arguments. Add a row to the slice 2t app upgrade fragment under `upgrade-instructions/pending/arguments-typed-by-data-type/app/instructions.md` (with a detection pattern only if one is possible; otherwise say the change needs no code change), add a case to the slice 2t manual QA script in `manual-qa.md`, rerun the script and record the run.

## Verify

As the implementer brief says, with logs under `wip/2t-fixes/`: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:casts`, `pnpm lint:throws`, `pnpm check:error-reference`, `pnpm lint:framework-vocabulary`, `pnpm fixtures:check`, `pnpm test:packages`, `pnpm check:upgrade-coverage --mode pr --prev "$(git merge-base origin/main HEAD)" --head HEAD`; in `test/integration` only `pnpm test test/authoring test/number-defaults`. Never run the full integration or e2e suites. The three tarball tests fail on the known registry refusal; report, do not fix. Rerun any other failing file alone once.

## Commits and report

Small commits, explicit `git add`, `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, no AI attribution, never amend or rebase, do not push, no pull request. Update `dispatches/2t-findings.md` with the decision and outcome under each finding, and the "Slice 2t" section of `status.md`. Report in plain English: what changed for each decision, which existing test messages changed, and each verification result with its log path.
