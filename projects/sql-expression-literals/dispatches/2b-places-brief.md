# Brief: slice 2b, dispatches (a) and (b): the six places take `sql` literals (TML-3288)

You implement the first two dispatches of slice 2b of the project "SQL expression literals". You work in the git worktree at the current directory, on branch `tml-3288-sql-expression-places`, which starts from the tip of slice 2t's branch (`tml-3367-data-type-value`, pull request #30539). Do not read, write or run anything outside this worktree. Do not use `/tmp`; use the gitignored `wip/` folder for scratch files. Run node, pnpm and git through `mise exec --`.

## Read first

1. `CLAUDE.md` at the worktree root and `.agents/rules/README.md`, then the rules it lists under Testing and TypeScript & Typing.
2. `projects/sql-expression-literals/status.md`, then `plan.md` sections "Done conditions for every slice" and "Slice 2b" (its Tests list and both "Carried over" lists), then `spec.md`.
3. `design.md` sections 1, 6 (what `dataTypeValue` gives you), 8, 9, 11.1, 11.2, 13, 18.1, 18.3 (the 2b items) and 20 (the 2b row and the codemod paragraph, for what dispatch (d) will need from your artefact changes). Section 12 (language server) and the docs and ADR rows of section 19 are dispatches (c) and (d), not yours, except where a test you must keep green needs a one-line update.
4. `research/rebase-delta.md` sections 8, 9, 11 and 17, and `research/artefacts-docs.md` §1.4: the current locations and the list of inline PSL bodies to update.
5. `packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/data-type-value.ts` and `test/attribute-spec-combinators.data-type-value.test.ts`, so you know the exact diagnostics `dataTypeValue` produces.

## What the design got wrong against `main`

Apply these and correct design.md where it names the old location.

- The `contract infer` printers for `@@index` and `@@check` live in `packages/3-targets/3-targets/postgres/src/core/psl-build/index-attributes.ts` (`buildIndexAttribute` about line 84 and 90, `buildCheckAttribute` about line 132), not in `psl-infer/infer-index-attributes.ts`. `infer-policy-blocks.ts` and `infer-model-blocks.ts` are under `psl-infer/` as the design says.
- Policy blocks are `structBlock` specs (`packages/3-targets/3-targets/postgres/src/core/authoring.ts` about lines 160 to 205), as design section 9 already notes.
- `BlockSpecContext` is `{ symbols, block }` in `psl-parser/src/block-spec/types.ts`; `interpretExtensionBlocks` is in `psl-parser/src/block-spec/interpret.ts` about line 309 and is called from the SQL interpreter (about line 2118) and the Mongo interpreter (about line 1193).
- `AttributeSpecContext.dataTypes` and `EMPTY_DATA_TYPES` already exist (slice 2t). `ControlStack.dataTypes` and `ContractSourceContext.dataTypes` hold the pair; there is no `dataTypeLookup` field any more.

If you find another difference in behaviour or in a type the design depends on, stop and write it to `projects/sql-expression-literals/dispatches/2b-findings.md` with your recommendation. A file or function that merely moved: correct the design and continue.

## What you build

Follow the design exactly; you have no design freedom over names, signatures or messages.

1. **Dispatch (a), section 9.1.** `BlockSpecContext` gains `readonly dataTypes: DataTypeSupport`; `interpretExtensionBlocks` takes a required `dataTypes` and passes it into every context it builds; the SQL and Mongo interpreters pass theirs; the language server's block attribute and block key completion contexts set `dataTypes: source.dataTypes ?? EMPTY_DATA_TYPES`. Every other production and test caller passes the stack's data types (`rebase-delta.md` Part B.2 lists them). Test (plan): a block spec that reads `ctx.dataTypes` receives the stack's data types from each production path: the SQL provider, the SQL interpreter, the Mongo provider (this closes the carried-over Mongo item) and the language server.
2. **Dispatch (b), sections 8, 9.2, 9.3 and 11.2.** `indexModelSpec`, `checkModelSpec` and `postgresFullTextIndexSpec` become functions of the context with `dataTypeValue(SQL_EXPRESSION_DATA_TYPE_ID, ctx.dataTypes)`; the policy predicate parameters become functions of the block context; the interpreter builds one context per model and reads the canonical text with `sqlTextFromCanonical`; `lowerRlsPolicyFromBlock` likewise. The guard test of section 8.3. Printers: `printSqlExpressionLiteral` in `psl-build/index-attributes.ts` and `infer-policy-blocks.ts`; the read-back skip with `sqlTextReadsBack` (move it here from the design's slice 2a text, with `canonicalizeTaggedLiteralBody` exported from the framework's `authoring` entry, and the tests the plan's first "Carried over" list names) and the skip notes of section 11.2. The `sql-expression-wire-names.test.ts` of the plan. Amend ADR 255 as section 9.3 says (one paragraph; the rest of the ADR work is dispatch (d)).
3. **Carried over from slice 2t** (do these here, because this dispatch rebuilds every spec context and the attribute places): put `defaultFunctionRegistry` directly on `AttributeSpecContext` and delete `ControlDefaultRegistries`; let the `@default` literal arms yield a written scalar with its span (a small combinator on `readWrittenScalar`) so `lowerDataTypeDefault` reports at the span it is given and `writtenScalar`, `defaultValueExpression` and `listElements` in `psl-column-resolution.ts` go; update the `dataTypeValue` doc comment (cite ADR 256, which dispatch (d) writes, and say it serves as a named attribute argument too); check the rewrite offered for a plain string with `sqlTextReadsBack` and, when the text would not read back, end the message with `write it as a sql literal` instead of an exact rewrite (record this wording in design section 6). Leave the "number of the wrong size" and "no written form" wordings to dispatch (d), which owns the messages' documentation; do not change them.
4. **Section 18.1, in the same dispatch.** Regenerate the Supabase pack contract (`pnpm --filter @internal/extension-supabase run contract:generate`; `contract.json` and `contract.d.ts` byte-identical), rewrite the listed `.prisma` files (including `packages/3-extensions/supabase/test/fixtures/no-policy/contract.prisma` if it holds a plain-string place) and every inline PSL body the research lists, turning each plain string into a `sql` literal with the same canonical text. Write the codemod `scripts/codemods/rewrite-sql-strings.mjs` with its test `scripts/codemods/rewrite-sql-strings.test.mjs` (added to the root `test:scripts`) as section 20 describes, and use it for the rewrites, then review each diff by hand. Dispatch (d) copies the codemod into the fragments; you do not write fragments, but `pnpm check:upgrade-coverage` will demand one because you change `examples/` and `packages/3-extensions/`: create `upgrade-instructions/pending/sql-expression-literals-psl/{app,extension}/instructions.md` with the frontmatter and a one-paragraph placeholder for each change id of the section 20 row, and say in your report that dispatch (d) completes them.
5. `fixtures:check` shows no `contract.json` change for any fixture.

## Tests

Write each test before the code it proves, and make sure it fails first. The plan's "Slice 2b" Tests list names them; the ones that are yours: `sql-expression-places.test.ts`, `interpreter.sql-expression-places.test.ts`, the `psl-full-text-index.test.ts` update, the policy tests of design 9.2, the block spec context test, `sql-expression-wire-names.test.ts`, the `psl-infer` updates, and the two CLI journey updates and the new `sql-expression-literals.e2e.test.ts` under `test/integration/test/cli-journeys/` (it needs PGlite or the test database the neighbouring journeys use; follow them). Assert whole diagnostics: code, message and span.

## Rules

- Repository rules: `pnpm` only, never `npx`, never `vitest` directly (`pnpm test <path>` in the package); no `any`; no bare `as` in production code (`blindCast`/`castAs` from `@internal/utils/casts` if unavoidable); no file extensions in imports; no comments unless the code cannot say it; no re-exports outside `exports/`; test names omit "should"; whole-shape assertions; `pnpm lint:deps` must pass.
- Markdown prose is never hard-wrapped: one paragraph per line.
- After changing exported types in a package, build it before typechecking downstream.

## Verify

Run each command once, save its output under `wip/2b/`, and read the file: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:casts`, `pnpm lint:throws`, `pnpm check:error-reference`, `pnpm lint:framework-vocabulary`, `pnpm fixtures:check`, `pnpm test:packages`, `pnpm test:scripts`, and `pnpm check:upgrade-coverage --mode pr --prev "$(git merge-base origin/main HEAD)" --head HEAD` after committing. In `test/integration`, run only `pnpm test test/authoring test/number-defaults test/date-time-defaults test/cli-journeys/sql-expression-literals.e2e.test.ts test/cli-journeys/infer-roundtrip-fidelity test/cli-journeys/sign-the-database.e2e.test.ts` and any file whose imports or fixtures you changed. Also run the Supabase pack's own tests (`pnpm test` in `packages/3-extensions/supabase`). **Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all` in full; CI does that.** Known local failures to report but not fix: the three publish-shell tarball tests and the two `packaging` integration files fail because `pnpm install` refuses `@vercel/detect-agent@1.2.5`. Rerun any other failing test file alone once; report it as a failure if it fails again. Also run the grep the plan's done-conditions require for slice 2b (`where: "`, `where: '`, `expression: "`, `expression: '`, `using = "`, `withCheck = "` in `.prisma` files and ```` ```prisma ```` blocks, excluding `CHANGELOG.md`, `docs/releases/` and `skills/prisma-8/upgrading/**/upgrades/`) and list what remains for dispatch (d) (docs and skills are its job; source, tests and fixtures are yours).

## Commits

- Small commits, each one step, with explicit `git add <paths>`. Commit this brief first.
- `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution in any commit: no `Co-Authored-By` line and no "Generated with" line.
- Never amend, squash, rebase or force-push. Do not push. Do not open a pull request.

## When you finish or stop

Add a "Slice 2b, dispatches (a) and (b)" section to `status.md` (what was built, each design correction, each verification result with its log path, the artefacts regenerated, what dispatch (c) and (d) still owe) and commit it. Report in plain English, in short sentences: what you built, each design correction, each verification result with its log path, and anything you could not do.
