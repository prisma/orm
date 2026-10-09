# Slice 2b, round 3: system design review

## Scope

- Slice: 2b, "The six places take `sql` literals" (TML-3288, #30550). Branch `h31-2b`, pushed as `tml-3288-sql-expression-places`, base `main` at `bca415baaa`.
- Reviewed: the branch's own commits since `ed1df11285` (`ff0a677271`, `5b5a8538ce`, `0a58490350`, `43c42110b7`, `cfd8a3cb5e`, `0ee6de4c3f`, `7bf88254e2`, `20f0af8117`) and the resolutions of the 14 merges (`wip/2b-round-3/merge-only-hunks.diff`), judged against the end state `git diff origin/main...HEAD`.
- Checked against: ADR 268, ADR 129, ADR 231, ADR 234, ADR 249, ADR 254, ADR 262, `architecture.config.json`, the error reference, the upgrade fragment `upgrade-instructions/pending/sql-expression-literals-psl/`, the rc.15 to rc.16 release fragments, and the project docs.
- Lens: system shape, names, boundaries, and agreement between code and docs. Test strength and implementation details belong to the code reviewer.
- Not repeated: the three items the brief lists as already known.

## What holds

- ADR numbering is clean. Nothing outside the review records and dispatches names ADR 255, 260 or 267 for this slice. ADR 268 is in the index, and every amended ADR, README, the error reference, the editor tooling brief and the `dataTypeValue` doc comment point at 268.
- `pnpm lint:deps` passes (log in `wip/2b-round-3/sd-lint-deps.log`). `pnpm lint:framework-vocabulary` passes at its threshold (`wip/2b-round-3/sd-vocab.log`). Moving `canonicalizeTaggedLiteralBody` to the shared `/authoring` entry is what lets the shared-plane `@internal/sql-contract` use it.
- The merges were careful. Each merge-only hunk either threads `dataTypes` through a new call site from `main`, or rewords a 2b message into 2t's "Expected …" form. No test lost an assertion: the block-context assertions that dropped `block` now assert `{ symbols, dataTypes }`. The one removed policy test (a policy expression read as a JSON string) describes behaviour 2b removes on purpose.
- The `@default` refusal code combines both sides. 2b's `DefaultSpans`, which callers pass in, replaced 2t's returned `DefaultRefusalPlace`. The merge kept `main`'s new `PSL_INVALID_LITERAL` refusal of stored values (#30576) as `storedRefusalMessage`.
- The two codemod fixes (`ff0a677271`, `0a58490350`) keep the three copies byte-identical (same md5) and each adds a test. Treating quoted strings and literals as text that declares nothing is the right model.
- `43c42110b7` covers the fixtures `main` added. No `.prisma` file outside the Prisma 6 and Prisma 7 readers' fixtures and the release archives still writes raw SQL as a quoted string.
- The upgrade fragment describes changes since rc.16 and not 2t's. The "Expected …" wording, `dataTypeValue` and the rc.16 `ControlDefaultRegistries` all shipped in rc.16. The fragment describes only the six places, the change to blank lines at the ends of a literal, the deleted `ControlDefaultRegistries`, `BlockSpecContext.dataTypes` and the export move. C02 and C03 are the exceptions.

## Findings

### C01. ADR 268 and the spec still say a text with `--` and a line break gets a new wire name

- Location: `docs/architecture docs/adrs/ADR 268 - Raw SQL is a value of the data type sql-expression.md`, section "Every place takes a `sql` literal, and plain strings are refused" (last sentence of its first paragraph) and section "Wire names keep line breaks in text that holds `--`"; `projects/sql-expression-literals/spec.md` requirement 5.
- Issue: `ff0a677271` corrected the Consequences section: canonicalization removes only what the wire-name normalizer already ignores, so no wire name changes. Two places still say the opposite. The "Every place" section says no wire name changes "except for a text that holds both `--` and a line break, which gets a new name once (see below)". Spec requirement 5 says the same. The `--` section is written as a decision of ADR 268 ("Decided: … `normalizeSqlBody` keeps its line breaks"). That rule was built in slice 1 (#30546), shipped in rc.15 (release fragment `line-comments-in-raw-sql`), and is recorded as an amendment in ADR 234. For a user upgrading from rc.16, this slice renames nothing, which is what the upgrade fragment says. The ADR contradicts itself and the fragment.
- Suggestion: Delete the "except for …" clause from the "Every place" section. Replace the `--` section with one sentence: line breaks in text that holds `--` are kept for the wire-name hash by ADR 234's line-comment rule, which is why multi-line literals are safe. Alternatively, move the paragraph to the alternatives as context. Fix spec requirement 5 the same way. Do this together with the queued status-line fix, so the ADR reads as one consistent text.

### C02. The extension fragment describes a `BlockSpecContext` with a `block` field, which the code does not have

- Location: `upgrade-instructions/pending/sql-expression-literals-psl/extension/instructions.md`, section "Spec contexts carry the stack's data types": the first bullet and the paragraph starting `blockSpecContext({ symbols, block, dataTypes })`.
- Issue: The fragment says `BlockSpecContext` is `{ symbols, block, dataTypes }` and tells authors to call `blockSpecContext({ symbols, block, dataTypes })`. The code (`packages/1-framework/2-authoring/psl-parser/src/block-spec/types.ts`, `block-spec/spec-context.ts`) has `{ symbols, dataTypes }` and no `block`. ADR 262, as amended here, says "The spec context does not carry the block", and the block being interpreted reaches parse and refine as `BlockAttributeCtx.selfBlock`. `block` was never in a shipped `BlockSpecContext` (rc.15 and rc.16 both have `{ symbols }`). It is left over from the #30381 base that design.md section 9 describes. The merges dropped `block` from the code and tests, but not from this fragment. An extension author following the fragment writes code that does not compile.
- Suggestion: Write `{ symbols, dataTypes }` in both places. If a reader needs to know where the block is, add a sentence pointing to `BlockAttributeCtx.selfBlock`, citing ADR 262.

### C03. The extension fragment supersedes a "pending" fragment that shipped in rc.16

- Location: `upgrade-instructions/pending/sql-expression-literals-psl/extension/instructions.md`, the paragraph "This supersedes the `ControlDefaultRegistries` text of the `spec-contexts-carry-data-types` change in the pending `arguments-typed-by-data-type` extension instructions …"; and the change id `spec-contexts-carry-data-types` in the front matter.
- Issue: `arguments-typed-by-data-type` is no longer pending. It is archived under `upgrade-instructions/releases/8.0.0-rc.15-to-8.0.0-rc.16/sources/`, and a reader of this fragment has already applied it. The sentence was correct while 2t was open and became wrong when 2t shipped. This fragment also reuses that release's change id `spec-contexts-carry-data-types` for a different change. A reader who sees both ids in two consecutive guides will take them for the same change.
- Suggestion: Replace the sentence with a statement of the change from rc.16: "In rc.16, `ControlDefaultRegistries` held only `defaultFunctionRegistry`; it is deleted, and its one field is on the context directly." Or delete the sentence, because the bullet above already says this. Rename the change id to something this release owns, for example `block-spec-context-carries-data-types`.

### C04. ADR 268 says a policy's `using` completes to `sql`; the editor tooling brief says it does not; no test decides

- Location: ADR 268, section "Specs name the data type an argument receives" ("The language server completes `sql` wherever an argument receives `sql/expression`"); `docs/reference/psl-editor-tooling-tagged-literals.md`, section "What the language server does" ("Block parameter values, such as a policy's `using`, get no completion") and the "What is not done" bullet "Completion at a block parameter value"; `packages/1-framework/3-tooling/language-server/test/completion-provider.test.ts`.
- Issue: The two documents disagree. The brief's sentence was true on 2b's old base. `main` then added completion of block values (#30567, shipped in rc.16). Merge `a241517ac7` kept 2b's sentence. In the end state, `blockValueGrammar` (`src/attribute-spec-resolution.ts`) builds the block spec with the stack's `dataTypes`, and `valueItems` (`src/completion-values.ts`) offers the tags of a `dataTypeValue` argument. So `using = |` most likely completes to `sql`, as the ADR says. No test covers it: the existing block-value test uses a fixture `policy` spec whose `using` is `str()`, and the `sql` completion test covers only `@@index` and `@@check`.
- Suggestion: Add a completion test that completes `using = |` in a `policy_select` block with the actual Postgres stack (as `completeWithActualStack` does for `@@index`), or in a fixture block spec whose parameter is `dataTypeValue(SQL_EXPRESSION_DATA_TYPE_ID, …)`. Assert the `sql` item. Then delete the "get no completion" sentence and the "not done" bullet from the brief. If the test shows it does not work, either make it work or make ADR 268 say that only attribute arguments complete.

### C05. Two places still describe the old canonicalization: "a blank first or last line"

- Location: `packages/3-targets/3-targets/postgres/src/core/psl-print/refusals.ts` (the reason text of `refuseSqlTextThatDoesNotReadBack`) and its pinned copy in `packages/3-targets/3-targets/postgres/test/psl-print/refusals-sql-text.test.ts`; `docs/reference/error-reference.md`, `CONTRACT.PRINT_UNSUPPORTED`, the bullet about an index's `expression` or `where`.
- Issue: This slice changed `canonicalizeTaggedLiteralBody` to drop every blank line at the start and end, not only the first and the last. ADR 129, the upgrade fragment and the `PSL_VALUE_TYPE_INCOMPATIBLE` paragraph of the error reference now say "blank lines at the start or end". Merge `a241517ac7` changed that paragraph and the fragment, but not the print refusal or its error-reference entry. Those still say "a blank first or last line". A text that starts with two blank lines is refused, and the message then says only one line is removed. In the same list, the previous bullet ends with "." and the new bullet ends with ".", where the neighbouring bullets end with ";".
- Suggestion: Write "blank lines at the start or end" in the refusal reason, its test constant and the error-reference bullet. End the previous bullet with ";".

### C06. The spec and the manual QA script expect the refusal wording from before 2t

- Location: `projects/sql-expression-literals/spec.md`, the paragraph under the opening example ("the message ends with the rewrite, ``write it as sql`(archived_at IS NULL)` ``"); `projects/sql-expression-literals/manual-qa.md`, the "What to check" table for the six places (rows "Plain string", `42`, `true`, `archived`, and case 38).
- Issue: `cfd8a3cb5e` and the 2t merges changed every message to "Expected …" form: ``Expected sql`...`; write sql`…` ``, ``Expected sql`...` `` alone for a number, a boolean or a text that does not read back, and ``Expected sql`...`; got an identifier`` with a semicolon. The spec and the expected column of the manual QA table still show ``sql/expression has no cast from pg/text; write it as sql`…` ``, `write it as a sql literal`, and `, got an identifier`. The workflow ends with manual QA against this table, so a correct build would be recorded as failing every refusal case.
- Suggestion: Update the spec sentence and the expected column to the current messages, which ADR 268 and the error reference already quote. Leave the recorded runs as they are, since each names the commit it ran on.

### C07. The index entry for ADR 129 says infer skips every object whose text does not read back

- Location: `docs/architecture docs/ADR-INDEX.md`, row 129 ("… `contract infer` prints the SQL of indexes, checks and policies as `sql` literals and skips an object whose text would not read back unchanged").
- Issue: ADR 129 and the code say something narrower. `printableIndex` prints a wire-named index with its canonical text, and only an exact-named object is skipped (checks and policies are always inferred exact-named). A reader who stops at the index takes the skip to be wider than it is.
- Suggestion: "… and skips an exact-named object whose text would not read back unchanged."

### C08. A commit titled as a hook change also changes the codemod and two ADRs

- Location: `ff0a677271` ("The Bash hook also blocks pnpm --filter e2e-tests test"); `.claude/scripts/enforce-tools.mjs`.
- Issue: Round 1 (F08) decided to keep the hook change in this pull request and to name it in the pull request description. `ff0a677271` widens that change to block `pnpm --filter e2e-tests test`. Under the same title, it also fixes the codemod's handling of an unclosed backtick, adds a codemod test, rewrites ADR 268's wire-name consequence, adds a clause to ADR 129, and changes the Supabase skill reference. A reviewer who reads the commit list will not look for codemod or ADR changes there. The hook is agent tooling for every session in the repository and is not part of this slice.
- Suggestion: In the pull request description, list the hook rules this branch adds (both commits) as an unrelated change, and list the codemod fix and the ADR 129 and ADR 268 edits under their own topics. Moving the hook to its own pull request is still cleaner, if Will agrees.

## Could not verify

- That completion actually offers `sql` at a policy's `using` (C04). The code path suggests it does, but I wrote no test, because my output is limited to this file.
- The text of pull request #30550's description, which C08 depends on.

## Fixes check

Range `c64973ded3..HEAD` (implementer `97e8eedd42..440d83fbcd`, orchestrator `532a4ac3f4..16f93849b5`), read at `16f93849b5`.

- C01: fixed. ADR 268 says the wire-name hash ignores everything canonicalization removes, so no name changes. The `--` section is now "Line comments in multi-line literals": it credits the rule to slice 1 and ADR 234, with a link to the existing `#normalizer-stability` heading, and points at the Migration System doc's "Opaque SQL in DDL" section, which says what the ADR says. The status line no longer lists the rule as unbuilt. Spec requirement 5 now says no name changes and that the one-time rename for a body with `--` and a line break came with slice 1, in rc.15.
- C02: fixed. The extension fragment writes `{ symbols, dataTypes }` in both places and points to `BlockAttributeCtx.selfBlock` and ADR 262.
- C03: fixed. The supersede sentence is gone, and the change id is `block-spec-context-carries-data-types`. design.md's fragment row uses the new id.
- C04: fixed. `completion-provider.test.ts` completes `using = |` in a `policy_select` block on the real Postgres stack and asserts the whole `sql` item. `wip/2b-round-3-fixes/d03-postgres-planted.log` shows it failing with the defect planted. The editor tooling brief, the spec and design.md now say a policy's `using` completes `sql`, as ADR 268 does.
- C05: fixed. The refusal reason, its test constant and the error-reference bullet say "blank lines at the start or end". The previous bullet now ends with ";".
- C06: fixed. The spec sentence and the manual QA expected column quote the current messages. The recorded run outputs keep the old text, and each run names its commit, as suggested.
- C07: fixed. The ADR index row and ADR 129 both say "exact-named".
- C08: not changed, and the stated reason mostly holds. The pull request description has a bullet naming the Bash hook change as unrelated and per Will. That bullet says only that the change rode into `0e83ea5e3f`. It does not say that `ff0a677271` widened the change to `pnpm --filter e2e-tests test`. The description also does not tie that commit's codemod and ADR edits to its title, but a squash merge removes the commit titles, so that part does not matter. Suggestion: add "and widened in `ff0a677271`" to that bullet.

No new findings. I checked the new text against the code and the other documents. The only stale wording left is in historical records: design.md section 9 on the #30381 base, design.md's 2b fragment row ("blank first or last lines"), status.md's earlier round entries, plan.md, and recorded manual QA output. None of them describes the current behaviour.
