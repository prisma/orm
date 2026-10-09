# Slice 2b, round 3: code review

Reviewer persona: principal engineer. Lens: correctness of code and tests.

Scope, from `projects/sql-expression-literals/dispatches/2b-round-3-review-brief.md`: the branch commits `ff0a677271`, `5b5a8538ce`, `0a58490350`, `43c42110b7`, `cfd8a3cb5e`, `0ee6de4c3f`, `7bf88254e2` and `20f0af8117`, and the merge decisions in `wip/2b-round-3/merge-only-hunks.diff`, judged against the end state (`git diff origin/main...HEAD`, merge base `bca415baaa`).

## Summary

The merges kept the slice's behaviour. I found no dropped code path in the `@default` reader, the spec contexts, the binder or the block interpreter, and no test that lost an assertion it still needed. Every test file I ran passes and every package I type-checked compiles. The findings are about text that the merges left saying something the code no longer does, two code paths that main's merge added and that no test covers, one test that cannot fail, and one file that does not belong to the slice.

## Findings

### D01. ADR 268 contradicts itself about wire names, and ADR 129 words the same point ambiguously

Location: `docs/architecture docs/adrs/ADR 268 - Raw SQL is a value of the data type sql-expression.md`, line 72 and the section "Wire names keep line breaks in text that holds `--`" (lines 121 to 123); `docs/architecture docs/adrs/ADR 129 - Template-Tagged Literals for Extensions.md`, line 133.

Commit `ff0a677271` rewrote the Consequences bullet (line 132) to say that no wire name changes, because `normalizeSqlBody` already ignores everything canonicalization removes, line comments included. That matches the code: `normalizeSqlBody` in `packages/2-sql/1-core/schema-ir/src/naming.ts` splits a text that holds `--` into lines, trims and collapses each line and drops blank lines, which absorbs every change canonicalization makes. But two other places in the same ADR still say the opposite:

- Line 72: "no wire name changes, except for a text that holds both `--` and a line break, which gets a new name once (see below)".
- Lines 121 to 123 describe `normalizeSqlBody` as collapsing all whitespace and the line-comment rule as a decision still to build. Slice 1 built it, and ADR 234 (line 170) records the one-time name change as slice 1's.

This goes beyond the status line, which the brief lists as known. In ADR 129 the new clause "because the wire-name normalizer ignores everything canonicalization removes (a line comment included)" reads as if canonicalization removes line comments.

Suggestion: make line 72 say what line 132 says. Rewrite the section at 121 to 123 in the past tense ("`normalizeSqlBody` keeps the line breaks of a text that holds `--`, ADR 234"), or fold it into a sentence that points at ADR 234, and fix the status line in the same edit. In ADR 129, write "including for a text that holds a line comment".

### D02. The extension upgrade fragment describes a `BlockSpecContext` the code does not have, and points at a released fragment as pending

Location: `upgrade-instructions/pending/sql-expression-literals-psl/extension/instructions.md`, lines 92, 103 and 105.

Merge `3c88c0a1d2` took main's removal of `block` from the block spec context: `BlockSpecContext` in `packages/1-framework/2-authoring/psl-parser/src/block-spec/types.ts` is `{ symbols, dataTypes }`, `blockSpecContext` takes `{ symbols, dataTypes }`, and a block attribute reads its block from `BlockAttributeCtx.selfBlock` (ADR 262). The fragment still says "`BlockSpecContext` is `{ symbols, block, dataTypes }`" and "`blockSpecContext({ symbols, block, dataTypes })`". An extension author who follows it writes a `block` field that type-checks only through a variable and is ignored.

Line 105 says this change "supersedes the `ControlDefaultRegistries` text of the `spec-contexts-carry-data-types` change in the pending `arguments-typed-by-data-type` extension instructions". That fragment is no longer pending. It shipped in `upgrade-instructions/releases/8.0.0-rc.15-to-8.0.0-rc.16/sources/arguments-typed-by-data-type/`, so a reader upgrading from rc.16 has already applied it.

Suggestion: write `{ symbols, dataTypes }` on lines 92 and 103, and add that a block attribute reads its block from `selfBlock` only if the fragment needs to say where the block went. Replace line 105 with a sentence that states the change from rc.16 directly: "`ControlDefaultRegistries`, which rc.16 reduced to `defaultFunctionRegistry`, is deleted." The bullet above already says most of this.

### D03. Two block-spec call sites added by the merge of main get the stack's data types, but no test checks it, and the tooling doc says block values get no completion

Location: `packages/1-framework/3-tooling/language-server/src/attribute-spec-resolution.ts`, `blockValueGrammar` (lines 86 to 100); `packages/1-framework/3-tooling/language-server/src/completion-provider.ts`, `genericBlockDeclarationKeywordCandidates` (lines 379 to 400); `docs/reference/psl-editor-tooling-tagged-literals.md`, line 46.

Main's #30567 added completion of block values (`blockValueGrammar`) and block keyword snippets that build a spec. Merges `3c88c0a1d2` and `ffad19f085` pass `dataTypes: source.dataTypes ?? EMPTY_DATA_TYPES` at both. `test/block-spec-context.test.ts` checks that block key completion and block attribute argument completion receive the source's data types, but not these two paths. I replaced the data types with `EMPTY_DATA_TYPES` at each site in turn, and all 978 language-server tests still passed both times (logs below).

This matters for users. Postgres's `using` and `withCheck` are `optional(dataTypeValue(SQL_EXPRESSION_DATA_TYPE_ID, ctx.dataTypes))`; `optional` keeps the kind `dataTypeValue`, and `valueItems` in `completion-values.ts` offers the tags of a `dataTypeValue`. So `using = |` in a real Postgres project now offers `sql`, and offers nothing if the data types are dropped. `test/completion-block-values.test.ts` only exercises a fixture `using` typed `str()`. The tooling doc's last sentence on line 46, "Block parameter values, such as a policy's `using`, get no completion", was true for the branch before main's merge and is not true now.

Suggestion: add a test in `test/block-spec-context.test.ts` (or `completion-block-values.test.ts`) with a fixture block whose `using` is `dataTypeValue(<id>, ctx.dataTypes)` and a `DataTypeSupport` holding one tag entry. Assert that `using = |` offers that tag with the source's data types and offers nothing with `EMPTY_DATA_TYPES`. Extend the "receives the source's data types" cases to the keyword snippet path. Change the doc sentence to say that a block parameter that takes raw SQL, such as a policy's `using`, completes `sql`.

### D04. A language-server test name became false in the merge, and its assertion cannot tell real data types from the fallback

Location: `packages/1-framework/3-tooling/language-server/test/completion-provider.test.ts`, line 1414 and the loop after line 1444.

Merge `3c88c0a1d2` changed the assertion to `expect(ctx).toEqual({ symbols: expect.any(Object), dataTypes: expect.any(Object) })` but kept the name "calls the spec factory with the symbol table only". The factory now receives the data types too. `expect.any(Object)` also accepts `EMPTY_DATA_TYPES`, which the provider substitutes when the source has none, so the assertion passes whether or not the real data types arrive.

Suggestion: rename to "calls the spec factory with the spec context and never invokes rule parsing". Either drop the `dataTypes` check here, since `block-spec-context.test.ts` covers it by identity, or pass a known `DataTypeSupport` and assert `toBe` on it.

### D05. Two Postgres tests still build a block spec context with a `block` field

Location: `packages/3-targets/3-targets/postgres/test/block-documentation.test.ts`, lines 7 to 16; `packages/3-targets/3-targets/postgres/test/sql-expression-places.test.ts`, line 46.

Both build `{ symbols, block, dataTypes }`. After merge `3c88c0a1d2` nothing reads `block`. In `block-documentation.test.ts` the probe `role` block and its lookup exist only to fill that field. The extra field compiles only because the object is not checked against `BlockSpecContext` at the literal. It also tells the reader that specs can see the block, which ADR 262 now says they cannot.

Suggestion: build the context with `blockSpecContext({ symbols, dataTypes })` from `@internal/psl-parser`, so the type checker rejects a stray field, and drop the probe block lookup.

### D06. The codemod test added in `ff0a677271` passes without the fix it was written for

Location: `scripts/codemods/rewrite-sql-strings.test.mjs`, line 36 ("keeps treating // comments as comments after an unclosed backtick").

The fix changed `break` to `continue` for an unclosed backtick in `inertRanges` (then `commentRanges`), so that `//` comments after it are still skipped. The test's commented line is `// where: "commented out"`, which holds no `@@index`, `@@fullTextIndex`, `@@check` or `policy_*` start. The codemod never looks for strings outside those, so the line is left alone with or without the fix. I put `break` back: the behavioural tests all pass, and only the byte-for-byte copy checks of the upgrade fragments fail. With a commented-out attribute instead, `// @@check(expression: "commented", name: "c")`, the `break` version rewrites the comment to ``sql`commented` `` and the current version leaves it alone (`wip/2b-round-3/code-review/probe-unclosed.mjs`).

Suggestion: change the middle line of the test to `  // @@check(expression: "commented out", name: "c")` and keep the expected output unchanged.

The three tests added in `0a58490350` do fail when strings and backtick literals are no longer treated as inert, so that fix is covered.

### D07. The Bash hook change does not belong to this slice

Location: `.claude/scripts/enforce-tools.mjs` (16 added lines against main; from `0e83ea5e3f` and `ff0a677271`).

The hook blocks full test-suite commands in agent shells. It is agent tooling with no connection to `sql` literals, has no test, and lands in a pull request whose reviewers are looking at PSL authoring. `ff0a677271` is titled as the hook change but also carries the codemod fix, its test, two ADR edits and a skill edit. That mix makes the hook easy to miss in review and the codemod fix easy to miss in history.

Suggestion: move the hook change to its own pull request, and drop it from this branch.

### D08. The Supabase skill reference says a `sql` literal escapes nothing

Location: `skills/prisma-8/references/supabase.md`, line 99 (edited in `ff0a677271`).

"a `sql` literal escapes nothing" is not accurate. A backtick literal resolves `` \` `` and `\\`, and the double-quote form `sql"..."` resolves the usual string escapes (`packages/2-sql/2-authoring/contract-psl/README.md`, the raw-SQL defaults bullet). An agent that writes a predicate with a backslash, such as a `LIKE` pattern, from this guidance gets a different text than intended.

Suggestion: "Quote camelCase column names with ordinary double quotes (`"userId"`); inside a backtick `sql` literal only `` \` `` and `\\` are escapes."

### D09. The manual QA plan still expects the old refusal wording for the raw-SQL places

Location: `projects/sql-expression-literals/manual-qa.md`, lines 452 to 459.

The expected-result table for the raw-SQL places reads ``sql/expression has no cast from pg/text; write it as sql`<the same text>` ``, ``sql/expression has no cast from pg/int2; write sql`...` `` and "ending `write it as a sql literal`". Since the merges of slice 2t, the code says ``Expected sql`...`; write sql`<text>` ``, ``Expected sql`...` `` for a number or a boolean, and ``Expected sql`...` `` alone when the rewrite would read back differently (`packages/2-sql/2-authoring/contract-psl/test/interpreter.sql-expression-places.test.ts`). The log blocks further down are records of earlier runs and can stay. The table is what the next manual QA pass compares against, so every row would fail.

Suggestion: update the expected column of that table to the current wording before the manual QA step.

## Checked and found correct

- `@default` reading after the merges (`packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts`, `psl-column-resolution.ts`, `psl-field-resolution.ts`, `sql-attribute-specs.ts`): each refusal is reported where main reported it. Codec refusals and the list-expected refusal are reported at the attribute, and cast-rule refusals at the written value or list element. `readStoredValue` keeps main's `PSL_INVALID_LITERAL` for cast refusals. The null handling, the strict-list null refusal, value-set members and enum member lists behave as on main.
- The binder, `interpretExtensionBlocks`, `interpretExtensionBlock` and `interpretExtensionBlockAttributes` all build block spec contexts with the same data types.
- ADR numbers: no tracked file outside the review records and dispatches points at ADR 260 or 267 for this decision, and nothing points at main's ADR 260 for it. ADR 249's snippet and prose match `AttributeSpecContext` and `fieldSpecContext`.
- Messages and codes in the error reference, ADR 268, ADR 129, the contract-psl README and the app upgrade fragment match the tests (``Expected sql`...`; write sql`...` ``, ``Expected sql`...`; got an identifier``, no prefix at raw-SQL places).
- Removed test assertions in the merges: `taggedLiteralTextReadsBack` became `printedTaggedLiteralReadsBack`; the `dataTypeValue` refusals dropped the value type from the expected text, as the new wording does; the `block` context checks were replaced by `{ symbols, dataTypes }` checks; and the Postgres policy test "reads a policy expression as a JSON string" was carried over as the double-quoted `sql` literal case.
- `43c42110b7`: no `.prisma` file left in the repository writes raw SQL as a quoted string, apart from the Prisma 6 and 7 reader fixtures, where that is the point.
- `5b5a8538ce`: the three test updates match main's changed types, and the tests pass.

## What I ran

All logs are under `wip/2b-round-3/code-review/`.

| Command (run with `mise exec --`) | Log | Result |
| --- | --- | --- |
| `node --test scripts/codemods/rewrite-sql-strings.test.mjs` | `codemod-test.log` | 27 pass |
| same, with the inert ranges for strings and backtick literals removed | `codemod-planted-inert.log` | 3 behavioural tests and 2 copy checks fail, as they should |
| same, with `break` restored for an unclosed backtick | `codemod-planted-break.log` | only the 2 copy checks fail (D06) |
| `node wip/2b-round-3/code-review/probe-unclosed.mjs`, with and without the `break` | console | the commented-out `@@check` is rewritten only with `break` |
| `pnpm test` on 5 files in `packages/2-sql/2-authoring/contract-psl` | `contract-psl-tests.log` | 55 pass |
| `pnpm test` on 10 files in `packages/3-targets/3-targets/postgres` | `postgres-tests.log` | pass |
| `pnpm test test/block-spec-context.test.ts` in `packages/2-mongo-family/2-authoring/contract-psl` | `mongo-tests.log` | pass |
| `pnpm test` on 4 files in `packages/1-framework/3-tooling/language-server` | `language-server-tests.log` | 107 pass |
| `pnpm test` in the language server with `blockValueGrammar` given `EMPTY_DATA_TYPES` | `language-server-planted-block-value.log` | 978 pass (D03) |
| `pnpm test` in the language server with the keyword snippet given `EMPTY_DATA_TYPES` | `language-server-planted-keyword-snippet.log` | 978 pass (D03) |
| `pnpm typecheck` in language-server, psl-parser, SQL contract-psl, Mongo contract-psl and Postgres | `typecheck-*.log` | all exit 0 |

Every planted change was restored with `git checkout -- <file>`, and the working tree is clean apart from this review.

## Not verified

- That `using = |` in a real Postgres project offers `sql` (D03). This follows from reading `blockValueGrammar`, `optional` and `valueItems`; no test exercises it, which is the finding.
- I ran no integration or end-to-end tests, as the brief requires. The rename-table journey fixtures from `43c42110b7` are exercised only there.

## Fixes check

Checked on `16f93849b5`, commits `c64973ded3..16f93849b5`. My logs are under `wip/2b-round-3/code-review/fixes-*.log`; the implementer's are under `wip/2b-round-3-fixes/`.

- **D01 fixed.** ADR 268's status line, line 72 and the section now titled "Line comments in multi-line literals" say that canonicalization changes no wire name and that slice 1 built the line-comment rule (ADR 234, "Normalizer stability"). ADR 129 now says "including for a text that holds a line comment".
- **D02 fixed.** The extension fragment says `BlockSpecContext` is `{ symbols, dataTypes }`, says where the block went (`BlockAttributeCtx.selfBlock`), and calls `blockSpecContext({ symbols, dataTypes })`. The "pending `arguments-typed-by-data-type`" sentence is gone. The change id is now `block-spec-context-carries-data-types`, so it no longer reuses the id of the released rc.16 change.
- **D03 fixed.** `test/block-spec-context.test.ts` uses a fixture block whose `using` is a `dataTypeValue` with a tag. It checks that block value completion and block keyword completion receive the source's data types by identity, and that `using = |` offers the tag only when the source has data types. `completion-provider.test.ts` checks that `using = |` in a `policy_select` block on the real Postgres stack offers `sql`. I gave `blockValueGrammar` `EMPTY_DATA_TYPES` again, and three tests fail (`fixes-ls-planted-block-value-2.log`). The implementer's log shows the keyword snippet path failing the same way (`d03-planted-keyword.log`). The tooling doc now says a policy's `using` completes `sql`. See D10 for how the real-stack test loads Postgres.
- **D04 fixed.** The test is named "calls the spec factory with the spec context and never invokes rule parsing". It passes a known `DataTypeSupport` and asserts `toBe` on it. The implementer's planted log fails (`d04-planted.log`).
- **D05 fixed.** Both Postgres tests build the context with `blockSpecContext({ symbols, dataTypes })`, and the probe blocks are gone. The type checker now rejects a stray field (`d05-typecheck-planted.log`).
- **D06 fixed.** The commented line is now `// @@check(expression: "commented out", name: "c")`. I restored `break`, and the test fails along with the two copy checks (`fixes-codemod-planted-break.log`).
- **D07 left, and the reason holds.** `status.md`, "Slice 2b review, round 3", says Will asked for the hook and that round 1 (F08) kept it. The pull request description of #30550 names the hook change as unrelated and "per Will". It names only `0e83ea5e3f`, not the `e2e-tests` rule added in `ff0a677271`. That is minor, and I do not raise it as a finding.
- **D08 fixed.** The Supabase reference says the only escapes in a backtick `sql` literal are `` \` `` and `\\`.
- **D09 fixed.** The expected column of the manual QA table and the spec quote the current messages (``Expected sql`...`; write sql`<text>` ``, ``Expected sql`...` ``, ``Expected sql`...`; got an identifier``).

### D10. The real-Postgres-stack language-server test imports target source from a framework package by file path

Location: `packages/1-framework/3-tooling/language-server/test/completion-provider.test.ts`, `actualPostgresStack` (around line 354) and the test "offers a sql literal for a policy block's using".

The test loads `../../../3-targets/3-targets/postgres/src/core/authoring.ts` through `importFromPackageRoot`, a dynamic `import()` of a computed file path. The language server's `package.json` gains no dependency. `lint:deps` passes because dependency-cruiser cannot follow a computed path, and `scripts/lint-framework-target-imports.mjs` passes because it looks only for the text `@internal/target-` (`fixes-lint-framework-target-imports.log`). But that script's header states the rule: a framework package "must never name a Domain 3 (target) package, not even inside a string". So this test meets the letter of the checks, not the rule.

It is not a new kind of import. The same file already loads Postgres's `data-types.ts` and the Postgres adapter's `control-mutation-defaults.ts` this way. This test widens the reach to Postgres's whole authoring module, which pulls in the SQL family's control plane at run time. One of my planted runs hit `Cannot find package '@internal/family-sql/control' imported from .../postgres/dist/...` in a neighbouring real-stack test while another session was rebuilding in this worktree (`fixes-ls-planted-block-value.log`); the rerun did not reproduce it. Tests that reach across packages by path depend on other packages' build output in ways their own manifest does not declare.

The fixture test in `block-spec-context.test.ts` already pins the language-server behaviour, so the real-stack check is an end-to-end check of the Postgres descriptor.

Suggestion: move "offers a sql literal for a policy block's using" to `test/integration/test/authoring/`, whose `package.json` declares both `@internal/language-server` and `@internal/target-postgres`, next to `attribute-specs.lsp-consumability.test.ts`. Moving the older path imports in this file is out of scope for this slice.

### Fixes-check runs

| Command (run with `mise exec --`) | Log | Result |
| --- | --- | --- |
| `pnpm test test/block-spec-context.test.ts test/completion-provider.test.ts` in the language server | `fixes-ls-green.log` | 71 pass |
| same, with `blockValueGrammar` given `EMPTY_DATA_TYPES` | `fixes-ls-planted-block-value.log`, `fixes-ls-planted-block-value-2.log` | the three D03 tests fail; the first run also had the transient failure described in D10 |
| `node --test scripts/codemods/rewrite-sql-strings.test.mjs` with `break` restored | `fixes-codemod-planted-break.log` | the D06 test and the two copy checks fail |
| `node scripts/lint-framework-target-imports.mjs` | `fixes-lint-framework-target-imports.log` | passes (D10) |

Every planted change was restored with `git checkout -- <file>`. While I worked, other sessions changed two tracked files in this worktree that I did not touch: `test/integration/test/cli-journeys/sql-expression-literals.e2e.test.ts` and `projects/sql-expression-literals/slice-reviews/2b-round-3/system-design-review.md`. I left them as they are.
