# Slice 2b code review, round 2 (TML-3288)

Range: `d951834e1e..HEAD`, the review fixes. Code read at HEAD (`1c31e7ed47`, whose last commit touches only `projects/`). Reviewer lens: principal engineer. Decisions checked against `dispatches/2b-review-fixes-brief.md` and the deviation in `dispatches/2b-review-fixes-findings.md`. My scratch files and logs are in `wip/2b-round-2/`.

## Summary

The fixes follow the brief. Every round 1 finding has a commit, the docs read as end state, and the verification ran at the final code commit. Two defects remain, both at the edges of the new code.

The most important finding is G01. The F04 planner test hides what `migration plan` does for a policy named with `map:`. The test's third case fails on the index and the check, so it cannot show the policy's operations. The planner code plans a `DROP POLICY` and `CREATE POLICY` for such a policy. The status says "an exact-named policy plans nothing", and ADR 260 and both fragments say nothing about it.

The second is G02. `printableIndex` passes canonical text to the throwing printer without checking that it reads back. Canonicalization is not idempotent: `"\n\n(a > 0)"` becomes `"\n(a > 0)"`, which fails the read-back check. For a wire-named index with such text, `contract infer` now crashes with an internal error, where before round 2 it skipped the index.

The rest are small: a wrong stated reason for printing defaults unconditionally (G03), a copy test that will fail when the release archives the fragment (G04), and one untested codemod case (G05).

Runs, all pass: the codemod test (`node --test`, 20 tests, `wip/2b-round-2/codemod-test.log`); the Postgres target files for the planner, the guard, both infer tests, the print refusal and the policy predicates (27 tests, `wip/2b-round-2/postgres-tests.log`); a rerun of the codemod on the merge-base copies of five Supabase and RLS schemas, byte-identical to the committed files (`wip/2b-round-2/rerun/`); probes of the codemod's comment handling (`wip/2b-round-2/probe.mjs`) and of canonicalization idempotence (`wip/2b-round-2/idempotence.mjs`).

## What looks solid

- `printSqlExpressionLiteral` throws an `InternalError` for text that does not read back, and its test pins the message. Every production caller is guarded: `infer-model-blocks.ts` (index through `printableIndex`, check through `sqlTextsReadBack`), `infer-policy-blocks.ts` (policy), and in `contract print` `refuseSqlTextThatDoesNotReadBack` runs before `buildCheckAttribute`, `buildIndexAttribute` and the policy printer. The only gap is G02.
- `mapDefault` keeps printing defaults with `printTaggedLiteral`, as the deviation says. I checked the comparison: `resolvedDefaultsEqual` compares function expressions with all whitespace removed and case folded, so a default whose text canonicalization changes never reports drift. The stated reason is imprecise (G03), but the decision holds.
- `taggedLiteralTextReadsBack` sits beside `printTaggedLiteral`, is exported from `/authoring` only, and the `/control` export of `canonicalizeTaggedLiteralBody` is gone. The parser, `sqlTextsReadBack` and `contract-ts` now import from `/authoring`. The framework test covers the whitespace-only inner line, which the old SQL-family test lacked.
- The narrowed skip matches the decision. Infer always writes checks with `map:` and policies with `@@map`, so they are always exact-named and their skip is right; design section 11.2 now says so. A wire-named index is printed with canonical text. `infer-parse-emit.test.ts` emits the inferred schema and asserts with `toEqual` that the table holds only the wire-named index, with canonical `where` and the original wire name. That pins both the absence of the exact-named index and the name equality the decision asked for. The note text is pinned in full in both infer tests.
- `sqlTextsReadBack` is the one predicate in infer and print, and the note constant lives in `infer-sql-text.ts`, which both infer modules import.
- `@default` values carry `kind` (`scalar`, `list`, `function`, `member`). `lowerDefaultForField` switches on it, and the final branch narrows to `FunctionDefault` by exhaustion, so a new arm fails typecheck there. `ParsedWrittenScalar` has no `ok` field; failure is `written: undefined` with a `reason`. `writtenList` is generic over the context.
- Every `sqlAttributeSpecs` factory takes the context, and no call site passes none (`git grep` for `sqlAttributeSpecs.(model|field).x()` is empty). The extension fragment detects the old call form.
- `blockSpecContext` replaces all six former object literals (binder twice, `interpret.ts` twice, the language server twice). The `InterpretExtensionBlocksInput.dataTypes` doc comment states it must equal the binder's.
- The inverted guard test walks SQL model and field specs, Postgres model attributes, and every Postgres block spec and block attribute. It collects every `str()` argument without a fixed value, through `oneOf`, `list`, `record` and `funcCall`, and compares the set with `NOT_SQL` using `toEqual`. A new `str()` argument fails it. It does not walk `json` arguments or extension-pack attributes; see Deferred.
- `createSqlBinder` requires `defaultFunctionRegistry`; the one production caller and the four test callers pass it.
- The codemod skips `//` and `///` comments in the prefilter, in both inner scans and in `closingEnd`. My probes pass: an apostrophe in a comment inside a policy, a trailing comment with an apostrophe after an entry, a `//` inside a string (`'http://x'`), a backtick in a comment, a doc comment with quotes before a model, CRLF line endings, and a multi-line text with a trailing newline.
- The copy test compares both fragment copies with the canonical script byte for byte, and ties `printSqlLiteral` to the framework's `printTaggedLiteral` over seven texts, including backtick, double quote, backslash and multi-line forms.
- F04's wire case is real: the plan result is `success` and `await Promise.all(result.plan.operations)` equals `[]`. The exact case asserts the whole failure, with both conflicts' kind, summary and `why`.
- The print refusal test uses `expect(print).toThrow(expect.objectContaining(...))`. I checked that `@vitest/expect` applies the asymmetric matcher to the thrown error, so the test fails if `print` stops throwing or throws something else.
- The policy unknown-parameter test now asserts code, message, `sourceId` and span.

## Findings

### G01. The F04 test cannot show what the plan does for a `map:`-named policy, and the docs do not say

- Location: `packages/3-targets/3-targets/postgres/test/migrations/sql-text-canonical-planner.test.ts`, test "stops with a conflict for an exact-named index and check, and none for the policy"; `projects/sql-expression-literals/status.md` F04 bullet; ADR 260 "Consequences"; both `upgrade-instructions/pending/sql-expression-literals-psl/*/instructions.md`, section "The storage hash may change once".
- Issue: The exact case puts an index, a check and a policy in one contract. The plan fails on the index and the check, and a failure carries no operations. So the test shows only that the policy adds no conflict. It cannot show whether the policy adds operations. The code says it does: `PostgresPolicySchemaNode.isEqualTo` compares an exact-named policy's `using` byte for byte, so the policy is a `changed` finding, and `planner.ts` (about line 815) turns it into a `DropPostgresRlsPolicyCall` and a `CreatePostgresRlsPolicyCall` when destructive operations are allowed. `migration plan` allows them (`cli/src/control-api/operations/migration-plan.ts` line 128). So a user whose only change is a `map:`-named policy text gets a migration that drops and re-creates the policy. The status says "an exact-named policy plans nothing". ADR 260 names only the wire-named case and the `map:` index and check. The app fragment's "For objects with Prisma-generated names that migration has no operations" leaves the `map:` policy unstated. I read this from the code and did not run it; a test is the way to confirm it.
- Suggestion: Split the exact case into one test for the index and the check, and one for the policy alone that asserts the whole plan (I expect a success whose operations are a drop and a create of `posts_owner_read_adopted`). State the outcome in ADR 260, both fragments and `status.md`: for a policy named with `@@map`, `migration plan` writes a migration that drops and re-creates the policy with its new text.

### G02. `printableIndex` can pass text that does not read back to the throwing printer

- Location: `packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-sql-text.ts`, `printableIndex`.
- Issue: When an index's texts do not read back, `printableIndex` canonicalizes them and returns the index if its naming is wire. It never checks that the canonical texts read back. Canonicalization drops one blank first line and one blank last line, so it is not idempotent. `wip/2b-round-2/idempotence.mjs` shows `"\n\n(a > 0)"`, `"(a > 0)\n\n"`, `"\n  \n(a > 0)"` and `"\r\n\r\n(a)"` all canonicalize to text that fails `taggedLiteralTextReadsBack`. The wire-name hash collapses whitespace, so `detectIndexNaming` still returns wire, and `buildIndexAttribute` then calls `printSqlExpressionLiteral`, which throws an `InternalError`. `contract infer` crashes where, before round 2, it skipped the index with a note. Postgres's deparser does not produce such text for an index predicate or expression, so this is unlikely against a real database. But this is exactly the path the throw was added to protect, and the unit tests feed the same function synthetic schema IR.
- Suggestion: In `printableIndex`, return `undefined` unless `sqlTextsReadBack([expression, where])` holds for the canonical texts. Add a case to `infer-sql-expression-literals.test.ts` with a wire-named index whose `where` starts with two blank lines, asserting the skip note.

### G03. The reason given for printing defaults unconditionally is imprecise, and its test example changes the default's value

- Location: `packages/2-sql/9-family/src/core/psl-build/default-mapping.ts`, doc comment of `mapDefault`; `packages/2-sql/9-family/test/psl-build/default-mapping.test.ts`, test "prints an expression that would not read back unchanged, because defaults compare by parsing"; ADR 129 line 131; design section 11.2.
- Issue: The texts say defaults are "compared by parsing both sides". For an expression the Postgres default parser does not recognise, `parsePostgresDefault` returns the trimmed text, and `resolvedDefaultsEqual` compares it with all whitespace removed. That is why no drift appears. The test's example, `concat(E'a\n  \nb')`, reads back as `concat(E'a\n\nb')`: the whitespace-only line is inside a string constant, so the printed default has a different value. The plan does not see the difference, because whitespace is removed on both sides, and a database built from the inferred schema gets the other value. This behaviour predates round 2 and is a design decision; only the wording and the test's name are new.
- Suggestion: Say what is true: "a default is compared with its whitespace removed, so a canonicalization change never shows as drift". Record the known gap (whitespace inside a string constant of a default can change on infer) in ADR 129 Consequences or in the project's deferred list. Rename the test to match.

### G04. The fragment copy test fails once the release archives the fragment

- Location: `scripts/codemods/rewrite-sql-strings.test.mjs`, `describe('the pending upgrade fragments')`.
- Issue: The test reads `upgrade-instructions/pending/sql-expression-literals-psl/<copy>/scripts/rewrite-sql-strings.mjs` unconditionally. The release process (`skills-contrib/publish-npm-version/SKILL.md` step 6) moves pending fragments to `upgrade-instructions/releases/<transition>/sources/`. After that, `readFileSync` throws ENOENT and `pnpm test:scripts` fails on the release branch. Round 1 asked for the check "while they exist".
- Suggestion: Skip each copy that does not exist (`existsSync`), or list the pending directory and check every `rewrite-sql-strings.mjs` found there.

### G05. No codemod test pins a `//` inside a string

- Location: `scripts/codemods/rewrite-sql-strings.test.mjs`, `describe('rewriteSqlStrings and comments')`.
- Issue: The comment scans now treat `//` as a comment start unless a string was entered first. A text such as `using = "url LIKE 'http://%'"` works (my probe), but no test pins it, so a change to the scan order could reintroduce a silent skip.
- Suggestion: Add one case with `//` inside a quoted string in a policy entry and one in an attribute argument, each asserting the rewrite.

## Deferred

- Wording of a number of the wrong size (`pg/int4 has no cast from pg/int8; write a number`): still open in `status.md` "Still owed"; no place in this slice receives a number-typed value.
- The guard test walks `str()` only. A raw-SQL argument written with `jsonValue()`, or contributed by an extension pack such as Supabase or pgvector, is not caught. No such argument exists; a pack's own guard is the right place if one appears.
- `taggedLiteralTextReadsBack` checks that the text is unchanged by canonicalization, which is stricter than "prints and reads back": `"\n(a > 0)"` round-trips through `printTaggedLiteral` but fails the check. The error is on the safe side (skip or refuse more often). Fixing G02 does not depend on it.
- The `--` wire-name exception and the `--` journey case: slice 1 (TML-3287).
- A13, the shared data type registration: slice 3, recorded in `plan.md`.

## Already addressed

| Finding | Fixing commit | Matches the decision |
| --- | --- | --- |
| A01 | `4c90654da5` | Yes, plus the `mapDefault` deviation; see G02 |
| A02 | `497209f40c` | Yes |
| A03 | `4c90654da5`, docs `4efec97f02` | Yes |
| A04 | `4efec97f02` | Yes |
| A05 | `4efec97f02` | Yes |
| A06 | `4efec97f02` | Yes |
| A07 | `4efec97f02` | Yes |
| A08 | `90190cf9a7`, export `e939a94d03` | Yes |
| A09 | `90190cf9a7` | Yes; `ok` dropped in favour of `written: undefined` with `reason` |
| A10 | `6a58f2cb99` | Yes |
| A11 | `37c3962d16` | Yes |
| A12 | `6fab1b5d6b` | Yes |
| A13 | `e9a8124b6e` | Yes, deferred to slice 3 in `plan.md` |
| A14 | `4c90654da5` | Yes |
| A15 | `d5739ced03` | Yes; see G04 |
| A16 | `ddc6f1fa63` | Yes |
| A17 | `4efec97f02` | Yes |
| F01 | `8b193d9332`, `affe4190da` | Yes |
| F02 | `d5739ced03` | Yes |
| F03 | `4efec97f02` | Yes; line 79 of the rc.11 to rc.12 source holds the quoted example |
| F04 | `fcaf9e4457`, docs `4efec97f02` | Partly; see G01 |
| F05 | `2d0cfa1041` | Yes |
| F06 | `2d0cfa1041` | Yes |
| F07 | `4c90654da5` | Yes |
| F08 | none | Yes, nothing in code as decided; the pull request does not exist yet |

## Acceptance-criteria verification

### Round 1 WEAK and NOT VERIFIED items

| Item | Verdict | What I read or ran |
| --- | --- | --- |
| `pnpm test:packages` at HEAD | PASS | `wip/2b-review-fixes/test-packages.log`, finished 21:36, after the last code commit (21:17). 7 files fail: the 3 known tarball tests and 4 timeouts under load, which pass alone (`rerun-failed.log`). |
| `pnpm lint` at HEAD | PASS | `lint.log`, 102 of 102 tasks, after the last code commit. |
| Integration files at HEAD | PASS | `integration.log`, 60 files, 982 tests, 21:38. |
| Wording of a number of the wrong size | NOT VERIFIED | Still deferred; no number-typed place ships. |
| ADR 260, amended ADRs, docs and upgrade instructions with the codemod | WEAK | F02 and F03 fixed and verified; the `map:` policy outcome is missing (G01). |

### Decisions

| Decision | Verdict | What I read or ran |
| --- | --- | --- |
| A01: the printer throws; one predicate; skip and refuse stay | WEAK | Throw and message tested; every caller except `printableIndex` checks first (G02). |
| A01 deviation: `mapDefault` prints unchecked | PASS | `printTaggedLiteral(SQL_EXPRESSION_TAG, …)`, pinned by a test; reason worded imprecisely (G03). |
| A02: one tag-agnostic predicate, `/authoring` only | PASS | `tagged-literal.ts`, `exports/authoring.ts`, `/control` export removed, importers updated, fragment entry added. |
| A03: skip only exact-named; note; tests; docs | PASS | `printableIndex`; checks and policies are always exact in infer; note pinned in full; absence and name equality pinned in `infer-parse-emit.test.ts`; ADR 129, ADR 260, design 11.2, app fragment, error reference. |
| A04, A05, A06, A17 | PASS | ADR 129 line 131; ADR 260 lines 67, 76, 86-87, 145, References. |
| A07 | PASS | ADR 231 `writtenScalar`/`writtenList` paragraph; editor tooling brief. |
| A08, A09 | PASS | `DefaultArgValue` discriminated by `kind`; `ParsedWrittenScalar` without `ok`; generic `writtenList`; design section 7.1. |
| A10 | PASS | Every factory takes the context; ADR 249 says so; no bare call left. |
| A11 | PASS | Six sites call `blockSpecContext`; doc comment on `dataTypes`. |
| A12 | PASS | The set comparison fails on any new `str()` argument. |
| A13 | PASS | One line under slice 3 "Carried over" in `plan.md`. |
| A14 | PASS | Note text in `infer-sql-text.ts`. |
| A15 | WEAK | Byte identity and printer tie tested; the test breaks at release (G04). |
| A16 | PASS | Required parameter; all callers pass it. |
| F01 | PASS | See the first table. |
| F02 | PASS | Both scans skip comments; three named tests plus a multi-line case; I reran the codemod on five merge-base schemas, identical. |
| F03 | PASS | App fragment names the `to_tsvector` example. |
| F04 | WEAK | Wire case pinned (no operations); `map:` index and check pinned (conflict); `map:` policy not shown and not documented (G01). |
| F05, F06 | PASS | Whole assertions. |
| F07 | PASS | One predicate, `sqlTextsReadBack`. |
| F08 | PASS | Nothing in code, as decided. |

### Counts

| Verdict | Count |
| --- | --- |
| PASS | 21 |
| FAIL | 0 |
| NOT VERIFIED | 1 |
| WEAK | 4 |

Findings: 5 (G01 to G05).
