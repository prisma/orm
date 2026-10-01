# Design verification: SQL expression literals

Checked `design.md`, `plan.md`, `spec.md` and `design-notes.md` against the code at `47d727b70d`. The four files changed on disk at 11:48 while this check ran, and section 9 is now written (Serhii answered). The findings below are against that later version. Section 9 was checked only where another section depends on it.

Result: 3 blocking, 7 should fix, 13 minor.

## Findings

### Blocking

**1. Section 10 (slice 2a) calls a reader and a field that do not exist in slice 2a.**

- Problem: Section 10 says to "read the value with `readWrittenValue(support, lowered.written)` (the local reader in slice 2a)" and to return `{ kind: 'tag', tag, text }`. In slice 2a there is no `readWrittenValue`. The local reader is `readValue`, which is private to `data-type-default.ts`, takes a third `elementIndex` argument, and returns `{ ok, typed }` or `{ ok: false, refusal }`. The tag arm's field is still `body`; section 4 renames it to `text` only in slice 2b. The design also does not say what happens when the read is refused or the type is not `sql/expression`.
- Evidence: `packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts:39` (`body`), `:152-208` (`function readValue`, not exported); `psl-column-resolution.ts:907`; design.md lines 349-350; section 4 is slice 2b (design.md line 133).
- Correction: in section 10 write: "In slice 2a, rename the `tag` arm's `body` field to `text` in `data-type-default.ts` (this part of section 4 moves to 2a), with the matching edits in `psl-column-resolution.ts` and `contract-prisma7/src/defaults.ts:277, 298, 300`. Export `readValue` from `data-type-default.ts` and call `readValue(support, lowered.written, undefined)`. When it returns `ok: true` and `typed.type === SQL_EXPRESSION_DATA_TYPE_ID`, take the SQL expression path with `text = lowered.written.text`. In every other case call `readAsLiteral(lowered.written)` as today, so a refusal is reported once, by `lowerDataTypeDefault`. Slice 2b replaces `readValue` with the framework's `readWrittenValue` and removes the export."
- Trace result after this fix: `@default(sql\`gen_random_uuid()\`)` and a list column `@default(sql\`'{}'::text[]\`)` both lower to `{ kind: 'function', expression }`. The list column's `@default` arms include the tag arms (`sql-attribute-specs.ts:215-217`), so the scalar tagged literal reaches the object branch.

**2. Section 8.3 puts the guard test in a package that cannot build a Postgres stack.**

- Problem: `contract-psl/test/sql-expression-places.test.ts` must build "the registered specs of `contract-psl` and the Postgres target with a real Postgres stack". `@internal/sql-contract-psl` has no dependency on `@internal/target-postgres`, and adding one makes a cycle: the target dev-depends on `sql-contract-psl`, and `family-sql` (a target dependency) depends on it too. contract-psl tests avoid the target on purpose.
- Evidence: `packages/2-sql/2-authoring/contract-psl/package.json` (no target in `dependencies` or `devDependencies`); `packages/3-targets/3-targets/postgres/package.json` (`devDependencies` includes `@internal/sql-contract-psl`); `contract-psl/test/interpreter.entity-ref-type-constructor.test.ts:12-18`.
- Correction: move the test to `packages/3-targets/3-targets/postgres/test/sql-expression-places.test.ts`. The target's tests already import `@internal/sql-contract-psl` (`psl-full-text-index.test.ts:15`). Build `sqlAttributeSpecs` from `@internal/sql-contract-psl/attribute-specs`, the `fullTextIndex` descriptor's spec and the three policy spec functions, with `dataTypes: { entries: postgresDataTypeEntries(), lookup: createDataTypeLookup(postgresDataTypes) }`. Change the plan's slice 2b test line to the new path.

**3. The plan's new slice 2a assembly test cannot live in `framework-components`.**

- Problem: plan slice 2a adds to `framework-components/test/data-type-assembly.test.ts`: "for the assembled Postgres and SQLite stacks, no registered type lists `sql/expression` as a cast source". The framework domain may not import the SQL domain or the targets, and the package does not depend on them. The test file uses only local fixtures.
- Evidence: `architecture.config.json` `crossDomainRules.framework.mayImportFrom: []`; `packages/1-framework/1-core/framework-components/package.json` (no target dependency); `data-type-assembly.test.ts:1-9`.
- Correction: put the assertion in `packages/3-targets/3-targets/postgres/test/data-types.test.ts` and the SQLite twin: "no element of `postgresDataTypes` (`sqliteDataTypes`) names `sql/expression` in `casts` or `listCast.of`". These lists are what the adapters register (`6-adapters/postgres/src/core/descriptor-meta.ts:171`, `6-adapters/sqlite/src/core/descriptor-meta.ts:33`). Keep only the lowering-key changes in `data-type-assembly.test.ts`.

### Should fix

**4. Section 18.3 misses contract-psl tests whose stacks carry no data type entries.**

- Problem: contract-psl builds `DataTypeSupport.entries` from `input.authoringContributions?.dataTypes ?? {}`. Several tests that interpret `@@index(where:/expression:)` or `@@check` pass contributions without `dataTypes`. After slice 2b rewrites their PSL to `sql` literals, every one is refused as `Unknown literal tag "sql". Known tags: .`
- Evidence: `contract-psl/src/interpreter.ts:2171-2174`; `test/interpreter.check-attribute.test.ts:25`; `test/interpreter.model-attribute-indexes.test.ts:85-98`; `test/interpreter.index-naming.test.ts:24, 82`; `test/interpreter.unknown-attributes.test.ts:18`; `test/ts-psl-parity.test.ts:96-103`.
- Correction: add to section 18.3 (slice 2b): "contract-psl tests that interpret `@@index` or `@@check` add `dataTypes: fixtureDataTypeSupport.entries` to their `authoringContributions`: `interpreter.check-attribute.test.ts`, `interpreter.model-attribute-indexes.test.ts`, `interpreter.index-naming.test.ts`, `interpreter.unknown-attributes.test.ts` and the shared `authoringContributions` in `ts-psl-parity.test.ts`."

**5. The plan's slice 2a test list misses tests that assert the changed codes and tags.**

- Problem: slice 2a changes codes (section 10.1) and the registered `sql` entry, but these assertions are not named and will fail:
  - `packages/3-targets/3-targets/postgres/test/psl-pg-enum-column.test.ts:272` expects `PSL_DEFAULT_TYPE_INCOMPATIBLE` for a no-cast.
  - `test/integration/test/number-defaults/psl-number-defaults.integration.test.ts:224, 238` expect `PSL_DEFAULT_TYPE_INCOMPATIBLE` for a no-cast.
  - `packages/2-sql/2-authoring/contract-psl/test/sql-attribute-specs.test.ts:358-362` expects `tags: ['sql', 'pg.sql']` and the old documentation. The plan names this file only in slice 2b.
  - `contract-psl/test/interpreter.defaults.tagged-literal.test.ts:241, 248, 258, 281` (JSON body, no-cast, lowering tag in a list, boolean parse) change codes. The plan names the file but not these rows.
  - The `describe('createPostgresDataTypeEntries')` block in `6-adapters/postgres/test/control-mutation-defaults.test.ts:328-395` and its SQLite twin call `loweringEntryKey` and the lowering entry.
- Correction: add each to the plan's slice 2a tests with the new code: `PSL_VALUE_TYPE_INCOMPATIBLE` for the three no-cast assertions and rows 248 and 258, `PSL_INVALID_LITERAL` for rows 241 and 281, `tags: ['sql']` with the `sqlExpressionAuthoringEntry` documentation for `sql-attribute-specs.test.ts`, and "delete the `createPostgresDataTypeEntries` and `createSqliteDataTypeEntries` describe blocks" in section 18.3.

**6. Section 2 names one regenerated shell `package.json`; three change.**

- Problem: `@prisma/orm-postgres` and `@prisma/orm-sqlite` also expose every `@internal/sql-contract` entry as `./family-contract/<entry>`. A new `./sql-expression` entry adds `./family-contract/sql-expression` to both.
- Evidence: `packages/9-public/@prisma/orm-postgres/package.json:93-109`; `packages/9-public/@prisma/orm-sqlite/package.json:105`; `packages/9-public/@prisma/orm-family-sql/package.json:72`.
- Correction: in section 2 write "commit the regenerated `package.json` of `orm-family-sql`, `orm-postgres` and `orm-sqlite` in slice 2a".

**7. Section 20 cites the wrong lines of `postgres-full-text-search/app`.**

- Problem: the slice 2b row "supersedes the plain-string SQL in `postgres-full-text-search/app` (lines 54 and 68)". Line 54 is TypeScript (`fullTextIndex(cols.text, { where: 'archived_at IS NULL', … })`), which stays valid until slice 3. Line 68 is an ORM `.where(...)` call, not SQL. The PSL plain string is at line 79 (`@@index(expression: "to_tsvector(…)", …)`).
- Evidence: `upgrade-instructions/pending/postgres-full-text-search/app/instructions.md:54, 68, 79`.
- Correction: the 2b fragment supersedes line 79; the slice 3 `sql-expression-literals-ts/app` fragment supersedes line 54.

**8. Section 20's slice 3 row lacks the storage-hash note.**

- Problem: spec requirement 5 and review F05 say a non-canonical body changes its stored text and storage hash once. For TypeScript users this happens in slice 3: a multi-line template string (or one with leading whitespace or CRLF) is canonicalized once it is written as `sql`. Only the 2b fragments carry `storage-hash-may-change-once`.
- Evidence: design.md line 713 (slice 3 row); spec.md requirement 5.
- Correction: add `storage-hash-may-change-once` to `sql-expression-literals-ts/app` and `/extension`.

**9. Section 20's slice 2a row does not supersede the pending fragments that teach the old codes.**

- Problem: `data-types-column-defaults/app` names `PSL_DEFAULT_TYPE_INCOMPATIBLE` for a no-cast and `PSL_INVALID_JSON_LITERAL` for a bad JSON body, and `data-types-column-defaults/extension` names `PSL_INVALID_DEFAULT_LITERAL` for a cast refusal. Slice 2a changes all three. The row names only the lowering-entry text of the extension fragment. Section 20's own rule says a new fragment names the fragment it supersedes.
- Evidence: `upgrade-instructions/pending/data-types-column-defaults/app/instructions.md:59, 82, 102`; `.../extension/instructions.md:168`.
- Correction: `default-diagnostic-codes-changed` in both 2a fragments names these lines of `data-types-column-defaults/app` and `/extension` as superseded.

**10. The codemod in section 20 cannot be written as described.**

- Problem: it "writes `printSqlExpressionLiteral(text)`", but a colocated upgrade script runs in a user project where `@internal/*` does not resolve, so it cannot import that function. It also reads "every `.prisma` file from `git ls-files`", while both precedents take file or glob arguments. The design names no path and no test.
- Evidence: `scripts/lint-throws.mjs:31-36` (codemods run standalone); `upgrade-instructions/pending/psl-verbatim-table-names/app/scripts/add-model-map.mjs:7-8, 22-25` (glob arguments, `node:*` imports only); `.../app/instructions.md:16, 26` (`script: ./scripts/add-model-map.mjs`); `scripts/codemods/add-model-map.test.mjs` (listed in the root `test:scripts`).
- Correction: canonical file `scripts/codemods/rewrite-sql-strings.mjs` with `scripts/codemods/rewrite-sql-strings.test.mjs`, added to the root `test:scripts`; copies at `upgrade-instructions/pending/sql-expression-literals-psl/{app,extension}/scripts/rewrite-sql-strings.mjs`, referenced as `script: ./scripts/rewrite-sql-strings.mjs`; invoked as `node scripts/rewrite-sql-strings.mjs '**/*.prisma'`; it contains its own copy of the section 11.1 printer rule (backtick form, multi-line text on its own lines, double-quote form with `\\`, `\"`, `\n`, `\r` escapes when the text holds a backtick).

### Minor

**11. Export lines are missing.** `EMPTY_DATA_TYPES` (section 7) goes in `spec-context.ts`, which holds only types, and `psl-parser/src/exports/index.ts` re-exports that file's types only; the language server and providers import from `@internal/psl-parser`. `ParsedTypedValue`, `DataTypeValueArgType` and `WrittenLiteralResult` must join the type list in the same file (the Postgres target uses `ParsedTypedValue` in 8.2 and 9.2). `tsObjectSource` (section 16) must be exported from `ts-render/src/index.ts`. Correction: add these export lines to sections 5, 6, 7 and 16.

**12. `scalarDefaultArms` parameters are unstated.** Section 7 says it "reads tags from `ctx.dataTypes.entries`; `defaultFieldSpec` passes `ctx.dataTypes`", but it still needs `defaultFunctionRegistry` (`sql-attribute-specs.ts:192-214`). Correction: "`scalarDefaultArms(isList, dataTypes: DataTypeSupport, registries: ControlDefaultRegistries)`".

**13. `errorCode` has no reader.** Section 4 adds `errorCode` to `unreadable` refusals, but section 10.1 retires the only code that needed it (`PSL_INVALID_JSON_LITERAL`), and no other section reads it. Correction: drop `errorCode`, or name its consumer.

**14. The `?? {}` in sections 7 and 9.1 is dead code, and section 7 is inconsistent with itself.** `AssembledAuthoringContributions.dataTypes` is required (`framework-components/src/control/control-stack.ts:61`; `config/src/contract-source-types.ts:44`). Section 7's Mongo line omits the fallback; its language-server line and section 9.1 keep it. Correction: drop `?? {}` everywhere.

**15. The plan's slice 2b dispatches split section 7.** Dispatch (a) covers sections 4-7, and section 7 changes the language server (`pipeline.ts`, `config-resolution.ts`, `attribute-spec-resolution.ts`, `server.ts`). The required `AttributeSpecContext.dataTypes` breaks the server's build until those land. Dispatch (c) is "the language server". Correction: "(a) includes the section 7 language-server wiring; (c) is section 12 only."

**16. The wire-name stability test has no file.** Correction: name it, for example `packages/3-targets/3-targets/postgres/test/sql-expression-wire-names.test.ts`. The target depends on `@internal/sql-schema-ir` (index and check hashes) and owns the policy hash (`rls/canonicalize.ts:41`).

**17. Section 17.2's fallback undoes slice 4.** `renderTaggedTemplateSource` falls back to `tsStringLiteral(text)`, so a text that holds both quotes but fails the tag read-back (for example a leading space) goes back to escaped quotes. Correction: fall back to `tsQuotedTextSource(text)`.

**18. Two review items are only partly applied.** A09: the ADR 254 paragraph on TypeScript gains `SqlExpression` (a TypeScript value of a type with no codec); section 19 has no slice 3 row for ADR 254. A07: the Migration System doc records that the string form of migration arguments is permanent; section 19's slice 5 row says only "`sql` values". Correction: add both rows.

**19. The lists of amended ADRs disagree.** spec.md "ADR pointer": 129, 195, 231, 234, 249, 254, 255. design-notes.md decision 13: 129, 195, 231, 249, 254, 255. design.md section 19 also amends 236, 243 and 244. Correction: use section 19's list in all three.

**20. The plan's slice 2b grep will match a line that must stay.** `expression: '` matches `docs/reference/codec-authoring-guide.md:206` (`expression: 'string',`, an arktype schema). Correction: limit the slice 2b grep to PSL code (`.prisma` files and ` ```prisma ` blocks), or list this line as an exception.

**21. The slice 1 detection pattern misses readers of the changed fields.** `ddl-nodes-hold-opaque-sql` detects only constructor calls. Extension code that reads `.expression`, `.using`, `.withCheck` or `.where` of these nodes as a string also breaks. Correction: say so in the change's instructions ("read `.text`") even if no pattern detects it.

**22. Section 6 step 0 can now throw inside `buildSymbolTable`.** With section 9.1's default `dataTypes = EMPTY_DATA_TYPES`, a caller that registers Postgres policy descriptors and omits data types gets an `InternalError` from inside `buildSymbolTable`. The language server's pipeline states that `buildSymbolTable` does not throw (`language-server/src/pipeline.ts:46-47`). Production callers always pass real data types, so only tests can reach it. Correction: state in 9.1 that any caller that passes block descriptors must pass the same stack's data types, and update the `pipeline.ts` comment.

**23. Section 18.3's slice 2a language-server item asks for lookups that slice 2a does not use.** In slice 2a the server reads tags from `authoringContributions.dataTypes` only; lookups first matter in 2b. Correction: drop "and build lookups with `createDataTypeLookup`" from the 2a item, or move it to 2b.

## Review findings

A01-A19 and F01-F14 are applied, except as noted in findings 3 (A11, test location), 7 (F11, line numbers), 8 (F05, slice 3), 18 (A07 and A09, partly) and 20 (F08, grep). A04, A14, A17 and F01 are resolved by building on #30381 and by section 9. F13 is applied as decided (untagged templates first). F14's #30355 is closed (`research/review-followups.md:413`). A19's block snippet item no longer applies: the declaration snippet does not pre-fill keys on this base (`language-server/src/completion-provider.ts:400-411`).

## Checked with no finding

- Planes and dependencies. `@internal/sql-contract` already imports `/authoring` and `/codec` (`src/authored-check-naming.ts:4`, `src/types.ts:1`); both entries are shared plane. Both targets, both adapters, `contract-psl`, `contract-ts`, `family-sql` and `relational-core` declare `@internal/sql-contract`. `ts-render` exports from `src/index.ts`. `relational-core/src/ast/` sits beside `ddl-types.ts` and is exported through `src/exports/ast.ts`. The language server imports only framework packages. The Mongo provider's `context.dataTypeLookup` exists (`config/src/contract-source-types.ts:47`).
- Trace (b): the 10.1 table covers all six refusal kinds `lowerDataTypeDefault` reports (`data-type-default.ts:436-474`).
- Trace (c): every `AttributeSpecContext` construction site is listed (contract-psl `psl-column-resolution.ts:784`, `psl-field-resolution.ts:74`, `interpreter.ts:1154`; Mongo `interpreter.ts:1114`; language server `attribute-spec-resolution.ts:71, 91`). Block contexts change only through section 9.1.
- Trace (d): the new `normalizeSqlBody` gives the same output on its own output, and hashes every body without `--` and every one-line body as before. The only pinned input with `--` is one line (`schema-ir/test/naming.test.ts:212`); `rls-canonicalize.test.ts` has none. No committed `ops.json` or `contract.json` contains `--`.
- Trace (e): prettier does not change template literal content, and `biome explain noUnusedTemplateLiteral` lists a template holding `"` or `'` as valid.
- Trace (f): the `SqlExpression` class and its two subcodes both land in slice 3; nothing in slice 2a calls `contractError`.
- Trace (g): `buildModel` collects comment lines in one array after the policy notes (`infer-model-blocks.ts:163-167`), so the skip notes fit there.
- Line references in sections 10, 11 and 14 match the code. The section 18.1 file list matches every committed `.prisma` file with plain-string raw SQL.
