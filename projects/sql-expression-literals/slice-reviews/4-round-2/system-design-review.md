# System design review, round 2: slice 4 review fixes (TML-3290)

## Scope

Range: `660f57ffd3..HEAD` on `tml-3290-migration-files-template-literals`, seven commits (02b0eade6f to c74386c6d8). I read the code at HEAD and checked it against the decisions in `wip/slice-4-review-fixes-brief.md`. I did not run builds or tests.

What I checked:

- `tsArraySource` beside `tsObjectSource` and `jsonToTsSource`: name, placement, export from `src/index.ts`, and whether `jsonToTsSource` output is unchanged. `jsonToTsSource` is now a thin composition: scalars inline, arrays through `tsArraySource`, objects through `tsObjectSource`. It still reads as one thing. The new "no line break" check in `tsArraySource` cannot change a `jsonToTsSource` result, for the same reason given in round 1 for `tsObjectSource`: a child only spans lines when its one-line form is over 80 characters, so the parent's one-line form is already over 80. The name matches `tsObjectSource` and the header comment names both.
- The fallback rule for control characters and lone surrogates. It is stated once in code, in the doc comment of `tsQuotedTextSource`, and once in prose, in the Migration System paragraph. The line-break rule is now part of the control-character rule (`\n` and `\r` are below U+0020), so there is one check, `needsEscapeSequence`. That is the right place.
- The SQLite renderer's field order in `renderColumnSpec` and `renderTableSpec`. The order is the declaration order of `SqliteColumnSpec` and `SqliteTableSpec` in `operations/shared.ts`, and it is also the order in which `columnSpecFromNode` and `tableSpecFromNode` build those objects. No document states it as a rule. Key order only changes the text of `migration.ts`, never the operation, so this is not a correctness issue on its own. The real risk is fields being dropped, not reordered (finding B01).
- The policy renderer in `CreatePostgresRlsPolicyCall.renderTypeScript` (finding B01).
- The moved Migration System paragraph against "Opaque SQL in DDL" (finding B02). I confirmed the planner never sets `using` on `AlterColumnTypeCall` (`issue-planner.ts` and `planner-strategies.ts` pass only `qualifiedTargetType`, `formatTypeExpected` and `rawTargetTypeForLabel`), so the stated exception is true.

## Round 1 findings

| Finding | Decision | Status | Commit |
| --- | --- | --- | --- |
| A01. Three column-default sites still printed through `jsonToTsSource` | All three sites in scope; use `tsQuotedTextSource`, build SQLite objects with `tsObjectSource`; exact-output test per site; JSON default in both round-trip tests | Fixed as decided. The SQLite postcheck `sql` is also covered. | fb85cb7256, ddd4a7275b, f5b63b54ed |
| A02. Policy literal picks SQL fields by key-name comparison | Read `input.using` and `input.withCheck` directly; no key comparison, no runtime `typeof` | Fixed as decided. See B01 for a gap the change opens. | fb85cb7256 |
| A03. Migration System paragraph in the wrong section, list disagrees | Move under the planner IR next to the two renderers; match the "Opaque SQL in DDL" list | Fixed as decided. The paragraph now follows the two-renderers list and points to "Opaque SQL in DDL". See B02 for wording. | 66e074e895 |
| A04. Module header of `json-to-ts-source.ts` incomplete | Update the header comment | Fixed as decided. It names `tsObjectSource` and `tsArraySource`. | 7f8d84b501 |

## New findings

### B01. The hand-listed renderers drop any field added to their input type, with no compile error

Location:
- packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts lines 1786-1812 (`CreatePostgresRlsPolicyCall.renderTypeScript`)
- packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts lines 705-735 (`definedEntry`, `renderColumnSpec`, `renderTableSpec`, `renderPostcheck`)

Issue: Before this slice these objects went through `jsonToTsSource`, which writes every field it finds. Now each renderer lists its fields by hand. If someone adds a field to `SqliteColumnSpec`, `SqliteTableSpec`, the postcheck shape or `PostgresRlsPolicyInput`, the code still compiles and the scaffolded `migration.ts` silently leaves the field out. The migration file then produces a different operation from the one the planner made. In the policy renderer, the comment above `input` says a drift between the renderer and `createRlsPolicy` is a compile error. That is no longer true: `input` is still typed, but the output is built from a separate hand-written list, so the type check covers how `input` is built and not what is written. The round-trip tests would catch a dropped field only if their fixtures happen to set it.

Suggestion: Let the type system require every field. For each renderer, build a source map typed against the input, for example `const sources: { readonly [K in keyof SqliteColumnSpec]-?: string | undefined } = { name: jsonToTsSource(column.name), ..., defaultSql: tsQuotedTextSource(column.defaultSql), inlineAutoincrementPrimaryKey: column.inlineAutoincrementPrimaryKey === undefined ? undefined : jsonToTsSource(...) }`, then pass its defined entries to `tsObjectSource`. A new field then fails to compile until it has a renderer. The field order becomes the order of that object literal, which settles the order question as well. This keeps the A02 decision: fields are read directly and no value's type is checked at run time. Then either make the policy comment true again or remove it. A small helper in `@internal/ts-render` that takes such a map would serve both targets.

### B02. The Migration System paragraph's list of places is one ambiguous sentence

Location: docs/architecture docs/subsystems/7. Migration System.md line 125

Issue: The sentence "This covers every place that Opaque SQL in DDL lists except the `USING` conversion of `alterColumnType`, which the planner never writes, plus the default text of `setDefault`, `addColumn` and `recreateTable` and the postcheck SQL of `recreateTable`" joins an exception and an addition in one sentence. A reader can take the "plus" clause as more exceptions. "Opaque SQL in DDL" already names "a column default", so the added default sites read as a repeat without saying why they are listed apart: they are the planner's ready-made `DEFAULT …` clause text, not the `FunctionColumnDefault` expression. `addColumn` and `recreateTable` here are the SQLite factories and `setDefault` the Postgres one, which the sentence does not say. The content is correct and it does say why `USING` is absent.

Suggestion: Split it into two sentences. For example: "This covers every place that Opaque SQL in DDL lists, except the `USING` conversion of `alterColumnType`, which the planner never writes. It also covers SQL text that the planner builds whole: the `DEFAULT` clause in Postgres `setDefault` and in SQLite `addColumn` and `recreateTable`, and the postcheck SQL of SQLite `recreateTable`."
