# Slice 2b code review (TML-3288)

Range: `tml-3367-data-type-value..HEAD`, 32 commits, read at HEAD `d951834e1e`. HEAD is a merge of the slice 2t branch into this branch. Reviewer lens: principal engineer. Logs of my own runs are in `wip/2b-review/`.

## Summary

The slice does what the plan asks. All six places receive `sql/expression` through `dataTypeValue`, lowering stores the canonical text, and every production path that builds a block spec context passes the stack's data types. `contract infer` and `contract print` write `sql` literals and skip or refuse text that would not read back. The Supabase artefacts, fixtures and inline PSL are rewritten, and the codemod reproduces every committed `.prisma` rewrite exactly. I found no behaviour bug in the six places, the printers or the language server.

The most important finding is in the codemod (F02). An apostrophe in a `//` comment inside a policy block stops the scan of that block, so the file is left unchanged and not reported. The user then meets the refusal at emit time instead. The second is procedural (F01): every implementer log predates the merge commit at HEAD, which changed `psl-column-resolution.ts` and `data-type-default.ts`. I re-ran most checks at HEAD and they pass; `pnpm lint`, `pnpm test:packages` and the integration files were not re-run.

The upgrade fragment names the wrong superseded text (F03), and the claim that the one-time migration "has no operations" has no test (F04). The rest are small test and code-shape points.

Runs at HEAD, all pass: `pnpm build` and `pnpm typecheck` (both full Turbo cache hits at HEAD), `fixtures:check` (tree clean), `lint:deps`, `lint:casts` (delta 0), `lint:throws` (delta 0), `lint:framework-vocabulary` (272 of 272), `check:error-reference` (361 codes), `check:upgrade-coverage`; psl-parser 58 files, contract-psl 48 files, Mongo contract-psl 17 files, Postgres target 40 files (the six-place, wire-name, policy, full-text, `psl-infer`, `psl-print`, RLS authoring tests), language-server completion, semantic tokens and block spec context (3 files), codemod test.

## What looks solid

- `dataTypeValue` checks the rewrite with `canonicalizeTaggedLiteralBody` and falls back to `write it as a sql literal`. The combinator test covers indented text, a carriage return and a blank last line, and manual QA case 38 shows the message on a real stack.
- `sqlTextReadsBack` is exactly "canonicalization succeeds and returns the same text". I checked it against `printTaggedLiteral` for each form: the backtick form doubles backslashes and PSL resolves `\\`, the double-quote form escapes and decodes symmetrically, and a multi-line text starts on its own line so indentation added by the printer is removed on read. Tabs mixed with spaces, a first line indented relative to the others, and trailing whitespace on the last line all give the right answer.
- Block spec contexts: the four production builders (binder `bindBlock` and block attributes, `interpretExtensionBlocks`, `interpretExtensionBlockAttributes`, the language server's block key and block attribute completion) all pass `dataTypes`. The tests assert identity with `!==`, not equality, for the SQL interpreter, the SQL provider, the Mongo provider and the language server, so a copied or empty value would fail them.
- The language server never parses a value with `EMPTY_DATA_TYPES`: it builds no binder, and its interpretation diagnostics go through the provider with the real stack.
- `@default` refusals: every message and span in the existing default tests is unchanged. `DefaultRefusalPlace`, `defaultValueExpression`, `listElements` and the local `writtenScalar` are gone. `writtenScalar` keeps the arm's metadata, so completion of `@default(` still offers the tags.
- The policy predicate tests assert code, message and span for `using` and `withCheck` separately, and show there is no duplicate diagnostic from the binder and the interpreter both parsing the block.
- The guard test covers all eight predicate slots (three policy specs) and the four attribute slots.
- The codemod decodes PSL string escapes exactly as `decodeStringLiteral` does, including an invalid `\x` or `\u` sequence and `\u{...}`, which PSL keeps as written. Running it on the merge-base versions of the Supabase pack contract, `examples/supabase`, both Supabase fixtures and the RLS parity schema gives the committed files byte for byte (`wip/2b-review/v/`).
- The new journey test infers an `EXISTS (SELECT … FROM … WHERE …)` predicate, which Postgres reprints on several lines, and asserts nothing is skipped and a second inference is identical. That exercises the multi-line printer path inside a namespace block against a real database.
- The done-condition grep is clean: in `.prisma` files only the Prisma 6 Mongo and Prisma 7 `dbgenerated(expression:)` fixtures remain; in ```` ```prisma ```` blocks only the historical example in ADR 126 remains. No source, test or example PSL holds a plain-string place.

## Findings

### F01. Verification predates the merge at HEAD

- Location: merge commit `d951834e1e`; logs in `wip/2b/` and `wip/2b-cd/`.
- Issue: every log the status cites was written before the merge of `tml-3367-data-type-value` (268 files). The merge changed `contract-psl/src/psl-column-resolution.ts`, `data-type-default.ts`, the Mongo interpreter and provider, and the Postgres issue planner, all files this slice touches or depends on. My runs at HEAD cover build, typecheck, fixtures, the lint ratchets, upgrade coverage and the directly affected package tests, and all pass. `pnpm lint`, `pnpm test:packages`, `pnpm test:scripts` and the integration files (the new journey, `infer-roundtrip-fidelity*`, `sign-the-database`, `test/authoring`) have not run at HEAD.
- Suggestion: run those once at HEAD, save the logs, and record them in `status.md` before opening the pull request.

### F02. The codemod silently skips a policy after an apostrophe in a comment

- Location: `scripts/codemods/rewrite-sql-strings.mjs` lines 155-170 (policy scan) and 129-152 (attribute scan); both copies under `upgrade-instructions/pending/sql-expression-literals-psl/*/scripts/`.
- Issue: both scans treat any `'` or `"` as the start of a string, including one inside a `//` comment. `stringEnd` stops at the line break and returns -1, and the loop then `break`s out of the block. So this policy is not rewritten and the file is not reported:

  ```prisma
  policy_select p {
    target = Post
    // owner's rows
    using = "owner_id = 1"
  }
  ```

  I confirmed this with `wip/2b-review/probe.mjs` (0 rewrites). The fragment says the script "finds each quoted string in those places", so a user trusts the empty output. The opposite also happens: text in `//` and `///` comments is rewritten, for example `// @@index([id], where: "id > 0")`. `closingEnd` already skips comments; the two inner scans do not.
- Suggestion: skip `//` to the end of the line in both inner scans, as `closingEnd` does, and decide whether `ATTRIBUTE_START` matches inside a comment (skipping comments there too is simplest). Add tests for an apostrophe in a comment inside a policy block and an attribute in a comment. Also add a test for a text with `\n`, which is the one output shape (text on its own lines) that has no test. Copy the fixed script to both fragments.

### F03. The app fragment names the wrong superseded text

- Location: `upgrade-instructions/pending/sql-expression-literals-psl/app/instructions.md` line 57.
- Issue: it says it supersedes "the PSL `where:` example of the `postgres-full-text-search` app instructions" and tells the reader to write `` where: sql`archived_at IS NULL` ``. That fragment (`upgrade-instructions/releases/8.0.0-rc.11-to-8.0.0-rc.12/sources/postgres-full-text-search/app/instructions.md`) has no PSL `where:`. Its `where: 'archived_at IS NULL'` is TypeScript (line 54, which slice 3 supersedes). Its PSL plain string is `@@index(expression: "to_tsvector(…)", type: "gin", …)` at line 79, which design section 20 names.
- Suggestion: say it supersedes the PSL `@@index(expression: "to_tsvector(…)", …)` example at line 79, now written ``@@index(expression: sql`to_tsvector(…)`, type: "gin", …)``.

### F04. "The migration has no operations" is not tested

- Location: `upgrade-instructions/pending/sql-expression-literals-psl/app/instructions.md` line 63; `extension/instructions.md` line 67; ADR 260 line 132.
- Issue: all three tell users that after a stored text changes, one `migration plan` writes a migration with no operations. That depends on the planner identifying indexes, checks and policies only by their wire names and never comparing the stored text. Nothing in this slice shows it. If the planner compares `where` or `expression`, users get a drop and re-create instead.
- Suggestion: add a planner test with two contracts that differ only in an index `where`, a check `expression` and a policy `using` changing from `"  a = 1\n"` to `"a = 1"`, and assert the plan is empty. If it is not empty, correct the three texts.

### F05. The print refusal test catches the error by hand

- Location: `packages/3-targets/3-targets/postgres/test/psl-print/refusals-sql-text.test.ts` lines 9-16 and each `expect(thrownBy(print))`.
- Issue: `thrownBy` is a manual try/catch. `prefer-to-throw.mdc` asks for `expect().toThrow()`, and the neighbouring refusal tests use `expect(print).toThrow(refusal(...))`. If `print` stops throwing, `thrownBy` returns `undefined` and the test still fails, so this is style, not a hole.
- Suggestion: `expect(print).toThrow(expect.objectContaining({ code, message, why, fix, meta }))`, and delete `thrownBy`.

### F06. One policy test asserts only part of the diagnostic

- Location: `packages/3-targets/3-targets/postgres/test/psl-policy-predicates.test.ts` lines 166-181.
- Issue: "still reports a predicate the operation does not take as an unknown parameter" uses `expect.objectContaining` without `sourceId` and `span`. The brief asks for whole diagnostics. A regression that reported the unknown key at the block instead of the entry would pass.
- Suggestion: assert the whole object with `spanAt(source, 'using', 'using')` or the span the other tests in the file compute.

### F07. The "every text reads back" check is written three times

- Location: `postgres/src/core/psl-infer/infer-model-blocks.ts` line 136, `psl-infer/infer-policy-blocks.ts` lines 15-17 and 92, `psl-print/refusals.ts` line 616.
- Issue: the same predicate over a list of optional texts is written three ways. `SQL_DOES_NOT_READ_BACK` lives in `infer-policy-blocks.ts` and `infer-model-blocks.ts` imports it from there, although it is not about policies.
- Suggestion: one function, for example `sqlTextsReadBack(texts: readonly (string | undefined)[])` beside `sqlTextReadsBack`, used by all three. Put the note text in a module both infer files already share, or in the same place.

### F08. An unrelated agent-tooling change rides in a refactor commit

- Location: `.claude/scripts/enforce-tools.mjs`, added in `0e83ea5e3f` ("refactor(psl-parser): attribute spec contexts carry defaultFunctionRegistry directly").
- Issue: the commit adds four rules that block full test suites for every agent session in the repository. The change may be right, but a reviewer reading the commit or the slice's pull request will not look for it there.
- Suggestion: move it to its own commit (a new commit that reverts and re-adds it is enough, since history is not rewritten), or split it into its own pull request, and mention it in the pull request description.

## Deferred (out of scope)

- A text ending in a `--` comment in the journey test, and the DoD bullet about `--` in each place: slice 1 (TML-3287), decided in `2b-findings.md` finding 2.
- TypeScript half of "a plain string, a number or a boolean does not compile", and TypeScript texts that are not canonical: slice 3. Until then `contract print` refuses such a text, which is the intended behaviour.
- The wording of a number of the wrong size (`pg/int4 has no cast from pg/int8; write a number`) and of `write no written form`: no place in this slice receives a number-typed or formless type, so neither message can appear. The item stays in `status.md` "Still owed" and must be done before a number-typed place ships or in the release notes.
- Empty `where`, `expression` and policy predicates (`sql```), which still render invalid DDL: design section 21 non-goal.
- Completion at a block parameter value such as `using = |`: non-goal.
- A diagnostic for a multi-line plain string carries the rewrite with its line breaks inside the message. That is the exact rewrite the design asks for; no change proposed.

## Acceptance-criteria verification

### Plan "Slice 2b" tests

| Item | Verdict | What I read or ran |
| --- | --- | --- |
| `sql-expression-places.test.ts`, the guard | PASS | Test reads `kind` and `dataType` of all eight slots; ran at HEAD. |
| `interpreter.sql-expression-places.test.ts` | PASS | Single-line and multi-line lower to canonical text; plain string (exact rewrite), `42`, `true`, identifier, `pg.sql` with whole diagnostic and span; `` sql`` `` gives `PSL_CHECK_EXPRESSION_EMPTY`. Ran at HEAD. |
| `psl-full-text-index.test.ts` update | PASS | `where` takes `sql`; plain string, `42`, `true` refused with whole diagnostic. Ran at HEAD. |
| Policy tests (design 9.2) | PASS | `psl-policy-predicates.test.ts`: canonical text reaches `PostgresRlsPolicy`; plain string, `'x'`, `42`, `true`, `pg.sql` refused per value with span; `permissive = false`; unknown key (partial assertion, F06). |
| Block spec context from each production path | PASS | psl-parser, contract-psl (interpreter and provider), Mongo provider, language server; identity assertions. |
| `sql-expression-wire-names.test.ts` | PASS | Indented, blank first and last lines, CRLF; index (expression and where), check and policy hashes equal to the canonical form's. |
| `psl-infer/*` updates | PASS | `infer-sql-expression-literals.test.ts`: `sql` literals for index, check, policy; backtick in double-quote form; multi-line; CRLF check and policy skipped with the note; also indexes. Assertions use `toContain`, with negative checks. |
| `completion-provider.test.ts` update | PASS | `@@index(where: |`, `@@index(expression: |`, `@@check(expression: |` offer exactly one `sql` item with documentation; `@@check(` snippet; no-data-types source still completes model and field attributes. |
| `semantic-tokens.test.ts` | PASS | `keyword` for `sql`, one `string` token per line; namespaced tag gives `namespace`. |
| New journey `sql-expression-literals.e2e.test.ts` | PASS | Read the test; emit, plan, apply, verify, infer, emit inferred, verify, re-infer equal. Passed in `wip/2b-cd/integration.log`, before the merge (F01). |
| `infer-roundtrip-fidelity*` and `sign-the-database` updates | PASS | Assertions expect `sql` literals. Passed in `wip/2b/integration.log`, before the merge (F01). |

### Carried over from slice 2a

| Item | Verdict | What I read or ran |
| --- | --- | --- |
| `sqlTextReadsBack` next to its caller, with the listed tests; `canonicalizeTaggedLiteralBody` exported from `authoring` | PASS | `sql-expression.ts`, `sql-expression.test.ts` (all eight cases), `exports/authoring.ts`. |
| Check ADR numbering before ADR 260 | PASS | Three files numbered 255; 256 to 259 taken; ADR 260 used, no "ADR 256" reference left in code, docs, design or plan. |
| Subsystem doc 6: `` @@index(where: sql`...`) `` example | PASS | Section "Template-Tagged Literals". |

### Carried over from slice 2t

| Item | Verdict | What I read or ran |
| --- | --- | --- |
| `defaultFunctionRegistry` on the context; `ControlDefaultRegistries` deleted | PASS | No reference left outside the fragments; ADR 249 updated. |
| `@default` literal arms yield written scalars with spans; old helpers gone | PASS | `written-scalar.ts`, `psl-column-resolution.ts`, `data-type-default.ts`; default diagnostics unchanged; grep clean. |
| Wording of a number of the wrong size | NOT VERIFIED | Not done; deferred because no number-typed place ships. Open in `status.md`. |
| `dataTypeValue` doc comment cites ADR 260 and names attribute arguments | PASS | `data-type-value.ts` line 27. |
| Rewrite checked for read-back | PASS | `rewriteAsTaggedLiteral`; combinator test; manual QA case 38. |
| Mongo provider forwards data types | PASS | Mongo `block-spec-context.test.ts`. |
| `write no written form` worded as a pack bug if hit | PASS | No place in this slice can hit it. |

### Done conditions

| Item | Verdict | What I read or ran |
| --- | --- | --- |
| `pnpm build` | PASS | At HEAD (`wip/2b-review/build.log`). |
| `pnpm typecheck` | PASS | At HEAD (`wip/2b-review/typecheck.log`). |
| `pnpm test:packages` | NOT VERIFIED | Passed before the merge except the three known tarball tests (`wip/2b-cd/test-packages.log`); I ran only the affected packages at HEAD (F01). |
| `pnpm lint` | NOT VERIFIED | Passed before the merge (`wip/2b-cd/lint.log`); not re-run (F01). |
| `pnpm lint:deps` | PASS | At HEAD. |
| `pnpm lint:casts` | PASS | At HEAD, delta 0. |
| `pnpm lint:throws` | PASS | At HEAD, delta 0. |
| `pnpm check:error-reference` | PASS | At HEAD, 361 codes; the print refusal is listed. |
| Integration files alone | PASS | Before the merge (`wip/2b/integration.log`, `wip/2b-cd/integration*.log`); see F01. |
| `pnpm fixtures:check`, no `contract.json` change | PASS | At HEAD; tree clean. |
| `pnpm lint:framework-vocabulary` | PASS | At HEAD, 272 of 272. |
| `pnpm check:upgrade-coverage` | PASS | At HEAD against `origin/main`'s merge base. |
| Fragments validated by execution | PASS | Reproduced: the codemod on the merge-base files gives every committed `.prisma` rewrite. |
| Manual QA script and run | PASS | `manual-qa.md` slice 2b: 38 cases, all six places, every case expected. |
| Done-condition grep | PASS | Ran it: only Prisma 6 and 7 fixtures and ADR 126's historical example remain. |

### Project DoD bullets this slice claims

| Bullet | Verdict | What I read or ran |
| --- | --- | --- |
| Partial, expression, CHECK, policy with `using` and `withCheck`, multi-line, `EXISTS`: emit, migrate, verify, infer, emit inferred, verify, re-infer equal | PASS | The new journey. The `--` part moved to slice 1. |
| A plain string, number or boolean in any place is refused in PSL with a message that says what to write | PASS | PSL half; the TypeScript half is slice 3. |
| `pg.sql` and `sqlite.sql` refused as unknown tags | PASS | Every place's test and manual QA. |
| `@default` and the six places use the same codes | PASS | `describeRefusal` in both; codes in tests and error reference. |
| `fixtures:check` shows no `contract.json` change | PASS | At HEAD. |
| ADR 260, amended ADRs, docs, skill references in the new form; upgrade instructions with the codemod | WEAK | All present and the grep is clean, but the app fragment names the wrong superseded text (F03) and the codemod misses a policy after a commented apostrophe (F02). |
| Manual QA script for a slice that changes diagnostics | PASS | See above. |

### Counts

| Verdict | Count |
| --- | --- |
| PASS | 39 |
| FAIL | 0 |
| NOT VERIFIED | 3 |
| WEAK | 1 |

Findings: 8 (F01 to F08).
