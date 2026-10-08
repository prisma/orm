# Brief: implement slice 2t, an argument declares the data type it receives (TML-3367)

You implement slice 2t of the project "SQL expression literals". You work in the git worktree at the current directory, on branch `tml-3367-data-type-value`, which starts from the tip of slice 2a's branch (`tml-3296-sql-expression-data-type`, pull request #30534). Do not read, write or run anything outside this worktree. Do not use `/tmp`; use the gitignored `wip/` folder for scratch files. Run node, pnpm and git through `mise exec --`.

## Read first

1. `CLAUDE.md` at the worktree root and `.agents/rules/README.md`, then the rules it lists under Testing and TypeScript & Typing.
2. `projects/sql-expression-literals/status.md`, then `plan.md` sections "Done conditions for every slice" and "Slice 2t", then `spec.md`.
3. `design.md` sections 1, 4, 5, 6, 7, 18.3 (the items for sections 4 to 7), 19 (the ADR 231, 249 and 254 rows) and 20 (any 2t row). Section 10 and 10.1 describe what slice 2a left in `contract-psl/src/data-type-default.ts` and `psl-column-resolution.ts`, which this slice moves.
4. `design-notes.md` decision 14: the six requirements of the project "Data types own column types", which reuses `dataTypeValue`. The design meets them; keep it that way.
5. `research/rebase-delta.md` Part B: every production and test site that builds an attribute spec context or `ControlDefaultRegistries`.

## What the design got wrong against `main`

The design was written before `main` moved. These corrections are already checked; apply them and correct design.md where it names the old files.

- The language server has no `pipeline.ts` and no `PipelineInputs`. The type is `LspControlStack` in `packages/1-framework/3-tooling/language-server/src/lsp-control-stack.ts`, and it is built by `lspControlStackFromStack` in `config-resolution.ts`. Add `readonly dataTypes?: DataTypeSupport` to `LspControlStack` and set it in `lspControlStackFromStack` from `{ entries: stack.authoringContributions.dataTypes, lookup: stack.dataTypeLookup }`. `project.ts` already spreads `...data.controlStack` into both `candidates` objects, so the `server.ts` edit the design names does not exist; check that `AttributeSpecSource` (`attribute-spec-resolution.ts`) receives `dataTypes` through that spread and reads `source.dataTypes ?? EMPTY_DATA_TYPES`.
- The Mongo family lives at `packages/2-mongo-family/2-authoring/contract-psl/src/provider.ts` and `interpreter.ts`.
- `ArgTypeKind` in `psl-parser/src/attribute-spec/types.ts` already has `'json'` and `'taggedLiteral'`; add `'dataTypeValue'`.
- Every other file section 4 to 7 names exists at the path given.

If you find another difference in behaviour or in a type the design depends on, stop and write it to `projects/sql-expression-literals/dispatches/2t-findings.md` with your recommendation. A file or function that merely moved: correct the design and continue.

## What you build

Follow design sections 4 to 7 exactly. The design fixes every name, signature, message and file; you have no design freedom. In short:

1. **Section 4.** New `framework-components/src/shared/written-value.ts`, exported from `src/exports/authoring.ts`: `WrittenValue`, `WrittenScalar`, `DataTypeSupport`, `TypedValue`, `ReadRefusal`, `CastRefusal`, `entryForTag`, `entryForPlain`, `knownTags`, `readWrittenValue`, `castTypedValue`, `admittedTags`, `describeAdmittedForms`. Move the family-blind half of `contract-psl/src/data-type-default.ts` there; `contract-psl` keeps `DefaultRefusal`, `readDataTypeDefault` and `lowerDataTypeDefault` and imports the rest. `contract-prisma7` imports `entryForTag`, `WrittenValue` and `DataTypeSupport` from `@internal/framework-components/authoring`.
2. **Section 5.** New `psl-parser/src/written-literal.ts` with `readWrittenLiteral` and `WrittenLiteralResult`, exported from `src/exports/index.ts`.
3. **Section 6.** New `psl-parser/src/attribute-spec/combinators/data-type-value.ts` with `dataTypeValue`; `ParsedTypedValue` and `DataTypeValueArgType` in `types.ts` and the exports. Construction never throws; `parse` throws `InternalError` for an unregistered type.
4. **Section 7.** `AttributeSpecContext` gains `dataTypes: DataTypeSupport`; `ControlDefaultRegistries` loses `dataTypeEntries`; every construction site in `rebase-delta.md` Part B passes the stack's data types; `EMPTY_DATA_TYPES` is exported from psl-parser.
5. **Carried over from the slice 2a review** (the list at the end of plan.md "Slice 2t"): the ADR 254 sentence about the scalar cast rule; rename `TaggedLiteralCanonicalization.body` to `text` (with `parseJsonBody`/`printJsonBody` in the target entries renamed to `parseJsonText`/`printJsonText` if they exist under those names); `@default` reports `PSL_VALUE_TYPE_INCOMPATIBLE` and `PSL_INVALID_LITERAL` at the written value, with ADR 254 and `error-reference.md` updated; the `unknown-tag` arm of `lowerDataTypeDefault` goes, replaced by the framework reader; no name about lowering a tag survives; remove `sql` from the `@default` list-element tags so completion and "Expected one of" stop offering it. Where one of these changes a user-visible message or completion, update the upgrade fragments under `upgrade-instructions/pending/` (add a new fragment folder for this slice as `skills-contrib/record-upgrade-instructions/SKILL.md` requires; do not edit the slice 2a fragments) and the manual QA script in `manual-qa.md`, and record a run.
6. **Docs.** ADR 231, 249 and 254 rows of design section 19 that name slice 2t or sections 4 to 7; `docs/reference/psl-editor-tooling-tagged-literals.md` line 13 names `ControlDefaultRegistries.dataTypeEntries` and must name the spec context's `dataTypes` instead.

No place uses `dataTypeValue` yet, and no user-visible behaviour changes except the carried-over items in point 5. `fixtures:check` shows no `contract.json` change.

## Tests

Write each test before the code it proves, and make sure it fails first. The plan's "Slice 2t" section lists them: `framework-components/test/written-value.test.ts`; `psl-parser/test/written-literal.test.ts` (every row of the section 5 table); `psl-parser/test/attribute-spec-combinators.data-type-value.test.ts` (every diagnostic of section 6 with exact code, message and span, including each `found` word; success returns the typed value; construction does not throw for an unregistered type and `parse` throws `InternalError`; `dataTypeValue` for `pg/int4`; `dataTypeValue` as a parameter of a `funcCall` that is an arm of `oneOf`). The existing `@default` tests pass unchanged except where the carried-over items change a span or an offered tag. Update the tests that build `controlMutationDefaults` with `dataTypeEntries` (`rebase-delta.md` B.3) to pass `dataTypes`.

## Rules

- Repository rules: `pnpm` only, never `npx`, never `vitest` directly (use `pnpm test <path>` in the package); no `any`; no bare `as` in production code (use `blindCast`/`castAs` from `@internal/utils/casts` if unavoidable); no file extensions in imports; no comments unless the code cannot say it, and doc comments only on exported surface, terse; no re-exports outside `exports/`; test names omit "should"; whole-shape assertions; `pnpm lint:deps` must pass, so the framework packages must not import family or target code.
- Markdown prose is never hard-wrapped: one paragraph per line.
- After changing exported types in a package consumed elsewhere, run that package's `pnpm build` before typechecking downstream.

## Verify

Run each command once, save its output under `wip/2t/`, and read the file: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:casts`, `pnpm lint:throws`, `pnpm check:error-reference`, `pnpm lint:framework-vocabulary`, `pnpm fixtures:check`, `pnpm test:packages`, and `pnpm check:upgrade-coverage --mode pr --prev "$(git merge-base origin/main HEAD)" --head HEAD` after committing. Then, in `test/integration`, run only `pnpm test test/authoring test/number-defaults` and any integration file whose imports you changed. **Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all` in full; CI does that.** Known local failures to report but not fix: the three publish-shell tarball tests and the two `packaging` integration files fail because `pnpm install` refuses `@vercel/detect-agent@1.2.5`. Rerun any other failing test file alone once; report it as a failure if it fails again.

## Commits

- Small commits, each one step of the design, with explicit `git add <paths>`.
- `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution in any commit: no `Co-Authored-By` line and no "Generated with" line.
- Never amend, squash, rebase or force-push. Do not push. Do not open a pull request.

## When you finish or stop

Add a "Slice 2t" section to `status.md` (what was built, each design correction, each verification result with its log path, the manual QA run) and commit it. Report in plain English, in short sentences: what you built, each design correction, each verification result with its log path, and anything you could not do.
