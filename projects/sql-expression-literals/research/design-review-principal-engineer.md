# Principal-engineer review: SQL expression literals (design and plan)

Reviewed `spec.md`, `design.md`, `plan.md` and `design-notes.md` against the code at `6a5b58ecb7` and the open pull requests on 2026-09-24. Findings from `wip/sql-expression-literals/review-design.md` and `review-design-2.md` are not repeated.

## Summary

The mechanisms hold up against the code: wire names cannot drift, the printers and renderers round-trip, and the DDL change is byte-identical where it should be. The largest risk is outside the documents: open PR #30381 replaces the block-parameter layer that section 9 extends, so the order of the two must be settled before slice 2 starts. After that, the one silent failure that needs a decision is that moving a line break around a `--` comment does not change an object's wire name.

## What looks solid

- Typing the value fixes the policy bug at its cause, and it reuses the ADR 254 cast rule instead of adding a syntax check.
- Canonicalization cannot change a wire name. It only removes whitespace, and `normalizeSqlBody` trims and collapses whitespace before hashing (`packages/2-sql/1-core/schema-ir/src/naming.ts:125`). I checked each step of `canonicalizeTaggedLiteralBody`.
- The site table in design §14.3 matches the code. A grep for templates that paste SQL into `CHECK (`, `USING (`, `WITH CHECK (`, `WHERE (`, `DEFAULT (` and `USING ` finds exactly those sites. `renderEmbeddedSql` returns text without `--` unchanged.
- The escape sets match. `printTaggedLiteral` escapes exactly what `resolvePslBacktickEscapes` resolves, and `renderTaggedTemplateSource` escapes exactly what `resolveTemplateTagEscapes` resolves (`\`, `` ` ``, `$`). Because it falls back to a string literal whenever canonicalization would change the text, a generated migration file cannot silently change SQL.
- As far as I can tell, Postgres's own reprints read back unchanged. `pg_get_expr` never indents its first line, so the common indent is zero even when it prints an `EXISTS (SELECT … FROM … WHERE …)` predicate over several lines.
- Only one copy of the `SqlExpression` class is loaded: each public shell bundles an internal package once (`packages/0-config/tsdown/shell-build.ts`). `Symbol.for` covers two installed versions at run time. Because it is a class, `isColumnDefaultLiteralInputValue` rejects it.
- `migrate` reads only `ops.json`. So slice 4 cannot affect how committed migrations apply, and downgrading the package does not strand the ops of a newly generated file.
- In slice 2, the refusal, the printers and the Supabase regeneration land in one dispatch, which satisfies F30. The regeneration runs the real generator against PGlite. `fixtures:check` then proves that about 70 reprinted bodies stay byte-identical.
- SQLite already refuses expression and partial indexes (`packages/3-targets/3-targets/sqlite/src/core/sqlite-unbound-database.ts:98-120`), so admitting `sql` literals there hides nothing.
- The slice 3 parity fixture uses indented multi-line bodies, quoted identifiers and a backslash. That is the right test for requirement 4.

## Findings

**F01. Section 9 builds on block-parameter types that open PR #30381 deletes.**
Location: design §9.1–9.6, §17.1 (hand-built value nodes), §19 (slice 2 extension changes); plan slice 2 tests `psl-extension-block-typing.test.ts` and `symbol-table.test.ts`; PR #30381, "Generic block values bind the shared typed expression grammar" (open, review required, conflicts with `main`, updated 2026-09-24).
Issue: #30381 removes `PslBlockParam*`, the `PslExtensionBlockParam*` union, `psl-extension-block-validator.ts`, `validateExtensionBlockFromSymbol`, the printer's codec reparse, and Postgres's `readValueParam` and `unwrapQuotedString`. It types block values with attribute combinators inside `fixedBlock` specs. Policy predicates become `optional(str())` and `permissive` becomes `optional(bool())`. It also edits ADR 126, ADR 231, the error reference, the language server, the Mongo provider, `contract-psl/src/interpreter.ts`, `psl-column-resolution.ts`, `sql-attribute-specs.ts`, `spec-context.ts`, the Postgres `authoring.ts`, `infer-policy-blocks.ts` and the Supabase generator. Slice 2 edits all of these. The design does not mention the PR.
Why it matters: whichever PR lands second has to redo the other's work. If #30381 lands second and keeps `optional(str())`, policies accept plain strings again and refuse `sql` literals, which reverses DoD item 4 for policies. If this project lands second, sections 9.1–9.4 and 9.6 are thrown away.
Fix: agree the order with the author of #30381 before slice 2 starts. Landing #30381 first is better. Section 9 then becomes one change: the policy block spec declares `using` and `withCheck` as `optional(dataTypeValue(SQL_EXPRESSION_DATA_TYPE_ID, support))`, and `BlockSpecContext` gets the data type support the way §7 adds it to `AttributeSpecContext`. That removes `typeExtensionBlockValue(s)`, `written`, `typedValues`, the validator change, three extension upgrade entries and two test files. It also gives policies the same code path and messages as `@@index(where:)`. If the order has to be the other way round, write into the plan that the rebase of #30381 must switch the predicates to `dataTypeValue`. `psl-policy-sql-literals.test.ts` is then the test that catches a missed switch.

**F02. Where a line break sits relative to a `--` comment is not part of an object's identity.**
Location: spec requirement 5 and the non-goal "Changing how … are compared"; design-notes decision 9; `packages/2-sql/1-core/schema-ir/src/naming.ts:125-127`, used for checks (`:143`), indexes (`:255-256`) and policies (`packages/3-targets/3-targets/postgres/src/core/authoring.ts:228-231`, `rls/canonicalize.ts:41-42`).
Issue: `normalizeSqlBody` turns every run of whitespace, including a line break, into one space. So `a -- note⏎OR b` and `a -- note OR b` get the same wire name, but in the second one `OR b` is part of the comment. Today bodies are single-line strings, and a `--` on the last line breaks the DDL, so nobody writes line comments. This project makes multi-line bodies the normal form, and slice 1 makes line comments work. That makes this case reachable.
Why it matters: a realistic fix is silently dropped. Say a user notices that `-- owner check OR is_admin()` has swallowed a clause, and fixes it by breaking the line. The wire name stays the same, so `migration plan` sees no change to the policy. The database keeps the old predicate, and `db verify` reports clean. For RLS, that is an access rule that never reaches the database.
Fix: when a body contains `--`, make `normalizeSqlBody` keep line breaks. It still collapses other whitespace, including whitespace around each line break. Single-line bodies hash exactly as today, so no committed wire name changes. Only a body that already has both `--` and a line break gets a new suffix, and the planner handles that as a rename or a recreate. This goes against a stated non-goal, so Will has to decide. If he keeps the non-goal, document the hazard in ADR 234, ADR 129 and the `sql` literal docs.

**F03. No planned test covers DoD item 1, and its wording cannot be met as written.**
Location: spec Project DoD item 1; plan slice 2 tests (updates to `infer-roundtrip-fidelity*.e2e.test.ts` and `sign-the-database.e2e.test.ts`); the slice 3 parity fixture.
Issue: the infer journeys start from a database built with SQL, and every committed fixture is single-line. The parity fixture has multi-line bodies, but it only compares PSL emission with TypeScript emission. No planned test writes a multi-line `sql` literal, migrates it, verifies it, infers it back and emits again. Also, infer prints Postgres's reprint under `map:` (`packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-index-attributes.ts:79-94`, `infer-policy-blocks.ts:35-38`). So the contract emitted from inferred PSL never equals the authored contract byte for byte.
Why it matters: the main behaviour of the project, multi-line SQL end to end on real Postgres, has no test. Real databases with `EXISTS (SELECT …)` policies are where infer will print multi-line `sql` literals, and nothing tests that case either.
Fix: add one journey in slice 2, for example `test/integration/test/cli-journeys/sql-expression-literals.e2e.test.ts`. Author a partial index, an expression index, a CHECK and a policy with `using` and `withCheck`. Make one body multi-line, end one with a `--` comment, and give one policy an `EXISTS (SELECT … FROM … WHERE …)` predicate. Emit, plan, apply and verify clean. Then infer, and assert that every body prints as a `sql` literal. Emit the inferred schema, verify it clean against the same database, infer again, and assert the PSL is identical. Reword DoD item 1 to say that, since the second infer's output matching the first is the property that can actually hold.

**F04. Some Postgres reprints can no longer be written in PSL, and infer does not warn.**
Location: design §11.2, last bullet; `packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts` (canonicalization turns CR into LF and empties whitespace-only lines); `packages/3-targets/3-targets/postgres/src/core/migrations/issue-planner.ts:853-880` (an exact-named check that differs gives a conflict); `planner.ts:644-700` (an exact-named policy that differs is dropped and recreated).
Issue: every PSL form of a `sql` literal is canonicalized, including `sql"..."`. So a reprint that holds a carriage return, or a whitespace-only line, inside a string constant reads back changed. Today a plain string represents it exactly. The design says Postgres's reprints do not have these shapes. That is true of Postgres's own formatting, but string constants are printed verbatim.
Why it matters: for an adopted (`map:`) object, the contract text then never matches the database. A check gives a planner conflict on every plan. A policy is dropped and recreated on every plan, or is blocked when destructive operations are not allowed. No PSL syntax lets the user fix it.
Fix: in the infer printers, check that `canonicalizeTaggedLiteralBody(body)` returns `body` unchanged. When it does not, skip the object with a note that names the reason, the way `buildPolicyBlocks` already skips policies with unprintable roles (`infer-policy-blocks.ts:84`). Prove it with a unit test on a CHECK that contains `E'a\r\nb'`.

**F05. The claim that nothing stored changes is incomplete, and the user-visible effect is not written down.**
Location: spec requirement 5; design-notes decision 1 ("tested in the PSL slice"); plan slices 2 and 3; design §19.
Issue: leading whitespace is not the only change. Canonicalization also changes a body with a blank first or last line (for example a trailing `\n`), CRLF line breaks, whitespace-only inner lines, or common indentation. In TypeScript, that is the normal shape of a multi-line template string, and slice 3 starts canonicalizing those. Wire names stay the same (see What looks solid). The stored text, and so the storage hash, change. Design-notes decision 1 says the PSL slice tests this claim, but the plan has no such test.
Why it matters: a changed storage hash is a new node in the migration graph. Affected users must plan and apply a migration with no operations before `migrate` and `db verify` agree, and nothing tells them why.
Fix: correct requirement 5 so it lists these shapes. Add a unit test that computes each kind of wire name from a non-canonical body and from its canonical form, and asserts they are equal. It fails if the hash input stops being trimmed. In both app fragments, add: "If a body had indentation, blank first or last lines, or CRLF line breaks, the contract's storage hash changes once. Run `migration plan` and commit the resulting migration, which has no operations."

**F06. TypeScript authors can no longer compose SQL, and the published constructor becomes the workaround.**
Location: design §2 (`sql` refuses interpolation; the `SqlExpression` constructor is published through `@prisma/orm-family-sql/contract/sql-expression` but "not documented"); `research/ts-builder.md:636,724`.
Issue: today TypeScript contracts build predicates from parts. The repo's own `test/integration/test/rls-ts-walking-skeleton.integration.test.ts:80` builds `EDITED_PREDICATE` from `OWNER_PREDICATE` by interpolation. After slice 3 the documented API cannot do that. The workaround users can reach is `new SqlExpression(text)`, which skips canonicalization. A multi-line body built that way stores different text from the same body written in PSL, which breaks requirement 4 without any error.
Why it matters: generating policies per model is a main reason to use the TypeScript builder, and users will find the constructor.
Fix: either let the tag interpolate other `SqlExpression` values only, joining their bodies before canonicalization and still refusing strings (`` sql`${OWNER} AND deleted_at IS NULL` ``), or make the constructor private to the module and export a `sqlFromText(text)` that canonicalizes. Record the choice in design-notes decision 7.

**F07. The check on committed migration files exercises only two of the widened functions.**
Location: plan slice 4, last test; design §16.1.
Issue: `examples/prisma-8-demo/migrations/app/20260422T0720_initial/migration.ts` passes strings only to `fn` and `checkExpression`. The string forms of `createIndex` `where`, `addCheckConstraint`, `createRlsPolicy` and `alterColumnType` `using` are never run. The conversion code for `extras.where` and the policy predicates is where a dropped field would hide, because `exactOptionalPropertyTypes` forces conditional rewrites there.
Why it matters: this is the half of DoD item 3 that users cannot recover from, because committed migration files are never regenerated.
Fix: also name `examples/prisma-8-demo/migrations/app/20260922T1218_add_post_title_search/migration.ts`, which calls `createIndex({ expression: string })`. Add a test to `packages/3-targets/3-targets/postgres/test/postgres-migration-op-builders.test.ts` that calls each of the four methods and two factories once with strings and once with `sql` values holding the same text, and asserts identical ops. It fails if either form drops or changes a field.

**F08. Two DoD items have planned tests that prove less than the item claims.**
Location: plan slice 2 tests for `psl-full-text-index.test.ts` and `psl-policy-sql-literals.test.ts`; plan slice 3 `raw-sql-fields.test-d.ts`; spec DoD items 4 and 8.
Issue: for `@@fullTextIndex(where:)`, the plan asserts only that a plain string is refused. It does not assert the message, and it does not try a number or a boolean. The policy test has no number. The type tests try only strings. For DoD item 8, nothing checks that docs and skills no longer use the old forms. For example, `packages/1-framework/2-authoring/psl-parser/src/syntax/ast/expressions.ts:203` still says `pg.sql` and is not in design §18.
Fix: assert the exact message and add a number and `true` in both PSL tests. Add a number and a boolean to one field in the type test, plus a `not.toBeAny()` check on `ReturnType<typeof sql>`, as the non-vacuous verification rule asks. Add a grep to the done conditions of slices 2 and 3. It must find no `where: "`, `expression: "`, `using = "`, `withCheck = "` or `pg.sql`/`sqlite.sql` in `docs/`, `skills/`, `skills-contrib/`, package READMEs or `src/` comments, excluding `CHANGELOG.md`, `docs/releases/` and `skills/prisma-8/upgrading/**/upgrades/`.

**F09. Slice 2 is too large for one review, and dispatch (b) holds most of it.**
Location: plan slice 2 (design §§2–13, 17, 18, 19); the dispatch order (a), (b), (c).
Issue: slice 2 does all of this:
- changes the framework authoring SPI (lowering entries);
- moves the cast rule into the framework;
- adds a parser combinator and a block typing layer;
- rewires `@default` and the six places;
- rewrites two infer printers and the generic tagged-literal printer;
- changes three language server features;
- regenerates the Supabase contract;
- updates about 25 test files and several journeys;
- amends nine docs;
- ships two fragments with ten change ids.

`drive/calibration/sizing.md` names a slice that makes the reviewer read three unrelated areas as mis-sized. The F30 order holds, because the refusal, printers and regeneration share dispatch (b). But (b) also carries registration, `@default` and the language server, and F30 does not require any of those to be there.
Why it matters: a tired reviewer on a PR that changes the extension SPI and every committed contract source is how defects get through.
Fix: split slice 2 into two PRs.
- 2a, "`sql` is a data type": design §3, §4, §10, the default half of §11, and the two `pg.sql` fixture edits. It carries the extension changes `the-sql-lowering-entry-is-a-data-type` and `unknown-literal-tag-code-renamed`, and the app change `prefixed-sql-tags-are-removed`. It leaves `contract.json` unchanged and has no other F30 exposure.
- 2b, "the six places take `sql` literals": §§5–9, the index, check and policy printers in §11.2, §12, §17 and the rest. Keep the refusal, printers and regeneration in one dispatch, and move the language server to its own dispatch after it.

Once F01 is settled, 2b gets smaller still.

**F10. The slice done conditions leave out checks that CI and the team DoD run.**
Location: plan "Done when" for slices 1–4; `drive/calibration/dod.md` (lint on every dispatch, QA items, `test:e2e` when the migrate cycle changes); root `package.json` (`lint`, `lint:casts`, `test:e2e`); `scripts/lint-framework-vocabulary.mjs`.
Issue:
- No slice lists `pnpm lint` (biome, see F14 in `failure-modes.md`) or `pnpm lint:casts`.
- Slices 1 and 4 change the migrate path but do not list `pnpm test:e2e`.
- No slice has a `drive-qa-plan` script or QA run. Slices 2 and 3 change user-facing diagnostics, and the QA section of `failure-modes.md` names error-message quality as exactly what automated tests miss.
- "`lint:framework-vocabulary` (threshold not raised)" is the wrong condition. The script fails when the count goes down as well, so a slice that removes a counted site must lower the threshold.

Fix: add `pnpm lint` and `pnpm lint:casts` to every slice, and `pnpm test:e2e` to slices 1 and 4. Add a QA script to each slice that reads the new messages as a user would. Reword the vocabulary condition to "the count equals the committed threshold; lower the threshold if the slice removed sites".

**F11. The upgrade fragments have gaps in detection, audience and supersession.**
Location: design §19; `upgrade-instructions/pending/postgres-full-text-search/app/instructions.md:54,68`; `packages/1-framework/2-authoring/psl-parser/src/tokenizer.ts:195`.
Issues and fixes:
- PSL strings may use `"`, `'` or `` ` `` (`QUOTES`), but the detection patterns match only `"`. They miss `where: 'x'` and an untagged `` where: `x` ``. Match any of the three quotes, with no tag before it.
- `policy-permissive-is-a-boolean-literal` describes a form that is already refused. Today `permissive = "false"` fails the raw `'true'`/`'false'` comparison (`packages/3-targets/3-targets/postgres/src/core/authoring.ts:291-301`). Drop the change, or say only that the diagnostic code changed.
- Extension authors who ship their own `.prisma` or TypeScript contract spaces need the PSL and TypeScript rewrite too. The extension fragments only carry `supabase-contract-writes-sql-literals` and `policy-handles-hold-sql-values`. The skill says to copy a change that affects both audiences into both.
- The pending `postgres-full-text-search/app` fragment teaches `fullTextIndex(cols.text, { where: 'archived_at IS NULL' })` and `@@index(expression: "to_tsvector(…)")`. If both land in one release, the assembled guide contradicts itself. Name it as superseded in the slice 2 and slice 3 fragments.
- A codemod is cheap and has precedent: `skills/prisma-8/upgrading/extension/upgrades/0.13-to-0.14/uuid-preset-rename.ts`, and step 4 of the skill allows colocated `tsx` scripts. A standalone script would find the six positions, decode the PSL string escapes, and print `` sql`...` `` (or `sql"..."` when the body has a backtick). It converts a 70-body schema in one run, and it avoids hand-conversion slips. For an adopted `map:` object, a slip only shows up at `migration plan`, as the conflict or drop-and-create described in F04.

**F12. The refusal messages put type ids before the fix.**
Location: design §6 (messages), §9.3, §13.
Issue: for `where: "(archived_at IS NULL)"`, the user reads ``sql/expression has no cast from pg/text; write a value of sql/expression as sql`...` ``. Three type ids and the word "cast" come before the instruction. For an identifier, the message is ``Expected a value of sql/expression, written sql`...` ``, which reads as a sentence fragment. Tests will pin these strings, so changing them later costs more.
Why it matters: users will see this message once per body in every schema they upgrade, which is 70 times for a Supabase-sized contract.
Fix: when the refused value is a plain string and the receiving type has a tag, end the message with the exact rewrite, printed by `printTaggedLiteral`: ``…; write sql`(archived_at IS NULL)` ``. Keep the type ids for readers who know ADR 254. Reword the not-a-literal case as ``Expected SQL written as sql`...`, got an identifier.`` Decide this before the tests pin the text.

**F13. Slice 4 costs a lot for what it delivers, and the cheaper option is not recorded.**
Location: design-notes decision 10; design §16.
Issue: to change how generated files look, slice 4 does all of this:
- widens four methods and two factories to a union type;
- adds `renderTaggedTemplateSource` with a four-way fallback;
- adds `tsObjectSource`;
- adds import tracking to five call classes.

`migrate` reads only `ops.json`, so users rarely read these files. The files still end up with two forms, because `rawSql`, `setDefault` and fallback bodies stay strings. An untagged template literal needs neither quote escaped and no API change. It is safe for single-line bodies, which is what the planner emits for everything it reprints, and multi-line bodies could keep a string literal.
Why it matters: the operator should choose this cost knowingly, not by default.
Fix: add the untagged-template option to the rejected alternatives in decision 10, with the reason for rejecting it. Or adopt it, and drop `MigrationSqlText` and the `sql` export from the migration facade. Slice 4 is last and independent, so either choice leaves the other slices unchanged.

**F14. Other open work overlaps slices 1–3, and the plan does not list it.**
Location: plan "Order"; open pull requests and branches on 2026-09-24; `research/ddl.md` §8 compared with design §17.1.
Issue: apart from #30381 (F01), these overlap:
- #30349 (binder) edits `sql-attribute-specs.ts`, `contract-psl/src/interpreter.ts` and `psl-column-resolution.ts`.
- #30315 (`contract print`) edits `interpreter.ts` and `infer-index-attributes.ts`.
- #30337 adds cases to `default-sql-body.test.ts`, which §3.3 also extends.
- Branch `fts-tsquery-argument` edits `postgres/src/core/data-types.ts`, where §3.1 appends `pgSqlExpression`.
- Branch `native-enum-not-textual` edits `3-extensions/postgres/src/contract/full-text-index.ts`, which slice 3 changes.
- #30355 adds Postgres function entities with SQL bodies and a new refusal of raw defaults. If it lands, a function body is a seventh place that holds raw SQL as a plain string, and requirement 3 says its refusal belongs in the consumer.

Within this project, slices 1 and 2 both touch `6-adapters/postgres/test/migrations/rls-migration-plan.integration.test.ts`, `rls-lifecycle-e2e.integration.test.ts` and `3-targets/postgres/test/migrations/full-text-index-planning.test.ts`. The plan's parallel-safety claim names only one shared doc, but F10 asks for every shared artefact.
Fix: list these in the plan, with who rebases each. Ask the author of #30355 to take `SqlExpression` values and `sql` literals for function bodies, or add that work to this project. Slices 1 and 2 can still run in parallel, because their source files are disjoint. Whichever merges second rebases the three test files.

## Deferred

- Empty `where`, `expression` and policy predicates render invalid DDL, such as `WHERE ()`, and fail only at migrate time. This already happens with strings, and requirement 3 keeps checks out of these places. It needs its own ticket.
- `normalizeSqlBody` also collapses whitespace inside SQL string constants, and canonicalization dedents lines inside them. That is existing ADR 234 and ADR 129 behaviour. F02 covers the one case this project newly makes reachable.
- Enforcing `required` on block parameters, and completion at block values, are spec non-goals.
- A language server quick fix that rewrites a string as a `sql` literal would be new scope: the server has no code-action support today.
- Two installed versions of `@prisma/orm-family-sql` each declare their own `unique symbol`, so a `SqlExpression` from one does not type-check against the other. This happens only with version skew, which already breaks many other types.

## Acceptance criteria

| # | Project DoD item | Planned work | Planned test | Verdict |
| --- | --- | --- | --- | --- |
| 1 | Multi-line `sql` literals in every place emit, migrate, verify, infer back and re-emit byte-identically | §§8–12, 14 | Parity fixture only compares emitted contracts; the infer journeys are single-line and start from SQL | NOT COVERED (F03; the wording also needs changing) |
| 2 | A body ending in a `--` comment migrates as CHECK, policy and partial-index predicate | §14 | Slice 1 PGlite test runs each statement | COVERED |
| 3 | New `migration.ts` writes `sql` values; an older file still applies | §16 | Exact renderer output and a round trip; the one committed file uses only `fn` and `checkExpression` | WEAK (F07) |
| 4 | String, number, boolean refused in PSL with a message naming `` sql`...` ``; do not compile in TypeScript | §§6, 8, 9, 15 | Full for index and check; full-text index is string-only with no message assertion; policies have no number; TypeScript tries strings only | WEAK (F08) |
| 5 | `pg.sql` and `sqlite.sql` refused as unknown tags | §3 | `pg.sql` refused in defaults and in the places; adapter tests pin both targets' tags to `json`, `sql` | COVERED |
| 6 | `fixtures:check` shows no `contract.json` change | §17 | A done condition of every slice | COVERED |
| 7 | The framework has no lowering-entry kind | §3.4 | Assembly test refuses an unregistered key; typecheck catches any leftover use | COVERED |
| 8 | ADRs 129 and 254 amended; ADR and skill examples use the new form; upgrade instructions recorded | §§18, 19 | `check:upgrade-coverage` proves fragments exist; nothing checks docs for old forms | WEAK (F08, F11) |
| 9 | Team DoD holds | none | No QA script; `pnpm lint` and `lint:casts` missing from done conditions | NOT COVERED (F10) |

Count: 4 COVERED, 3 WEAK, 2 NOT COVERED, 0 CONTRADICTED.

## Referrals to the architect lens

- Two diagnostic families cover the same refusal: `PSL_DEFAULT_TYPE_INCOMPATIBLE` and `PSL_INVALID_DEFAULT_LITERAL` in `@default`, and the new `PSL_VALUE_TYPE_INCOMPATIBLE` and `PSL_INVALID_LITERAL` everywhere else.
- If design §9 and PR #30381 both land, the system has two ways to type block values. This is the shape question behind F01.
- Migration files keep plain strings for `rawSql` and `setDefault(defaultSql)`, while other migration functions take `sql` values. Does "raw SQL is written one way" cover migration files?
- Should the `SqlExpression` constructor be on a published subpath at all (F06)?
- ADR 254 is amended to let a family name a data type id that targets register. Who owns such a type?
