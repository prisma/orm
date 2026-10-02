# Code review, round 2: slice 4 (TML-3290) review fixes

Range: `660f57ffd3..c74386c6d8` on `tml-3290-migration-files-template-literals`. Seven commits. Decisions checked against `wip/slice-4-review-fixes-brief.md`.

## Summary

The fixes follow every decision. The three new sites (Postgres `SetDefaultCall`, SQLite `AddColumnCall`, SQLite `RecreateTableCall` columns and postchecks) now go through `tsQuotedTextSource`. For every input that does not hold both quote kinds, their output is byte for byte what it was before. The fallback rule is correct for every code point I tried. The executed round trip now covers a backslash, a backtick and `${` in one text.

One design point needs a change before merge (G01). The new renderers list each field by hand. Before, `jsonToTsSource(object)` printed every field. Now a field added to `SqliteColumnSpec`, `SqliteTableSpec` or the policy literal type compiles but is silently missing from `migration.ts`. The rest are small test gaps and a note on DEL.

## What looks solid

- Byte identity of the layouts. `tsArraySource` is the old array branch of `jsonToTsSource` plus one extra condition: it goes multi-line when the single-line form holds `\n`. For items that `jsonToTsSource`, `tsObjectSource` or `tsArraySource` produce, that condition never changes the result. An item is multi-line only when its own single-line form is over 80 characters, and its multi-line form is longer still, so the outer single-line form is already over 80. Indentation (only the first line of a nested item is indented), the `,\n` separator and the trailing comma are unchanged. The ts-render tests pass (2 files, 35 tests, run by me).
- Field order matches the planner. `columnSpecFromNode` builds `name, typeSql, defaultSql, nullable, inlineAutoincrementPrimaryKey?`; `tableSpecFromNode` builds `columns, primaryKey?, uniques, foreignKeys`; `buildRecreatePostchecks` builds `description, sql`. The renderers use the same order and omit only `undefined`, as `jsonToTsSource` did. `inlineAutoincrementPrimaryKey: false` still renders.
- No committed file can change. No committed `migration.ts` calls `recreateTable`, `setDefault`, or anything from the SQLite target, so neither the SQLite change nor the `setDefault` change can alter a committed file. `wip/s4-fixes/status-after.log` is empty. Note that `migrations:regen:examples` regenerates only Postgres and Mongo examples, and it runs committed files rather than rendering them (as F06 said), so its clean result is not evidence for SQLite. The evidence is that no SQLite file exists.
- The fallback loop. `for (const char of text)` walks code points, so a valid pair has a code point at or above U+10000 and does not fall back, while a lone high or low surrogate yields a code point in D800 to DFFF and does fall back. I checked against the built `dist`: every ASCII code point falls back exactly when it is below U+0020 or is U+007F; a lone high surrogate, a lone low surrogate and a reversed pair fall back; an emoji stays a template; and `eval` of every output equals the input.
- The executed round trip (F05). The Postgres check `"email" !~ '\d' AND "email" <> '`${x}'` holds both quote kinds, a backslash, a backtick and `${`. The test asserts the written template, executes the file with `tsx`, and asserts `ops` equal `renderOps(calls)`. A wrong escape would fail both checks.
- The policy renderer now reads `input.using` and `input.withCheck` directly. There is no key comparison and no `typeof`.
- The doc paragraph is under Planner IR, beside the two renderer bullets. Its claim that the planner never writes the `USING` of `alterColumnType` is true: all three planner constructions pass only `qualifiedTargetType`, `formatTypeExpected` and `rawTargetTypeForLabel`.

## Findings

### G01. Hand-listed fields break the link between the spec types and the rendered file

- Location: `packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts` lines 705 to 735 (`renderColumnSpec`, `renderTableSpec`, `renderPostcheck`); `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts` lines 1786 to 1812 (`CreatePostgresRlsPolicyCall.renderTypeScript`).
- Issue: Before this round, `jsonToTsSource(this.column)`, `jsonToTsSource(args)` and `Object.entries(input)` printed every field the object had. Now each renderer names its fields. If a field is added to `SqliteColumnSpec`, `SqliteTableSpec`, the postcheck shape or `RenderedRlsPolicyLiteral`, the code still compiles and the field is missing from `migration.ts`. The executed file then builds a different op from the one in `ops.json`, and nothing fails unless a round-trip fixture happens to set the new field. This is likely, not hypothetical: the comment at `ddlColumnFromNode` says a SQLite-specific column option is planned (TML-2866). In the policy renderer, the comment "a drift between the renderer and the API is a compile error here" is now only half true. `input` must still match the type, but the list below it is free to skip a key.
- Suggestion: Make a missing key a compile error. Build each entry list from an object literal typed against the spec, for example `const sources: { readonly [K in keyof SqliteColumnSpec]-?: string | undefined } = { name: …, typeSql: …, defaultSql: tsQuotedTextSource(column.defaultSql), nullable: …, inlineAutoincrementPrimaryKey: column.inlineAutoincrementPrimaryKey === undefined ? undefined : jsonToTsSource(…) }`, then pass its entries with `undefined` filtered out to `tsObjectSource`. Key order follows the literal, so output stays identical. Do the same for the table spec, the postcheck and the policy literal. Severity: medium.

### G02. The DEL fallback still writes a raw DEL

- Location: `packages/1-framework/1-core/ts-render/src/ts-string-literal.ts`, `tsQuotedTextSource` and `tsStringLiteral`.
- Issue: The decision makes U+007F fall back to `tsStringLiteral`, which F03 proposed so the character would appear as a visible escape. But `JSON.stringify` does not escape U+007F, so the string literal holds the same raw, invisible DEL as the template would have. The test confirms this: its expected value contains a raw DEL. The same is true of C1 controls (U+0080 to U+009F), which stay raw in a template. Output is correct either way; only the readability goal is not met for DEL.
- Suggestion: No change this slice, since the decision is settled and `tsStringLiteral` also feeds the contract emitter. Record a follow-up in the project's `deferred.md`: escape U+007F (and possibly C1 controls) in `tsStringLiteral`, checking emitter fixtures. Severity: low.

### G03. Two behaviours of the fallback rule have no test

- Location: `packages/1-framework/1-core/ts-render/test/ts-string-literal.test.ts`; `packages/1-framework/1-core/ts-render/test/json-to-ts-source.test.ts`.
- Issue: No test shows that a valid surrogate pair (an emoji) with both quote kinds stays a template literal. If the loop were rewritten to walk UTF-16 units with `charCodeAt`, every emoji would fall back and all tests would stay green. Only a lone high surrogate is tested; a lone low surrogate is not. The `\n` condition in `tsArraySource` is not tested either (the matching condition in `tsObjectSource` is).
- Suggestion: Add three short cases: `"a" = '😀'` expects a template; `"a" = '\udc00'` expects a string literal; `tsArraySource(['[\n  1,\n]'])` expects the multi-line form. Severity: low.

## Deferred

- G02's change to `tsStringLiteral`: it changes output shared with the contract emitter, so it belongs in its own change.
- The two committed Postgres files F06 named keep their escaped quotes until they are scaffolded again. Decided in round 1 (F06: nothing to change).

## Verification notes

- No red log exists for the Postgres `SetDefaultCall` test or the round-trip additions. Read against the old code, each fails: the old `SetDefaultCall` wrote `"DEFAULT '{\"a\": 1}'::jsonb"`, and the old SQLite renderers wrote escaped quotes, so every new `toBe` and `toContain` would fail.
- `wip/s4-fixes/ts-string-literal-red.log` shows the tab, NUL, DEL and lone-surrogate tests failing before the fix. `wip/s4-fixes/sqlite-op-factory-call-red.log` shows the two new SQLite tests failing; its third failure (`dataTransform`) is a 500 ms timeout, not related.
- `wip/s4-fixes/test-packages-tip.log` is the package run still in progress. It shows four Postgres round-trip tests failing, each after about 8,050 ms. The `typeScriptCompilation` timeout is 8,000 ms, and one of the four is the empty-calls test that this change does not touch, so these look like load timeouts. The isolated run (`wip/s4-fixes/adapter-postgres-roundtrip-fix.log`) passed 5 of 5. CI must confirm.

## Already addressed

| Round 1 | Fixing commit | Matches the decision |
| --- | --- | --- |
| A01 | `fb85cb7256`, `ddd4a7275b`, `f5b63b54ed` | Yes |
| A02 | `fb85cb7256` | Yes, but see G01 |
| A03 | `66e074e895` | Yes, uses the "except … plus …" wording |
| A04 | `7f8d84b501` | Yes |
| F01 | `fb85cb7256`, `ddd4a7275b` | Yes |
| F02 | `02b0eade6f` | Yes |
| F03 | `02b0eade6f` | Yes (tab now falls back too, as decided) |
| F04 | `fb85cb7256` | Yes, but see G01 |
| F05 | `f5b63b54ed`, `c74386c6d8` | Yes |
| F06 | none needed | Yes |

## Acceptance-criteria verification

| Decision | Verdict | Evidence |
| --- | --- | --- |
| A01/F01: three sites through `tsQuotedTextSource` | PASS | Postgres line 682; SQLite lines 715 and 733 |
| A01/F01: SQLite objects built with `tsObjectSource` | PASS | `renderColumnSpec`, `renderTableSpec`, `renderPostcheck` |
| A01/F01: one exact-output test per site | PASS | `op-factory-call.lowering.test.ts` `SetDefaultCall`; SQLite `AddColumnCall` and `RecreateTableCall` tests |
| A01/F01: JSON default in both round trips | PASS | Postgres `SetDefaultCall` with `'{"a": 1}'::jsonb`; SQLite `addColumn` and `recreateTable` |
| A01/F01: output unchanged for existing inputs | PASS | Layout argument above; no committed file affected |
| F02/F03: fallback for C0, DEL, lone surrogate, U+2028/9 | PASS | Code and my probe of every ASCII code point and the surrogate cases |
| F02/F03: rule stated in doc comment | PASS | `tsQuotedTextSource` doc comment |
| F02/F03: tests for NUL, lone surrogate, tab | WEAK | Present and red before the fix; no valid-pair or low-surrogate test (G03) |
| A02/F04: direct reads, no key comparison, no `typeof` | PASS | Lines 1806 to 1809; G01 is a separate concern |
| A03: paragraph under Planner IR, list consistent | PASS | Doc line 125; `USING` exception verified true |
| A04: header comment updated | PASS | `json-to-ts-source.ts` lines 17 to 19 |
| F05: executed round trip with `\`, backtick and `${` | PASS | Postgres round trip asserts `ops` equal `renderOps(calls)` |
| F06: nothing to change | PASS | — |
| Build, typecheck, lint, lint:deps, fixtures:check, regen | PASS | `wip/s4-fixes/summary.log`; lint failed once, `lint-rerun.log` passed |
| Package suite at the tip | NOT VERIFIED | Run in progress; failures look like timeouts |

## Counts

| Severity | Count |
| --- | --- |
| Medium | 1 (G01) |
| Low | 2 (G02, G03) |
| Total | 3 |

| Verdict | Count |
| --- | --- |
| PASS | 13 |
| WEAK | 1 |
| FAIL | 0 |
| NOT VERIFIED | 1 |
