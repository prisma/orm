# System design review: slice 4, migration files write template literals (TML-3290)

## Scope

Range: `tml-3287-line-comments-in-raw-sql...HEAD` on `tml-3290-migration-files-template-literals`, four commits (660f57ffd3, c1396c1514, a3f278df88, f2ee73b42c). I read the code at HEAD and checked it against `wip/slice-4-brief.md`, ADR 195 and the Migration System doc. I did not run builds or tests.

What I checked:

- `tsQuotedTextSource` in `ts-string-literal.ts` and `tsObjectSource` in `json-to-ts-source.ts`: names, placement, exports from `src/index.ts`, and whether `jsonToTsSource` still produces the same output. It does. A child value only renders on several lines when its one-line form is longer than 80 characters, and the several-line form is never shorter, so the new "no line break" check in `tsObjectSource` can never change a `jsonToTsSource` result. Strings from `tsStringLiteral` never hold a raw line break.
- Every `jsonToTsSource(` and `tsStringLiteral(` call in `packages/**/src` outside `ts-render`, to find SQL text still printed as a plain string literal (finding A01).
- The policy literal built from `RenderedRlsPolicyLiteral` (finding A02).
- Where the rule "a single-line text with both quote kinds becomes a template literal" is written down. It is stated once in code, in the doc comment of `tsQuotedTextSource`, and once in prose, in the Migration System doc, which names the function. That is the right number of places.
- The Migration System doc paragraph as end state (finding A03).

The five sites the brief lists all use `tsQuotedTextSource`, as designed. `migration-ts.ts` does format with `singleQuote: true`, as the doc says.

## Findings

### A01. Two planner-produced column-default sites still print SQL text through `jsonToTsSource`

Location:
- packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts lines 675-687 (`SetDefaultCall.renderTypeScript`, `defaultSql: ${jsonToTsSource(this.defaultSql)}`)
- packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts lines 397-399 (`AddColumnCall.renderTypeScript`, `column: ${jsonToTsSource(this.column)}`, where `SqliteColumnSpec.defaultSql` is the full `DEFAULT …` clause)
- packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts lines 324-335 (`RecreateTableCall.renderTypeScript`, whose `contractTable.columns[].defaultSql` is the same clause)

Issue: The brief's outcome is that a scaffolded `migration.ts` writes single-line SQL text holding both quote kinds as a template literal. The brief's list of sites misses these three. All three are produced by the planners, not only by hand: `SetDefaultCall` comes from `mapColumnDefaultNodeIssue` in the Postgres issue planner, and `AddColumnCall` from the SQLite issue planner. A JSON default is the common case that holds both quote kinds, for example `DEFAULT '{"a": 1}'::jsonb`. Setting that default on an existing Postgres column, or adding such a column in SQLite, still scaffolds `'DEFAULT \'{"a": 1}\'::jsonb'` after prettier. The doc paragraph added in this slice says the file writes "each SQL text (a column default, …)" this way, so the doc and the code disagree.

Suggestion: Render `defaultSql` in `SetDefaultCall` with `tsQuotedTextSource`. For the SQLite `AddColumnCall` and the columns inside `RecreateTableCall`, build the column object with `tsObjectSource`, rendering `defaultSql` with `tsQuotedTextSource` and the other fields with `jsonToTsSource`, the same way the policy literal is built. Add a both-quote-kinds JSON default to the Postgres and SQLite round-trip tests. If this is judged out of scope, narrow the doc paragraph to the four places it actually covers and record the three sites in the project's deferred list. Fixing the code is the better choice, because the missed sites are the ones a JSON default reaches first.

Note: `rawSql(${jsonToTsSource(this.op)})` in both targets also prints SQL statements as plain strings. Those are whole operations, not SQL expressions, and I do not suggest changing them; the doc should just not claim "each SQL text".

### A02. The policy literal picks the SQL fields by comparing key names at run time

Location: packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts lines 1800-1811 (`CreatePostgresRlsPolicyCall.renderTypeScript`)

Issue: The code turns the typed `RenderedRlsPolicyLiteral` into `Object.entries`, then chooses the renderer with `(key === 'using' || key === 'withCheck') && typeof value === 'string'`. `Object.entries` drops the link between each key and its type, so the `typeof` check is needed only to recover a type the object already had. If `using` or `withCheck` ever stops being a plain string (slice 1 already moved the DDL node's policy predicates to `OpaqueSql`), the check fails silently and the value falls through to `jsonToTsSource`, with no compile error. The `.filter(([, value]) => value !== undefined)` also repeats what `ifDefined` already does when `input` is built. This follows the brief's wording, so it is a small point.

Suggestion: Keep `input: RenderedRlsPolicyLiteral` as the compile-time check against `createRlsPolicy`, and build the entries from `input`'s fields directly rather than by key-name comparison: render every field with `jsonToTsSource` except `using` and `withCheck`, which are read as `input.using` and `input.withCheck` and passed to `tsQuotedTextSource` when defined. A later type change to those fields then fails to compile here.

### A03. The Migration System paragraph sits in a section about authoring shapes

Location: docs/architecture docs/subsystems/7. Migration System.md line 216

Issue: The paragraph is appended to "Authoring a migration.ts", after the Mongo factory-function example. That section explains the two shapes a user can write. The paragraph describes what the TypeScript renderer produces, which the doc covers under "Planner IR" (the `renderTypeScript` bullet, lines 121-123). Its list of SQL places also repeats, in a different order and with different members, the list in "Opaque SQL in DDL" (line 387), which includes the `USING` conversion that this paragraph leaves out. A reader meets two lists of "SQL text in a migration" that do not match. Apart from placement and the "each SQL text" claim in A01, the paragraph is written as end state and does not narrate history.

Suggestion: Move the paragraph to follow the two-renderers list under "Planner IR", and name the places by pointing to the list in "Opaque SQL in DDL", stating the exception: `alterColumnType`'s `using` is never scaffolded by the planner. Correct "each SQL text" to match whatever A01 resolves to.

### A04. The module header of `json-to-ts-source.ts` no longer describes the whole file

Location: packages/1-framework/1-core/ts-render/src/json-to-ts-source.ts lines 1-16 and 54-63

Issue: The header says the module is "a pure JSON-to-TS printer". `tsObjectSource` is not a JSON printer: it lays out entries whose values are already TypeScript source. Its placement next to `jsonToTsSource` is right, because both share `renderKey` and the 80-column layout, and `jsonToTsSource` delegating to it keeps one layout rule. Only the header is now incomplete.

Suggestion: Add one sentence to the header saying the file also exports `tsObjectSource`, the object layout that `jsonToTsSource` uses, for callers that render some values themselves. No code change.

## Names

`tsQuotedTextSource` and `tsObjectSource` are acceptable. `tsObjectSource` matches `jsonToTsSource` and says what it returns. `tsQuotedTextSource` is less precise than its neighbour `tsStringLiteral`, since both return source for a quoted string; its doc comment makes the difference clear, and the name is part of the settled design, so I do not suggest renaming it.
