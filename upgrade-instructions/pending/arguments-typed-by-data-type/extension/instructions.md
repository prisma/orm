---
changes:
  - id: spec-contexts-carry-data-types
    summary: |
      `ControlDefaultRegistries` loses `dataTypeEntries`. An attribute spec context carries the stack's data types as `dataTypes: DataTypeSupport`, and `createBinder` and the Mongo PSL interpreter take them as `dataTypes`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bcontrolMutationDefaults\s*:\s*\{[^}]*\bdataTypeEntries\s*:'
        - '\b(AttributeSpecContext|FieldAttributeSpecContext|ControlDefaultRegistries)\b'
        - '\bcreateBinder\s*\('
        - '\binterpretPslDocumentToMongoContract\s*\('
  - id: stack-and-source-context-carry-data-types
    summary: |
      `ControlStack` replaces `dataTypeLookup` with `dataTypes: DataTypeSupport`. `ContractSourceContext`, `InterpretPslDocumentToSqlContractInput` and `InterpretPrisma7DocumentsInput` replace `dataTypeLookup` with `dataTypes: DataTypeSupport`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bdataTypeLookup\s*:'
        - '\b(context|stack)\.dataTypeLookup\b'
  - id: print-path-carries-data-types
    summary: |
      `SqlPslBuildContext` replaces `dataTypeLookup` and `authoringContributions.dataTypes` with `dataTypes: DataTypeSupport`. `DefaultMappingOptions` replaces `dataTypeEntries` and its lookup-only `dataTypes` with `dataTypes: DataTypeSupport`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(SqlPslBuildContext|DefaultMappingOptions)\b'
        - '\bdataTypeEntries\s*:'
        - '\bcontext\.authoringContributions\.dataTypes\b'
  - id: cast-rule-moves-to-the-framework
    summary: |
      `entryForTag`, `WrittenValue` and `DataTypeSupport` are no longer exported from `@internal/sql-contract-psl/resolution`. Import them from `@internal/framework-components/authoring`, which also exports the cast rule for one written value. `DefaultRefusal` is the framework's refusals plus the default-only ones: its `no-cast` arm names `receivingType`, not `columnType`, and `readDataTypeDefault` takes `dataTypes`, not `support`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'import\s*(type\s*)?\{[^}]*\b(entryForTag|WrittenValue|DataTypeSupport)\b[^}]*\}\s*from\s*[''"]@internal/sql-contract-psl/resolution[''"]'
        - '\b(readDataTypeDefault|DefaultRefusal)\b'
  - id: tagged-literal-text-renames
    summary: |
      The canonical value of a tagged literal is its text: `TaggedLiteralCanonicalization` carries `text`, not `body`; `TaggedLiteralExprAst.body()` is `text()`; `parseJsonBody` and `printJsonBody` are `parseJsonText` and `printJsonText`; `checkSqlDefaultBody` and `reservedSqlDefaultBody` are `checkSqlDefaultText` and `reservedSqlDefaultText`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(parseJsonBody|printJsonBody)\b'
        - '\b(canonicalizeTaggedLiteralBody|TaggedLiteralCanonicalization|TaggedLiteralExprAst)\b'
        - '\b(checkSqlDefaultBody|reservedSqlDefaultBody)\b'
  - id: one-of-routes-a-named-function-call
    summary: |
      `oneOf` gives a call to a function that exactly one `funcCall` alternative names to that alternative, and returns its result, success or failure. Other alternatives are not tried for that call.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bfuncCall\s*\('
  - id: default-refusals-point-at-the-written-value
    summary: |
      `@default` reports `PSL_VALUE_TYPE_INCOMPATIBLE` and `PSL_INVALID_LITERAL` at the written value, or at the list element they are about, not at the whole attribute. The `@default` list no longer offers `sql` as an element.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs}"
      matches:
        - '\bPSL_VALUE_TYPE_INCOMPATIBLE\b'
        - '\bPSL_INVALID_LITERAL\b'
        - 'list of \([^)]*\bsql`\.\.\.`'
  - id: default-refusals-say-what-to-write
    summary: |
      A `@default` refusal from the cast rule ends with what to write instead, not the list of types the column casts from. `Unknown literal tag` in a `@default` starts with the field it is about, and `this target has no data type for` starts with a capital and says what to write.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,json}"
      matches:
        - '; it casts from '
        - 'this target has no data type for a (string|boolean|number) value[''"`]'
        - '[''"`]Unknown literal tag '
---

# Arguments typed by a data type

## Spec contexts carry the stack's data types

`ControlDefaultRegistries` held the function registry and the stack's data type authoring entries. It now holds only `defaultFunctionRegistry`. The data types move to the attribute spec context, with their lookup:

```ts
import type { DataTypeSupport } from '@internal/framework-components/authoring';

interface AttributeSpecContext {
  readonly symbols: SymbolTable;
  readonly model: ModelSymbol;
  readonly controlMutationDefaults: ControlDefaultRegistries;
  readonly dataTypes: DataTypeSupport; // { entries, lookup }
}
```

Where code builds a spec context, a binder or a Mongo interpreter input, move the entries out of `controlMutationDefaults` and pass the stack's data types beside it:

```diff
  createBinder({
    sources,
    symbolTable,
    typeConstructors,
    attributeSpecs,
-   controlMutationDefaults: { defaultFunctionRegistry, dataTypeEntries: context.authoringContributions.dataTypes },
+   controlMutationDefaults: { defaultFunctionRegistry },
+   dataTypes: context.dataTypes,
  });
```

- `createBinder` requires `dataTypes`.
- `createSqlBinder` and `createMongoBinder` require `dataTypes`.
- `interpretPslDocumentToMongoContract` requires `dataTypes`.
- A spec context literal (`{ symbols, model, controlMutationDefaults }`) adds `dataTypes`.
- A stack that registers no data types, and a test that needs none, passes `EMPTY_DATA_TYPES` from `@internal/psl-parser`.
- A spec factory that read `ctx.controlMutationDefaults.dataTypeEntries` reads `ctx.dataTypes.entries`.

## The stack and the contract source context carry the data types as one pair

`ControlStack` replaces `dataTypeLookup` with `dataTypes: DataTypeSupport`: its registered data types (`lookup`) with their authoring entries (`entries`, the same object as `authoringContributions.dataTypes`). Code that read `stack.dataTypeLookup` reads `stack.dataTypes.lookup`. `ContractSourceContext` replaces `dataTypeLookup` with the same `dataTypes`, and so do the inputs of the SQL and Prisma 7 interpreters. The SQL interpreter no longer reads entries from `authoringContributions.dataTypes`.

```diff
  const context: ContractSourceContext = {
    authoringContributions: stack.authoringContributions,
-   dataTypeLookup: stack.dataTypeLookup,
+   dataTypes: stack.dataTypes,
    ...
  };

  interpretPslDocumentToSqlContract({
-   dataTypeLookup: lookup,
-   authoringContributions: { ...contributions, dataTypes: entries },
+   dataTypes: { entries, lookup },
+   authoringContributions: contributions,
    ...
  });
```

A test that passed a lookup without entries passes `{ entries: {}, lookup }`. Code that read `context.dataTypeLookup` reads `context.dataTypes.lookup`.

## The contract print path carries the data types as one pair

`SqlPslBuildContext`, which a target's `buildPslContract` receives, carries `dataTypes: DataTypeSupport` from `stack.dataTypes` in place of `dataTypeLookup`, and its `authoringContributions` no longer includes `dataTypes`. `DefaultMappingOptions`, which `mapDefault` takes, had `dataTypeEntries` beside a `dataTypes` that was only the lookup; it now has one `dataTypes: DataTypeSupport`.

```diff
  mapDefault(columnDefault, {
-   dataTypeEntries: context.authoringContributions.dataTypes,
-   dataTypes: context.dataTypeLookup,
+   dataTypes: context.dataTypes,
    columnDataType,
  });
```

A hand-built `SqlPslBuildContext` or `DefaultMappingOptions` passes `dataTypes: { entries, lookup }`. Code that read `options.dataTypes.get(...)` reads `options.dataTypes.lookup.get(...)`.

## `oneOf` gives a call to the function one alternative names

`oneOf` used to try its alternatives in order and, when all failed, report `Expected one of: …` at the whole argument. Now, when the argument is a call to a plain function name and exactly one alternative is a `funcCall` of that name, `oneOf` returns that alternative's result, success or failure. A wrong argument is then reported inside the call, for example `Expected one of: 4 | 7` at the `5` of `uuid(5)`. A call to a dotted or colon-qualified name, a call no alternative names, and a call two alternatives name still try every alternative in order.

An alternative of your own that accepts call expressions, placed beside a `funcCall` of the same name, is no longer tried for that call. Give the function one alternative, or rename one of them. Update an assertion on an `Expected one of` message for such a call to the diagnostic of the function.

## The cast rule for one written value is in the framework

`@internal/framework-components/authoring` exports the ADR 254 cast rule for one written value: `WrittenValue`, `WrittenScalar`, `DataTypeSupport`, `TypedValue`, `ReadRefusal`, `CastRefusal`, `entryForTag`, `entryForPlain`, `knownTags`, `readWrittenValue`, `castTypedValue`, `admittedTags` and `describeAdmittedForms`, and `describeRefusal`, which words a refusal as a PSL code and message. `@internal/sql-contract-psl/resolution` no longer exports `entryForTag`, `WrittenValue` or `DataTypeSupport`; change those imports to `@internal/framework-components/authoring`.

`readDataTypeDefault`, `DefaultRefusal` and `DefaultColumn` stay in `@internal/sql-contract-psl/resolution`. `readDataTypeDefault` takes the stack's data types as `dataTypes`, not `support`, and a refused result carries `suggestedTypes`, the types whose written forms a message suggests. `DefaultRefusal` is the framework's `ReadRefusal` and `CastRefusal` with `elementIndex`, plus `not-a-list`, `no-list-cast`, `no-element-cast` and `undecodable`. Code that read `refusal.columnType` on a `no-cast` refusal reads `refusal.receivingType`. A list written on a column whose type has no list cast is now `no-list-cast`, where it was a `no-cast` whose `valueType` was `'a list'`. An element of a written list that the column type's list cast does not take is now `no-element-cast`, with `receivingType`, `valueType` and the cast's `elementTypes`, where it was a `no-cast` whose `casts` were the list cast's element types.

`entryForTag` now returns the key as a `DataTypeId`.

`@internal/psl-parser` adds the argument type `dataTypeValue(dataType, support)`, which admits any literal the cast rule admits for `dataType`, and `readWrittenScalar`. No built-in attribute uses `dataTypeValue` yet. Its label is the type's tag, as in ``sql`...` ``, or the forms the type admits, as in `a number`.

## The canonical value of a tagged literal is its text

The body is what is written between the quotes; the text is the canonical value. These names change:

| Old | New |
| --- | --- |
| `TaggedLiteralCanonicalization` `{ ok: true, body }`, from `canonicalizeTaggedLiteralBody` | `{ ok: true, text }` |
| `TaggedLiteralExprAst.body()` | `TaggedLiteralExprAst.text()` |
| `parseJsonBody`, `printJsonBody` from `@internal/sql-relational-core/ast` | `parseJsonText`, `printJsonText` |
| `checkSqlDefaultBody`, `reservedSqlDefaultBody` from `@internal/sql-contract/validators` (and `checkSqlDefaultBody` from `@internal/family-sql/control`) | `checkSqlDefaultText`, `reservedSqlDefaultText` |

An entry that registers the `json` tag changes its imports:

```diff
- written: { kind: 'tag', tag: 'json', parse: parseJsonBody },
- print: printJsonBody,
+ written: { kind: 'tag', tag: 'json', parse: parseJsonText },
+ print: printJsonText,
```

The `why` of the `CONTRACT.INVALID_JSON_LITERAL` error `parseJsonText` throws reads `The text is not a JSON document.`

## `@default` refusals point at the written value

`PSL_VALUE_TYPE_INCOMPATIBLE` and `PSL_INVALID_LITERAL` from `@default` used to point at the whole `@default(...)` attribute. They now point at the written value, or at the list element the message names. The codes are unchanged; the messages change as the next section shows. `PSL_DEFAULT_LIST_EXPECTED` and `PSL_INVALID_DEFAULT_LITERAL` still point at the attribute. This supersedes the last row of the table in the pending `sql-is-a-data-type` instructions: a `sql` literal inside a list literal is reported at the element.

The list arm of `@default` no longer offers `sql` as an element, so its label is `list of (string | number | boolean | json`...`)`, and so is the end of the `Expected one of` message. Update an assertion on the span of one of these diagnostics, or on that message.

## Refusals say what to write

`@default` and every other position that takes a value of a data type now word a refusal of the cast rule the same way. A missing cast ends with what to write instead, the forms the column's type admits, not the list of types it casts from. An element of a list written on a column whose type has a list cast, such as a vector, says the list holds a value of the wrong type, and ends with the forms of the list cast's element types. The two other refusals change as the table shows. The codes do not change.

| Written | Message before | Message now |
| --- | --- | --- |
| `count Int @default(100000000000000099)` | `Field "N.count": pg/int4 has no cast from pg/int8; it casts from pg/int2` | `Field "N.count": pg/int4 has no cast from pg/int8; write a number` |
| `meta Jsonb @default("{}")` | `Field "N.meta": pg/jsonb has no cast from pg/text; it casts from pg/json` | ``Field "N.meta": pg/jsonb has no cast from pg/text; write json`...` `` |
| `count Int @default([1])` | `Field "N.count": pg/int4 has no cast from a list; it casts from pg/int2` | `Field "N.count": pg/int4 has no cast from a list; write a number` |
| `embed pgvector.Vector(3) @default([1, "x", 3])` | `Field "N.embed" at element 2: pgvector/vector has no cast from pg/text; it casts from pg/int2, pg/int4, pg/int8, pg/numeric` | `Field "N.embed" at element 2: pgvector/vector has no cast from a list holding pg/text; write a number` |
| `active Int @default(true)` on SQLite | `Field "N.active": this target has no data type for a boolean value` | `Field "N.active": This target has no data type for a boolean value; write a number` |
| ``v String @default(pg.sql`x`)`` | `Unknown literal tag "pg.sql". Known tags: sql, json.` | `Field "N.v": Unknown literal tag "pg.sql". Known tags: sql, json.` |

Update an assertion on one of these messages to the new text.
