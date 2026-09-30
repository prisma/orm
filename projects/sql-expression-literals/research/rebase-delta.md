# Research: design delta after rebasing onto PR #30381

The design (`design.md`) was written against `6a5b58ecb7`. The branch now sits on `47d727b70d` (PR #30381), 34 commits and 712 files later. This report lists what changed for design sections 2–8 and 10–17, and collects the facts for architect changes A01 and A06. Section 9 is out of scope. Line numbers are from `47d727b70d`.

## What changed on the new base, in short

- **Block specs replace block parameter tables (ADR 255, new).** A block descriptor now carries `spec: unknown` (a factory `(ctx: BlockSpecContext) => BlockSpec`) instead of `parameters` and `variadicParameters`. `buildSymbolTable` interprets every registered block with its spec after collecting all declarations, and returns `parsedBlocks: ReadonlyMap<BlockSymbol, ParsedPslExtensionBlock>` (typed envelopes). `block-reconstruction.ts` and `psl-extension-block-validator.ts` are deleted. `PslExtensionBlock` is now a print-only shape with `parameters: Record<string, PslExtensionBlockSourceEntry>` (`{ expression?: string; span }`).
- **A block spec context exists.** `BlockSpecContext = { symbols: SymbolTable; block: BlockSymbol }` (`psl-parser/src/block-spec/types.ts:10-13`). Block attribute factories now also take it (`spec-context.ts:42-44`).
- **`AttributeSpecContext` gained an optional field** `parsedBlocks?: ReadonlyMap<BlockSymbol, ParsedPslExtensionBlock>` (`spec-context.ts:17`). `ControlDefaultRegistries` is unchanged.
- **Postgres policy blocks are `fixedBlock` specs** whose `using` and `withCheck` are `optional(str())` and `permissive` is `optional(bool())` (`postgres/src/core/authoring.ts:151-205`). The predicate matrix is now expressed by keyword-specific specs.
- **New `jsonValue()` combinator** and `ArgTypeKind` member `'jsonValue'`.
- **Multi-file PSL.** Interpreter inputs take `documents: readonly DocumentAst[]`; every hand-written `.prisma` fixture now starts with `// use prisma-8` and a blank line.
- **New data type `pg/tsquery`** (no authoring entry).
- **The PSL printer lost its `codecLookup` option** and prints block entries verbatim.
- Unchanged: `data-type-default.ts`, `mutation-default-types.ts`, `tagged-literal.ts`, `control-stack.ts`, all DDL files of section 14, all TypeScript builder files of section 15 except one message, all migration files of section 16, the adapters' `data-type-authoring.ts`, the targets' `data-type-entries.ts`, contract-prisma7's `defaults.ts`.

## Part A — delta per design section

### Section 2 (shared definitions)

Still true. No new entries in `@internal/sql-contract`. `framework-components/src/exports/authoring.ts` still does not export the tagged-literal functions; `exports/control.ts:149-152` does. `dataTypeId`, `DataTypeId`, `createDataTypeLookup` are still exported from `exports/codec.ts:37-45`.

A related precedent, not a conflict: the Postgres target now has a runtime `tsquery` template tag (`postgres/src/core/tsquery-tag.ts`, exported from the new `postgres/src/exports/full-text.ts`). It throws `RUNTIME.ARGUMENT_INVALID` when a template part has an invalid escape (`literalPart`, line 17).

### Section 3 (registration and removal of lowering entries)

All claims still true; only line numbers moved.

- 3.1: `postgresDataTypes` now includes `pgTsquery` (`data-types.ts:62`, list entry at 128). The last element is still `pgTimestamptz` (147). The pinned list in `postgres/test/data-types.test.ts:37-64` is sorted, so `sql/expression` goes last. It also gained `'pg/tsquery'` at 60 and a casts row at 93.
- 3.2: adapters unchanged: `6-adapters/postgres/src/exports/control.ts:18` (`dataTypes: createPostgresDataTypeEntries()`), SQLite `:17`.
- 3.3: unchanged: `9-family/src/core/sql-default-literal-tag.ts:7` defines `PSL_INVALID_DEFAULT_SQL`; `9-family/src/exports/control.ts:15` re-exports `checkSqlDefaultBody`, `:95-96` export `PSL_INVALID_DEFAULT_SQL` and `sqlDefaultLiteralTagEntry`.
- 3.4: `framework-authoring.ts`: `lower?: never` at 596, `DataTypeLoweringAuthoringEntry` 603, `AuthoringDataTypeEntry` 612, `LOWERING_ENTRY_PREFIX` 614, `loweringEntryKey` 620, `isLoweringEntryKey` 624, `isDataTypeLoweringEntry` 629, `AuthoringContributions.dataTypes` 665. `exports/authoring.ts` exports them at 7, 34, 54-56. `mutation-default-types.ts`: `TaggedLiteralValue` 86, `ControlDefaultRegistries` 101-104. `control-stack.ts`: the two skips at 434 and 451. The other edits to `framework-authoring.ts` (block descriptor `spec: unknown`, `classifyEnumMemberType(values)`) do not touch these symbols.
- 3.5: `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` is at `psl-extension-block.ts:81-82`, `psl-column-resolution.ts:741`, `data-type-default.ts:447`, `error-reference.md:630-632`. Part C lists the tests. Side note: the union lost `PSL_EXTENSION_OPTION_OUT_OF_SET` and `PSL_EXTENSION_UNRESOLVED_REF`.

### Section 4 (cast rule moves into the framework)

Still true. `data-type-default.ts` and `contract-psl/src/exports/resolution.ts` are unchanged. contract-prisma7 still imports `DataTypeSupport`, `DefaultRefusal`, `entryForTag`, `readDataTypeDefault` and `WrittenValue` from `@internal/sql-contract-psl/resolution` (`contract-prisma7/src/defaults.ts:17-23`) and builds a `DataTypeSupport` at `contract-prisma7/src/interpreter.ts:1138-1141`.

One dependency to note: `contract-prisma7/src/defaults.ts:324` reads `refusal.columnType`. If `DefaultRefusal`'s `no-cast` arm is renamed to `receivingType` (section 4 is ambiguous about whether the rename reaches `DefaultRefusal`), that line changes too.

### Section 5 (reading PSL syntax into a written literal)

Still true. New neighbour: `psl-parser/src/attribute-spec/combinators/json-value.ts` also matches literals by syntax kind. It rejects tagged literals ("Expected a JSON value") and reads numbers with `NumberLiteralExprAst.value()`, not token text. No conflict with `readWrittenLiteral`.

### Section 6 (the `dataTypeValue` combinator)

Mostly true. Changes to account for:

- `ArgTypeKind` now includes `'jsonValue'` (`types.ts:41`); `InspectableArgType` includes `JsonValueArgType` (`types.ts:263`). `types.ts` already imports `JsonValue` (line 1).
- Block specs reuse attribute `ArgType`s. `interpretExtensionBlock` (`block-spec/interpret.ts:102`) calls `rule.parse(value, ctx)` with `ctx = { sources, symbols }`, so a `dataTypeValue` can be a block entry rule and its diagnostics become block diagnostics. `optional(...)` works there (`isOptionalArgType`, line 110).
- Risk: step 0 of `parse` throws `InternalError` when the lookup lacks the type. On the new base, `buildSymbolTable` parses block values in every caller, including the language server (`pipeline.ts:60`, `project-artifacts.ts:188`), both providers, and the `deriveParsedBlocks` fallback. If a block spec uses `dataTypeValue` and a caller passes an empty lookup, the parse throws. Design section 7's language-server fallback `createDataTypeLookup([])` is safe for attribute specs (the server only builds them), but not for block specs, which the server parses.
- The server builds every model and field spec to list attribute names (`completion-provider.ts:265-268`), so "construction never throws" is still required.

### Section 7 (the spec context carries the lookup)

Changed.

- `AttributeSpecContext` (`spec-context.ts:7-18`) now has optional `parsedBlocks`. `ControlDefaultRegistries` is unchanged.
- `specDataTypeSupport` does not exist yet (expected).
- contract-psl sites: `psl-column-resolution.ts:784-794` (now also passes `parsedBlocks`), `psl-field-resolution.ts:74-84` (passes `parsedBlocks`), `interpreter.ts:1154-1161` (was "about line 1146"; does not pass `parsedBlocks`).
- `modelSpecContext` helper (`sql-attribute-specs.ts:679-689`) has no production caller, only `sql-attribute-specs.test.ts:169`. It takes no `parsedBlocks`.
- Language server: `PipelineInputs` (`pipeline.ts:26-31`) still has no lookup. `pipelineInputsFromStack` is at `config-resolution.ts:71-80`. `AttributeSpecSource` (`attribute-spec-resolution.ts:25-31`) now has `parsedBlocks?`. `server.ts` candidate objects are now at 490-501 (completion) and 529-539 (signature help) and include `parsedBlocks`.
- Mongo: `provider.ts:39-42` builds the registries as before.
- Not in the design: block spec contexts (Part B lists them).

### Section 8 (the attribute places)

8.1 still true structurally. Current locations:

- `indexModelSpec` const at `sql-attribute-specs.ts:389` (`expression` 401-405, `where` 406-409); refine compares with `undefined` only (427, 437). `checkModelSpec` at 483; `expression: str()` at 486; empty check `value.expression.trim()` at 498. Registry `index: () => indexModelSpec` and `check: () => checkModelSpec` at 712-713.
- `interpreter.ts`: `@@index` spec call at 1051; the node is built inside a `blindCast<IndexNode, ...>` at 1076-1092 with `...ifDefined('expression', parsed.expression)` at 1083 and `where: parsed.where` at 1084. `@@check` spec call at 1111, node at 1119-1123. Contributed model attribute context at 1154-1161.
- `BuildModelNodeInput` now carries `parsedBlocks` (`interpreter.ts:668`). The design's per-model context should decide whether to pass it (the contributed context does not today).
- `sql-attribute-specs.test.ts:264` calls `sqlAttributeSpecs.model.index()` with no argument; it needs a context after the change.

8.2 still true: `postgresFullTextIndexSpec` at `authoring.ts:647` (`where` at 673-676), factory at 714, `PostgresFullTextIndexParsed` at 716-722, `where: parsed.where` at 777.

### Section 10 (`@default` consumes a `sql/expression` value)

Mostly true. Changes:

- `lowerDefaultForField` gained `parsedBlocks?` (`psl-column-resolution.ts:765`) and passes it to `fieldSpecContext` (788).
- `context` is now declared twice. The outer one (`806-811`) is used only by `writtenElement`'s call to `lowerTaggedLiteral` (838). A second one (`885-890`) sits inside a new `if (typeof value === 'object')` block (starting 884) that wraps both the tagged-literal and default-function paths; the function now ends with `return {}`. At the base there was one declaration (`802`). Once `lowerTaggedLiteral` loses its `context` parameter, delete the outer declaration; the inner one stays for `lowerDefaultFunctionWithRegistry`.
- The insertion point for the SQL expression path is `psl-column-resolution.ts:907` (`if ('written' in lowered) return readAsLiteral(lowered.written);`), inside the object branch.
- `lowerTaggedLiteral` is at 717-760: unknown tag 737-743, canonicalization codes 712-715, lowering-entry call 755-759. The list-element special case is at 844-851.

### Section 11 (printing)

- 11.1: still true, but the cited printer lines moved. Namespace indentation is `wrapNamespaceBlock` at `serialize-print-document.ts:160-170` (the indent is at 165), not 289-298. Block entries are now printed verbatim as `  key = <expression>` (`serializeExtensionBlock`, about 145-150). The reason for starting a multi-line body on its own line still holds.
- 11.2: `default-mapping.ts` unchanged (`sqlLiteralText` 75, `writingSurface` 98, `literalText` 194). `infer-index-attributes.ts` unchanged (41, 60, 91). **`infer-policy-blocks.ts` changed:** parameters are `PslExtensionBlockSourceEntry` objects. The field is `expression`, not `raw`: lines 105-110 read `{ using: { expression: JSON.stringify(policy.using), span: SYNTHETIC_SPAN } }` and likewise `withCheck`. The design's `raw: sqlExpressionLiteralText(...)` becomes `expression: sqlExpressionLiteralText(...)`. `permissive` is `{ expression: 'false' }` (111).

### Section 12 (language server)

- `completion-values.ts`: the `taggedLiteral` branch is at 135-146. The following `switch` (147-167) now lists `'jsonValue'` among the kinds with no completions.
- `completion-snippets.ts` `argSnippetPlaceholder` (42-52) unchanged; `directArgType` is at `attribute-argument-grammar.ts:13`.
- `semantic-tokens.ts` unchanged: `collectExpression` at 403, the empty `TaggedLiteralExprAst` branch at 452-454, `splitMultiline` at 696.
- New: block key completion binds block specs (`completion-provider.ts:438-475`, context built at 453). Block value completion still returns `[]` (`completion-provider.ts:141-144`), so the non-goal holds. The declaration snippet no longer pre-fills required keys.

### Section 13 (diagnostics table)

The rows naming "block typing" depend on section 9, which is being replaced. On the new base, a block entry is parsed by its `ArgType`, so a value failure carries that rule's leaf code (default `PSL_INVALID_ATTRIBUTE_SYNTAX`, `combinators/diagnostic.ts:7`). The row "`PSL_EXTENSION_INVALID_VALUE` | block typing | A `value` parameter is not a literal" no longer fits: that code's doc is now "A parameter value was rejected by its interpreting consumer — e.g. an enum member value the selected codec's `decodeJson` refused, or an unregistered codec id" (`psl-extension-block.ts:96-101`), and only the families' enum factories raise it (`2-sql/9-family/src/core/authoring-entity-types.ts:45, 56, 90`, and the Mongo equivalent). The row "`PSL_DEFAULT_TYPE_INCOMPATIBLE`, `PSL_INVALID_DEFAULT_LITERAL`, `PSL_INVALID_JSON_LITERAL` | Unchanged" conflicts with A06 (Part C).

### Section 14 (embedded SQL in DDL)

No file named in section 14 changed. Still true, including the "about line" references.

### Section 15 (TypeScript contract builder)

Still true. Only `3-extensions/postgres/src/contract/full-text-index.ts` changed (one `fix` message at 75). In `postgres/src/core/authoring.ts`: `RlsPolicyHandleShape` at 942-949, `postgresLowerEntityHandles` at 995, the `buildRlsPolicyEntity` call with `...ifDefined('using', policy.using)` at 1102-1110. `buildRlsPolicyEntity` (263-296) keeps taking strings.

### Section 16 (migration files)

No file changed. Still true.

### Section 17 (committed artefacts)

- Every hand-written `.prisma` fixture now starts with `// use prisma-8` and a blank line, so the line numbers in `research/artefacts-docs.md` §1.2 are 2 higher. Example: `examples/supabase/src/contract.prisma` has `using` at 17, 24, 32 and `withCheck` at 33. The generated Supabase contract is unchanged; `contract:generate` still exists (`supabase/package.json:10`).
- Inline PSL in tests with plain-string SQL (lines matching `using = "`, `withCheck = "`, or `@@index/@@check/@@fullTextIndex(... where:/expression: "`), compared with `research/artefacts-docs.md` §1.4:
  - New: `psl-parser/test/block-spec.test.ts` (9) and `symbol-table.parsed-blocks.test.ts` (9). Both use test-local specs with `str()`, so they change only if the section 9 replacement changes them.
  - New: `postgres/test/psl-policy-placement.test.ts` (6). Uses the real Postgres descriptors; must change.
  - New: `language-server/test/pipeline.test.ts` (1). Check it.
  - Count changed: `psl-rls-authoring.test.ts` 6 → 10, `declarative-policy-select.round-trip.test.ts` 6 → 5, `generic-extension-block-printer.test.ts` 5 → 3, `interpreter.diagnostics.test.ts` 2 → 3.
  - The rest match §1.4.
- 17.1:
  - `fixture-data-types.ts` and `fixture-sql-tag.ts` are unchanged.
  - Add `postgres/test/psl-policy-placement.test.ts` to the list of tests that assemble contributions without the adapter. Its contributions (33-41) have no `dataTypes`.
  - The listed Postgres tests already pass `createDataTypeLookup(postgresDataTypes)`.
  - The language-server test that loads the adapters' `data-type-authoring.ts` by path is now at `completion-provider.test.ts:1285-1293` (was 1188-1194).
  - `postgres/test/block-documentation.test.ts` now binds every block spec with `{ symbols, block }` (5-16, 23). If `BlockSpecContext` gains a required field (A01), this test must supply it.
  - `framework-components/test/psl-extension-block-validator.test.ts` is deleted. The printer and symbol-table tests listed for hand-built value nodes were rewritten for block specs. Both belong to section 9.

### Outside the sections, for awareness

- New ADR 255 ("Block specs bind top-level block values") rejects "carry block values through the codec JSON medium" because "parsing must not depend on codec registries". Putting data types into `BlockSpecContext` makes block parsing depend on a stack registry (data types, not codecs). The section 9 replacement should say why that is acceptable.
- New pending fragment `upgrade-instructions/pending/typed-block-value-specs/extension/` already removes `validateExtensionBlock` and the printer's `codecLookup`. Section 19's `print-psl-takes-no-codec-lookup` and `validate-extension-block-takes-data-types` changes are obsolete.

## Part B — facts for A01 (`dataTypes: DataTypeSupport` on the spec contexts)

`ControlDefaultRegistries` today is `Pick<ControlMutationDefaults, 'defaultFunctionRegistry'> & { dataTypeEntries }` (`mutation-default-types.ts:101-104`). The only reader of `dataTypeEntries` in code is `scalarDefaultArms` (`sql-attribute-specs.ts:192-199`, reads `registries.dataTypeEntries` at 199), called from `defaultFieldSpec` with `ctx.controlMutationDefaults` (290). `defaultFunctionRegistry` is read at `sql-attribute-specs.ts:297` and in the test `contract-psl/test/interpreter.model-attributes.test.ts:20`. One doc names the field: `docs/reference/psl-editor-tooling-tagged-literals.md:13`.

### B.1 Production sites that build an `AttributeSpecContext`, `FieldAttributeSpecContext` or `ControlDefaultRegistries`

| Site | What it builds | Stack data in scope |
| --- | --- | --- |
| `2-sql/2-authoring/contract-psl/src/interpreter.ts:1154-1161` | Model context for a contributed model attribute (`@@rls`, `@@fullTextIndex`); `controlMutationDefaults: { defaultFunctionRegistry, dataTypeEntries: input.dataTypeSupport.entries }`; no `parsedBlocks` | `input.dataTypeSupport` (entries and lookup, `BuildModelNodeInput` at 640), `input.defaultFunctionRegistry` (639), `input.parsedBlocks` (668) |
| `interpreter.ts:1051`, `:1111` | `sqlAttributeSpecs.model.index()` / `.check()`, no context today | Same as above |
| `interpreter.ts:2169-2174` | Builds `dataTypeSupport = { entries: input.authoringContributions?.dataTypes ?? {}, lookup: input.dataTypeLookup }`, passed on at 2494-2495 | `input.dataTypeLookup` is required (149); `input.controlMutationDefaults` is optional (147) |
| `contract-psl/src/psl-column-resolution.ts:784-794` | `fieldSpecContext(...)` for `@default`, with `parsedBlocks` when defined | `input.dataTypeSupport` (773), `input.defaultFunctionRegistry` |
| `contract-psl/src/psl-field-resolution.ts:74-84` | `fieldSpecContext(...)` for an enum-typed `@default`, with `parsedBlocks` | `input.dataTypeSupport` (66), `input.parsedBlocks` (61) |
| `contract-psl/src/sql-attribute-specs.ts:679-689`, `:691-705` | `modelSpecContext` / `fieldSpecContext` helpers; take a `ControlDefaultRegistries` | Whatever the caller passes |
| `2-mongo-family/2-authoring/contract-psl/src/provider.ts:39-42` | `ControlDefaultRegistries` literal `{ ...context.controlMutationDefaults, dataTypeEntries: context.authoringContributions.dataTypes }` | `context: ContractSourceContext` has `authoringContributions.dataTypes`, `dataTypeLookup` (`config/src/contract-source-types.ts:44-48`) |
| `2-mongo-family/2-authoring/contract-psl/src/interpreter.ts:1114-1118` | `specContextFor(model)` from `input.controlMutationDefaults` (typed `ControlDefaultRegistries`, line 110); used at 235, 259, 314, 888, 925, 947-948, 1208, 1298 | Only the input: registries, optional `authoringContributions`, optional `codecLookup`. No lookup |
| `1-framework/3-tooling/language-server/src/attribute-spec-resolution.ts:71-79` (model), `:91-99` (field) | Context spreading `source.controlMutationDefaults` plus `dataTypeEntries: source.authoringContributions.dataTypes ?? {}` | `AttributeSpecSource` (25-31): `authoringContributions?`, `controlMutationDefaults?`, `parsedBlocks?`. No lookup |

### B.2 Production sites that build a `BlockSpecContext`

| Site | What it builds | Stack data in scope |
| --- | --- | --- |
| `psl-parser/src/symbol-table.ts:230` | `blockSpecFactoryOf(descriptor)({ symbols: symbolTable, block })` for every registered block; values are then parsed (231-243) | `BuildSymbolTableOptions` (119-123): `documents`, `sources`, `pslBlockDescriptors` only |
| `psl-parser/src/block-spec/derive.ts:30` | Same, for `deriveParsedBlocks` | `symbolTable`, `sources`, `pslBlockDescriptors` |
| `psl-parser/src/block-spec/interpret.ts:198` | `factory({ symbols, block })` for each block `@@` attribute | `InterpretExtensionBlockAttributesInput`: `block`, `descriptor`, `symbols`, `sources` |
| `language-server/src/attribute-spec-resolution.ts:61` | Block attribute factory context | `AttributeSpecSource` (no lookup) |
| `language-server/src/completion-provider.ts:453` | Block spec for key completion | `PslCompletionCandidateSource extends AttributeSpecSource` (no lookup) |

Callers of `buildSymbolTable` and `deriveParsedBlocks` in production, and what they could pass:

- `contract-psl/src/provider.ts:169`: `context` has `authoringContributions.dataTypes` and `dataTypeLookup`.
- `2-mongo-family/.../provider.ts:111`: same `context`.
- `contract-prisma7/src/interpreter.ts:226`: registers no blocks (`pslBlockDescriptors: {}`). The input has `dataTypeLookup` (85) and optional `authoringContributions`.
- `language-server/src/pipeline.ts:60`: `PipelineInputs` has `authoringContributions?` only.
- `language-server/src/project-artifacts.ts:188`: `controlStack: PipelineInputs`; `interpretation?.context` has `dataTypeLookup`, but only when a PSL interpreter is configured.
- `contract-psl/src/interpreter.ts:2115-2117` (`deriveParsedBlocks` fallback): runs before `dataTypeSupport` is built at 2171, but `input.dataTypeLookup` and `input.authoringContributions` are available.
- `2-mongo-family/.../interpreter.ts:1140-1146`: no lookup in the Mongo input.

In tests, `buildSymbolTable` is called 101 times in 71 files. A required option would touch all of them. Tests that build symbol tables with Postgres policy blocks (they would need real data types once policies use `dataTypeValue`): `psl-parser` `block-spec.test.ts`, `symbol-table.parsed-blocks.test.ts`, `symbol-table.test.ts`; `psl-printer` `declarative-policy-select.round-trip.test.ts`; Postgres `block-documentation.test.ts`, `index-types.test.ts`, `migrations/full-text-index-planning.test.ts`, `psl-full-text-index.test.ts`, `psl-infer/infer-parse-emit.test.ts`, `psl-infer/infer-psl-contract.enum-adoption.test.ts`, `psl-infer/print-psl.round-trip.test.ts`, `psl-infer/print-psl/print-psl.enums.test.ts`, `psl-infer/print-psl/print-psl.top-level-blocks.test.ts`, `psl-native-enum-authoring.test.ts`, `psl-native-enum-family-coexistence.test.ts`, `psl-pg-enum-column.test.ts`, `psl-policy-authoring.test.ts`, `psl-policy-map-authoring.test.ts`, `psl-policy-placement.test.ts`, `psl-rls-authoring.test.ts`, `psl-rls-operations.test.ts`, `psl-role-authoring.test.ts`; adapter `rls-lifecycle-e2e`, `rls-migration-plan`, `rls-walking-skeleton-psl` integration tests; `test/integration/test/authoring/parity/ts-psl-rls-parity.test.ts`.

### B.3 Test sites that build a context or registries directly

| Site | What is in scope |
| --- | --- |
| `contract-psl/test/sql-attribute-specs.test.ts:31-34` (shared `controlMutationDefaults` with `dataTypeEntries: fixtureDataTypeSupport.entries`), used at 120, 169-170, 276, 336, 372, 390; empty entries at 321-327 | `fixtureDataTypeSupport` (entries and lookup) |
| `language-server/test/attribute-spec-consumability.test.ts:100-107` (`dataTypeEntries: {}`), `:192-200`, `:227-234` | `interpretation.context` (has `dataTypeLookup`); the first has only `controlMutationDefaults` |
| `test/integration/test/authoring/attribute-specs.lsp-consumability.test.ts:47-54`, `:99-106`, `:168-176` | `interpretation.context` (has `dataTypeLookup`) |
| `2-mongo-family/2-authoring/contract-psl/test/mongo-attribute-specs.test.ts:97-104` | Nothing (`dataTypeEntries: {}`) |
| Mongo interpret inputs with `{ dataTypeEntries: {}, defaultFunctionRegistry: new Map() }`: `interpreter.test.ts:114-117, 164-167, 2223-2226, 2257-2260, 2283-2286`; `interpreter.attribute-specs.test.ts:26-29`; `interpreter.polymorphism.test.ts:76-79`; `3-extensions/mongo/test/scalar-type-parity.test.ts:50-53`; `3-mongo-target/1-mongo-target/test/mongo-runner.polymorphism.integration.test.ts:125-128`; `test/integration/test/mongo/interpreter.enum.test.ts:75-78`; `test/integration/test/mongo/migration-psl-authoring.test.ts:83-86`; `test/integration/test/value-objects/value-objects.integration.test.ts:90-93` | Nothing; Mongo registers no data types |
| `postgres/test/block-documentation.test.ts:5-16, 23` (`{ symbols, block }`) | Postgres target modules only (`postgresDataTypes`, `postgresDataTypeEntries()` can be imported) |
| `psl-parser/test/block-spec.test.ts:640-644`, `block-spec.test-d.ts:149` | Test-local specs |

Language-server tests that build an `AttributeSpecSource` (they pass `ControlMutationDefaults`, not registries): `completion-provider.test.ts` (sources at 254-298, stack helpers 352-371), `completion-field-references.test.ts`, `completion-values.test.ts`, `signature-help.test.ts`, `signature-help-values.test.ts`, `attribute-spec-consumability.test.ts`; `server.test.ts` and `config-resolution.test.ts` go through the server or config.

### B.4 Language server when mutation defaults or contributions are absent

- `config-resolution.ts:24-27`: `emptyPipelineInputs` (`scalarTypes: []`, `pslBlockDescriptors: {}`) is used for a project with no PSL inputs (42-48). It has no `authoringContributions` and no `controlMutationDefaults`.
- `config-resolution.ts:71-80`: `pipelineInputsFromStack` always sets `authoringContributions`. It sets `controlMutationDefaults` only when defined, although `ControlStack.controlMutationDefaults` is required (`control-stack.ts:91`). `ControlStack.dataTypeLookup` exists (`control-stack.ts:88`) but is not copied into `PipelineInputs`.
- `attribute-spec-resolution.ts`: the model branch returns `() => undefined` when `authoringContributions` is absent (65) or when the model symbol or `controlMutationDefaults` is absent (67-69). The field branch does the same (83, 85-87) and also when the field symbol is absent (89). Entries fall back to `{}` (77, 97). The block branch needs only the block symbol (53-54) and ignores both.
- `server.ts:495-500` and `533-538` add `authoringContributions` and `controlMutationDefaults` only when defined; `parsedBlocks` is always passed (494, 532).
- `completion-provider.ts:438-453`: block key completion needs only the descriptor and the block symbol.
- `pipeline.ts:60` and `project-artifacts.ts:188` call `buildSymbolTable` with the real `pslBlockDescriptors` but no data types. If a Postgres block spec uses `dataTypeValue`, these calls parse policy values without a lookup (see the section 6 risk).

## Part C — facts for A06 (general codes for refusals from the shared read and cast)

### C.1 `lowerDataTypeDefault` on the new base (`data-type-default.ts:425-475`, unchanged)

`where` is `` `Field "${input.fieldPath}"${at(refusal.elementIndex)}` `` (436), where `at` gives `` ` at element ${n + 1}` `` or `''` (420-422).

| Refusal kind | Code | Message |
| --- | --- | --- |
| `unreadable` | `refusal.json ? PSL_INVALID_JSON_LITERAL : PSL_INVALID_DEFAULT_LITERAL` | `` `${where}: ${refusal.message}` `` |
| `unknown-tag` | `'PSL_UNKNOWN_DEFAULT_LITERAL_TAG'` | `` `Unknown literal tag "${refusal.tag}". Known tags: ${refusal.known.join(', ')}.` `` |
| `unwritable` | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `` `${where}: this target has no data type for a ${refusal.syntax} value` `` |
| `not-a-list` | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `` `${where}: this column holds a list, so its default is a list literal, as in [1, 2]` `` |
| `no-cast` | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `` `${where}: ${refusal.columnType} has no cast from ${refusal.valueType}; ${describeCasts(refusal.casts)}` `` where `describeCasts` is `'it casts from nothing'` or `` `it casts from ${casts.join(', ')}` `` (477-479) |
| `undecodable` | `PSL_INVALID_DEFAULT_LITERAL` | `` `${where}: ${refusal.message}` `` |

The constants are at 24 (`PSL_INVALID_JSON_LITERAL`), 27-28 (`PSL_INVALID_DEFAULT_LITERAL`), 31-32 (`PSL_DEFAULT_TYPE_INCOMPATIBLE`). `psl-column-resolution.ts:819-826` reports the result at `source.at()`, which is the `@default` attribute, not the written value. ADR 254 line 151 says "Every one points at the written value"; `error-reference.md` says "Reported at the `@default` attribute".

### C.2 Where each refusal comes from inside `readDataTypeDefault`

These are shared once section 4 lands (`readWrittenValue` / `castTypedValue`):

- `readValue` (152-208): `unknown-tag` (178), `unwritable` (179), `unreadable` from a number classifier refusing (187-191, message `no data type of this target holds the number <text>`), `unreadable` from an entry's `parse` throwing (206, `json` true for `CONTRACT.INVALID_JSON_LITERAL`).
- `castInto` (211-245): `no-cast` (221-230), `unreadable` from a cast throwing (235-243).

These stay default-only (not in the shared functions):

- `not-a-list` (323-325).
- `undecodable` from the column codec (294-309).
- A nested list inside a list: `unreadable`, `json: false`, message `a list holds values, not other lists` (332-341 for list columns, 376-386 for list-into-scalar).
- `readListIntoScalar` (354-417): `no-cast` with `valueType: 'a list'` when the column's type has no `listCast` (361-371); `no-cast` when an element's type is not in `listCast.of` (389-399); `unreadable` when `listCast.cast` throws (404-416).

A06 names only `not-a-list` and codec refusal as default-only. The architect should decide the code for the nested-list and list-into-scalar refusals. They are cast-rule refusals, but their origin is default-only code.

The `unknown-tag` arm (444-449) is not reachable from PSL. `lowerTaggedLiteral` checks every tag first (`psl-column-resolution.ts:737-743`), for scalar values (893) and list elements (838).

### C.3 Every place that emits or asserts the four codes

Production:

| Place | Code | Refusal kind |
| --- | --- | --- |
| `contract-psl/src/data-type-default.ts:441` | `PSL_INVALID_JSON_LITERAL` / `PSL_INVALID_DEFAULT_LITERAL` | `unreadable` (shared read or cast; also default-only nested list and list cast) |
| `data-type-default.ts:447` | `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` | `unknown-tag` (shared read; unreachable from PSL) |
| `data-type-default.ts:453` | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `unwritable` (shared read) |
| `data-type-default.ts:459` | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `not-a-list` (default-only) |
| `data-type-default.ts:465` | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `no-cast` (shared cast, or default-only list-into-scalar) |
| `data-type-default.ts:471` | `PSL_INVALID_DEFAULT_LITERAL` | `undecodable` (codec; default-only) |
| `contract-psl/src/psl-column-resolution.ts:741` | `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` | `unknown-tag`, from the `@default` pre-check in `lowerTaggedLiteral` |
| `psl-column-resolution.ts:846` (constant imported at 58) | `PSL_INVALID_DEFAULT_LITERAL` | Lowering tag inside a list literal; section 10 deletes this |
| `framework-components/src/shared/psl-extension-block.ts:81-82` | `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` in the `PslDiagnosticCode` union | `unknown-tag` |

Tests:

| Place | Code asserted | Refusal kind |
| --- | --- | --- |
| `contract-psl/test/interpreter.defaults.data-types.test.ts:121-191` (one `it.each`, code at 185) | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | Mixed rows. Shared `no-cast`: 122-151, 157-161, 167-171, 177-181. Default-only list-into-scalar `no-cast`: 152-156 (`Int @default([1, 2])`), 162-166 (`Jsonb @default([1, 2])`). `not-a-list`: 172-176. Under A06 this table splits by code |
| same file 193-207 (code at 204) | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `unwritable` (shared read) |
| same file 217-224 (221) | `PSL_INVALID_JSON_LITERAL` | `unreadable`, JSON (shared read) |
| same file 226-233 (230) | `PSL_INVALID_DEFAULT_LITERAL` | `undecodable` (codec; keep) |
| same file 235-242 (239) | `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` | `unknown-tag` (pre-check at `psl-column-resolution.ts:741`) |
| `contract-psl/test/interpreter.defaults.tagged-literal.test.ts:137-146` (141; message "Known tags: json, sql, pg.sql.") | `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` | `unknown-tag` (pre-check) |
| same file 239-243 (241) | `PSL_INVALID_JSON_LITERAL` | `unreadable`, JSON (shared read) |
| same file 245-253 (248) | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `no-cast` (shared cast) |
| same file 256-266 (258) | `PSL_INVALID_DEFAULT_LITERAL` | Lowering tag in a list. After section 10 this becomes a shared `no-cast` (`pg/jsonb` has no cast from `sql/expression`) |
| same file 278-285 (281) | `PSL_INVALID_DEFAULT_LITERAL` | `unreadable` from the `bool` entry's `parse` (shared read) |
| `postgres/test/psl-pg-enum-column.test.ts:271-273` (`toContain`) | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `no-cast` (shared cast): `pg.enum(AalLevel)[] @default(["aal1", 3])` is not all strings, so it goes through the cast rule, and `pg/enum` declares no casts (`data-types.ts:58`), so element 1 is refused |
| `test/integration/test/number-defaults/psl-number-defaults.integration.test.ts:224`, `:238` | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `no-cast` (shared cast) |

contract-prisma7 wording: `contract-prisma7/src/defaults.ts:312-328` (`refusalReason`) words each `DefaultRefusal` kind and always reports `PSL.PRISMA7_UNKNOWN_DEFAULT` (93, 379). It emits none of the four codes, so A06 does not change its codes. It changes only if the `DefaultRefusal` fields change (`columnType` at 324, `message`, `tag`, `syntax`, `codecId`). The wording is asserted in `contract-prisma7/test/defaults.test.ts:183-196` (`no-cast`) and 205, 208 (`unreadable`).

Docs:

| Place | Code | What it says |
| --- | --- | --- |
| `docs/reference/error-reference.md:630-632` | `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` | Entry; mentions `pg.sql` and `sqlite.sql` |
| `error-reference.md:634-640` | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `no-cast` and `unwritable`; does not mention `not-a-list` |
| `error-reference.md:642-644` | `PSL_INVALID_DEFAULT_LITERAL` | Entry parse, cast, codec, number classifier |
| `error-reference.md:646-648` | `PSL_INVALID_JSON_LITERAL` | JSON body; "narrowed" form of `PSL_INVALID_DEFAULT_LITERAL` |
| `error-reference.md:262` (`CONTRACT.CAST_REFUSED`) | `PSL_INVALID_DEFAULT_LITERAL` | A cast or entry refusal is reported as this code |
| `error-reference.md:370` (`CONTRACT.INVALID_JSON_LITERAL`) | `PSL_INVALID_JSON_LITERAL` | The JSON reader's refusal is reported as this code |
| `docs/architecture docs/adrs/ADR 254 - Data types and casts.md:151` | All four | No cast, entry parse, JSON, unknown tag |
| `docs/architecture docs/adrs/ADR 129 - Template-Tagged Literals for Extensions.md:82` | `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` | Checked "when the default is lowered" |
| `docs/reference/codec-authoring-guide.md:477` | `PSL_DEFAULT_TYPE_INCOMPATIBLE`, `PSL_INVALID_DEFAULT_LITERAL` | No cast; codec refusal |
| `docs/reference/psl-editor-tooling-tagged-literals.md:13` | All four | Also names `ControlDefaultRegistries.dataTypeEntries` and `pg.sql`/`sqlite.sql` |
| `docs/reference/psl-editor-tooling-tagged-literals.md:21` | `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` | Span check |
| `packages/2-sql/2-authoring/contract-psl/README.md:61` | `PSL_DEFAULT_TYPE_INCOMPATIBLE`, `PSL_INVALID_JSON_LITERAL`, `PSL_INVALID_DEFAULT_LITERAL` | No cast; JSON; reader, cast or codec |
| `contract-psl/README.md:62` | `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` | Also names `pg.sql`/`sqlite.sql` |
| `packages/3-extensions/supabase/src/contract/CONTRACT-FIDELITY.md:19` | `PSL_INVALID_DEFAULT_LITERAL` | Says `@default(null)` is refused with this code. Not produced by `lowerDataTypeDefault` (`null` is not a literal arm), so the claim may already be out of date |
| `upgrade-instructions/pending/data-types-column-defaults/app/instructions.md:59, 82, 102` | `PSL_DEFAULT_TYPE_INCOMPATIBLE` (no cast), `PSL_INVALID_JSON_LITERAL` | Another PR's fragment; section 19 says supersede it in a new fragment rather than edit it |
| `upgrade-instructions/pending/data-types-column-defaults/extension/instructions.md:168, 202` | `PSL_INVALID_DEFAULT_LITERAL` | Cast refusal (168, shared) and codec refusal (202, keep) |

Open point for the architect: whether `PSL_INVALID_JSON_LITERAL` is retired (a JSON body refusal comes from the shared read, so A06 makes it `PSL_INVALID_LITERAL`) or kept as a narrower code. The docs above describe it as a narrowing of `PSL_INVALID_DEFAULT_LITERAL` so a malformed document can be told apart.
