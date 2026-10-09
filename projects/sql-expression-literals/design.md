# SQL expression literals — design

This document fixes every name, signature, message and file the project changes. An implementer follows it and makes no design decisions. If the code contradicts this document, stop and raise it; do not improvise. The reasons behind each decision are in [design-notes.md](design-notes.md). Which slice delivers which section is in [plan.md](plan.md).

The project builds on PR #30381 ("Generic block values bind the shared typed expression grammar", ADR 262). Paths are repo-relative. Line numbers are from `47d727b70d` (the head of #30381) and are only a guide; find the code by name. The code survey behind this document is in [research/](research/); [research/rebase-delta.md](research/rebase-delta.md) and [research/block-specs.md](research/block-specs.md) describe the #30381 base.

Slice 2t (sections 4 to 7) is the argument type that other projects reuse; it ships before the six places.

## 1. Vocabulary

- **`sql/expression`**: the data type (ADR 254) of a SQL expression in the target database's language. An expression, not a statement or a query: every place that takes one (a default, an index element, a predicate, a CHECK body) takes an expression. Its canonical form is a JSON string: the text. It has no codec and no DDL name, no column has it, it declares no casts, and no type casts from it. The SQL family defines it and registers it itself; no target registers it.
- **`sql` literal**: the PSL syntax for a value of `sql/expression`: `` sql`...` ``, `sql"..."` or `sql'...'`. Its text is canonicalized by `canonicalizeTaggedLiteralBody` (ADR 129).
- **Typed value**: a value together with its data type, `{ type, value }`, where `value` is the canonical form of `type`.
- **Admitted forms of a type T**: the ways a position of type T can be written: T's own written form and the written forms of the types T casts from.
- **`SqlExpression`**: the TypeScript value of type `sql/expression`, made by the TypeScript `sql` template tag.
- **`OpaqueSql`**: the DDL node for SQL text that Prisma does not parse, placed inside a larger statement.
- **The six places**: `@@index(where:)`, `@@index(expression:)`, `@@fullTextIndex(where:)`, `@@check(expression:)`, a policy block's `using`, and a policy block's `withCheck`. `@default` also takes a `sql` literal but consumes it differently (section 10).

## 2. Shared definitions: `@internal/sql-contract/sql-expression` (slices 2a and 3)

New file `packages/2-sql/1-core/contract/src/sql-expression.ts`. New export file `packages/2-sql/1-core/contract/src/exports/sql-expression.ts` containing `export * from '../sql-expression';`. Add `'src/exports/sql-expression.ts'` to the `entry` list in `packages/2-sql/1-core/contract/tsdown.config.ts`, and `"./sql-expression": "./dist/sql-expression.mjs"` to `exports` in its `package.json`, in alphabetical position. Building the published shells rewrites three `package.json` files with the new subpath: `packages/9-public/@prisma/orm-family-sql/package.json` (`./contract/sql-expression`), and `packages/9-public/@prisma/orm-postgres/package.json` and `packages/9-public/@prisma/orm-sqlite/package.json` (`./family-contract/sql-expression`). Commit the regenerated files in slice 2a.

This package is the lowest one that the authoring packages, the family, both targets and both adapters all depend on ([research/data-types.md](research/data-types.md) §4). It is shared plane, so it imports framework functions only from shared-plane entries.

```ts
// Slice 2a
export const SQL_EXPRESSION_DATA_TYPE_ID: DataTypeId = dataTypeId('sql/expression');
export const SQL_EXPRESSION_TAG = 'sql';

/** The data type of a SQL expression in the target database's language. It declares no casts. The SQL family registers it. ADR 254. */
export const sqlExpressionDataType: DataType = dataType(SQL_EXPRESSION_DATA_TYPE_ID, {});

/** PSL support for `sql/expression`. The SQL family registers it under `SQL_EXPRESSION_DATA_TYPE_ID`. */
export const sqlExpressionAuthoringEntry: DataTypeAuthoringEntry = {
  written: { kind: 'tag', tag: SQL_EXPRESSION_TAG, parse: (text) => text },
  print: (value) => sqlTextFromCanonical(value),
  documentation: "A SQL expression in the target database's language. Prisma passes it to the database unchanged.",
};
// Slice 3 freezes both: the data type and its `casts`, and the entry and its `written` object.

// Slice 3
export interface SqlExpressionRegistration {
  readonly dataTypes: readonly DataType[];
  readonly authoring: {
    readonly dataTypes: Readonly<Record<string, DataTypeAuthoringEntry>>;
  };
}

/** The SQL family's registration of `sql/expression`, shaped as the family descriptor's `dataTypes` and `authoring.dataTypes`. */
export const sqlExpressionRegistration: SqlExpressionRegistration;
// `{ dataTypes: [sqlExpressionDataType], authoring: { dataTypes: { [SQL_EXPRESSION_DATA_TYPE_ID]: sqlExpressionAuthoringEntry } } }`,
// frozen at every level.

/** The SQL text held by the canonical form of a `sql/expression` value. */
export function sqlTextFromCanonical(value: JsonValue): string;
// Returns `value` when it is a string. Otherwise throws
// `new InternalError(\`A sql/expression value is a string, got ${JSON.stringify(value)}.\`)`.

/** A `sql` literal holding `text`, as `contract infer` prints it. */
export function printSqlExpressionLiteral(text: string): string;
// Returns `printTaggedLiteral(SQL_EXPRESSION_TAG, text)` (section 11.1).

// Slice 2b, next to its only caller (section 11.2)
/** Whether every present text reads back unchanged when printed as a `sql` literal. */
export function sqlTextsReadBack(texts: readonly (string | undefined)[]): boolean;
// Each text: `printedTaggedLiteralReadsBack(text)`, the framework's tag-agnostic predicate beside `printTaggedLiteral`.

// Slice 3
const SQL_EXPRESSION_MARKER: unique symbol = Symbol.for('@prisma/sql-expression');

/** A value of the data type `sql/expression` in TypeScript. Its text is always canonical. */
export class SqlExpression {
  readonly [SQL_EXPRESSION_MARKER] = true as const;
  readonly text: string;
  /** Canonicalizes `text` as a PSL `sql` literal's text is canonicalized. Throws CONTRACT.SQL_EXPRESSION_INVALID on NUL or oversize text. */
  constructor(text: string) {
    const canonical = canonicalizeTaggedLiteralBody(text);
    if (!canonical.ok) {
      throw contractError('CONTRACT.SQL_EXPRESSION_INVALID', describeTaggedLiteralFailure(canonical.reason), {
        meta: { reason: canonical.reason, offset: canonical.offset },
      });
    }
    this.text = canonical.body;
    Object.freeze(this);
  }
}

export function isSqlExpression(value: unknown): value is SqlExpression;
// `typeof value === 'object' && value !== null && Reflect.get(value, SQL_EXPRESSION_MARKER) === true` and its `text` is a string.
// The `Symbol.for` marker makes the check work when two installed copies of this package meet at run time.

/** This copy's `SqlExpression` for `value`, or undefined. A marked value from another copy is rebuilt with `new SqlExpression(value.text)`, so its text is canonicalized too. */
export function readSqlExpression(value: unknown): SqlExpression | undefined;
// Returns `value` when it is an instance of this copy's class; `new SqlExpression(value.text)` when `isSqlExpression(value)`; otherwise undefined.
// `.default()`, lowering and `requireSqlExpression` read values through it. (Added in slice 3 review round 3, C01.)

/** Raw SQL written as a template literal: `` sql`"userId" = auth.uid()` ``. Other `sql` values may be interpolated; each later line of one takes the indentation of the template line it sits on. */
export function sql(strings: TemplateStringsArray, ...values: readonly SqlExpression[]): SqlExpression;

/** Returns `value` when it is a `SqlExpression`; throws for anything else. For callers that JavaScript cannot type-check. */
export function requireSqlExpression(value: unknown, what: string): SqlExpression;
```

`SqlExpression` is a class so that an object literal such as `{ text: 'x' }` is not assignable to it (it lacks the symbol-keyed member), and so that `isColumnDefaultLiteralInputValue` rejects it (it accepts only plain objects). The constructor canonicalizes, so no way of making a value skips the cleanup and PSL and TypeScript always store the same text.

`sql` does, in order:

1. For each `values[i]`: if `!isSqlExpression(values[i])`, throw `contractError('CONTRACT.SQL_EXPRESSION_INTERPOLATION', 'sql`...` only interpolates other sql`...` values; write any other text inside the template.', { meta: { index: i } })`.
2. `joined` = `resolveTemplateTagEscapes(strings.raw[0])`, then for each `i`, `values[i].text` followed by `resolveTemplateTagEscapes(strings.raw[i + 1])`. Escapes are resolved per chunk. Each line of `values[i].text` after its first is prefixed with the leading spaces and tabs of the template line on which the `${…}` sits. That indentation comes from the template's own pieces only: it is the leading whitespace of the last line of the most recent piece that holds a line break (or of `strings.raw[0]`), and text inserted from a value never changes it. So two values on one template line both take that line's indentation. The joined text is then what the author sees, so a multi-line value inside an indented template keeps the template's indentation on every line.
3. Return `new SqlExpression(joined)`. The whole joined text is canonicalized once, so the result equals the canonical text of the same SQL written out as one PSL literal.

It performs no other check. An empty text is allowed.

`requireSqlExpression(value, what)` returns `readSqlExpression(value)` when that is defined. Otherwise it throws `contractError('CONTRACT.ARGUMENT_INVALID', \`${what} must be a sql\\\`...\\\` value.\`, { meta: { what } })`, for example ``Index "post_user_active" where must be a sql`...` value.`` Section 15 lists the `what` strings.

In slice 3, add `'SQL_EXPRESSION_INTERPOLATION'` and `'SQL_EXPRESSION_INVALID'` to `ContractSubcode` in `packages/2-sql/1-core/contract/src/contract-errors.ts`.

Imports: `dataType`, `dataTypeId`, `DataType`, `DataTypeId` from `@internal/framework-components/codec`; `DataTypeAuthoringEntry`, `canonicalizeTaggedLiteralBody`, `describeTaggedLiteralFailure`, `resolveTemplateTagEscapes`, `printTaggedLiteral` from `@internal/framework-components/authoring`; `JsonValue` from `@internal/contract/types`; `InternalError` from `@internal/utils/internal-error`; `contractError` from `./contract-errors`. Each function is added to `packages/1-framework/1-core/framework-components/src/exports/authoring.ts` (shared plane) in the slice that first imports it from there: `printTaggedLiteral` in slice 2a, `canonicalizeTaggedLiteralBody` and `printedTaggedLiteralReadsBack` in slice 2b (`canonicalizeTaggedLiteralBody` is then exported from `authoring.ts` only, and its `control.ts` export is removed), and `describeTaggedLiteralFailure` and `resolveTemplateTagEscapes` in slice 3. The last three keep their existing exports from `control.ts`; `printTaggedLiteral` is exported from `authoring.ts` only.

## 3. Registration and the removal of lowering entries (slice 2a)

### 3.1 The family registers its type and entry

- `packages/2-sql/9-family/src/core/control-descriptor.ts`: `SqlFamilyDescriptor` gets `readonly dataTypes = sqlExpressionRegistration.dataTypes` and `dataTypes: sqlExpressionRegistration.authoring.dataTypes` in its `authoring`. `sqlExpressionRegistration` (section 2) holds `[sqlExpressionDataType]` and `{ [SQL_EXPRESSION_DATA_TYPE_ID]: sqlExpressionAuthoringEntry }`, frozen, so no importer can change what the family registers. The owner of the type and the component that registers it are then one component, and a new SQL target has nothing to remember. ADR 254 allows a family to register only a type that is the same on every target and that nothing casts from.
- The targets' lists hold only their own types: `postgresDataTypes`, `postgresDataTypeEntries()`, `sqliteDataTypes` and `sqliteDataTypeEntries()` do not contain `sql/expression`. In `packages/3-targets/3-targets/postgres/src/core/data-type-entries.ts`, replace the doc sentence about `sql` and `pg.sql` with: "The `sql` tag is not here: it writes `sql/expression`, which the SQL family defines and registers itself."
- Every production path that reads the stack's data types assembles the family with the target, the adapter and the extensions (`createControlStack`), so it sees the type and entry. `contract infer` does not read the stack (section 11.1), which changes no output.
- The stack assembles the family first, so messages and completion list the tags in the order `sql, json`: `Unknown literal tag "pg.sql". Known tags: sql, json.`

### 3.2 Adapters register the target's entries unchanged

- Delete `packages/3-targets/6-adapters/postgres/src/core/data-type-authoring.ts` and `packages/3-targets/6-adapters/sqlite/src/core/data-type-authoring.ts`.
- `packages/3-targets/6-adapters/postgres/src/exports/control.ts`: `dataTypes: postgresDataTypeEntries()` from `@internal/target-postgres/data-types`. SQLite: `dataTypes: sqliteDataTypeEntries()` from `@internal/target-sqlite/data-types`.
- No component registers `pg.sql` or `sqlite.sql`. Each target registers the tag `json`; the family registers `sql`.

### 3.3 The family's lowering entry is deleted

- Delete `packages/2-sql/9-family/src/core/sql-default-literal-tag.ts`.
- `packages/2-sql/9-family/src/exports/control.ts`: remove the exports `PSL_INVALID_DEFAULT_SQL` and `sqlDefaultLiteralTagEntry`. Keep the re-export of `checkSqlDefaultText`.
- Delete `packages/2-sql/9-family/test/sql-default-literal-tag.test.ts`. Add its `checkSqlDefaultText` cases to the existing `packages/2-sql/1-core/contract/test/default-sql-text.test.ts`.

### 3.4 The framework loses the lowering-entry kind

In `packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts`:

- Delete `DataTypeLoweringAuthoringEntry`, `AuthoringDataTypeEntry`, `LOWERING_ENTRY_PREFIX`, `loweringEntryKey`, `isLoweringEntryKey` and `isDataTypeLoweringEntry`, and remove their exports from `src/exports/authoring.ts`.
- Delete the member `lower?: never` from `DataTypeAuthoringEntry`.
- `AuthoringContributions.dataTypes` becomes `Readonly<Record<string, DataTypeAuthoringEntry>>`, documented "PSL support for the data types this contribution owns, keyed by data type id. ADR 254."
- Replace every use of `AuthoringDataTypeEntry` in the repo with `DataTypeAuthoringEntry`.

In `mutation-default-types.ts`: delete `TaggedLiteralValue` and its export from `src/exports/control.ts`.

In `control-stack.ts`: delete the two `isLoweringEntryKey` skips (rule 2 and the `writable` set). Every entry key must be a registered data type id.

### 3.5 The family refuses a cast from `sql/expression`

`@internal/sql-contract/sql-expression` exports `assertNothingCastsFromSqlExpression(declaredDataTypes: ReadonlyArray<{ readonly type: DataType; readonly contributedBy: string }>): void`. It throws `runtimeError('CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION', ...)`, the kind of error `enforceDataTypeInvariants` throws for a pack's mistake, when a type names `sql/expression` in `casts` or in `listCast.of`. The message names the type, the component that registered it and the rule: `` Data type "<id>" from "<contributedBy>" declares a cast from sql/expression. No data type may cast from sql/expression: a sql literal is SQL the database runs, not a value of another type. `` (or `a list cast`). The payload is `{ dataType, contributedBy }`, like the other `CONTRACT.DATA_TYPE_*` errors. It imports `runtimeError` from the shared-plane entry `@internal/framework-components/components`, which also exports `isRuntimeError` and `RuntimeErrorEnvelope`: stack-integrity errors share the framework's envelope. `createSqlFamilyInstance` calls it with `stack.declaredDataTypes`, the list `assembleDataTypes` builds, which `ControlStack` exposes with the id of each type's contributor. A `DataTypeLookup` has no way to list the types.

## 4. The cast rule moves into the framework (slice 2t)

New file `packages/1-framework/1-core/framework-components/src/shared/written-value.ts`, exported from `src/exports/authoring.ts`. It holds the family-blind half of `packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts`, so that the parser's combinator (section 6) can run the ADR 254 cast rule.

```ts
/** One written value, in the syntax a contract source wrote it in. The framework defines the list shape, and the family's default reader is the only reader of it. ADR 254. */
export type WrittenValue =
  | { readonly kind: 'tag'; readonly tag: string; readonly text: string }
  | { readonly kind: 'string'; readonly text: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'number'; readonly text: string }
  | { readonly kind: 'list'; readonly elements: readonly WrittenValue[] };

export type WrittenScalar = Exclude<WrittenValue, { readonly kind: 'list' }>;

/** A stack's registered data types with their authoring entries. */
export interface DataTypeSupport {
  readonly entries: Readonly<Record<string, DataTypeAuthoringEntry>>;
  readonly lookup: DataTypeLookup;
}

/** A value with its data type; `value` is the canonical form of `type`. */
export interface TypedValue {
  readonly type: DataTypeId;
  readonly value: JsonValue;
}

export type ReadRefusal =
  | { readonly kind: 'unreadable'; readonly message: string }
  | { readonly kind: 'unknown-tag'; readonly tag: string; readonly known: readonly string[] }
  | { readonly kind: 'unwritable'; readonly syntax: 'string' | 'boolean' | 'number' };

export type CastRefusal =
  | { readonly kind: 'no-cast'; readonly receivingType: DataTypeId; readonly valueType: DataTypeId; readonly casts: readonly string[] }
  | { readonly kind: 'unreadable'; readonly message: string };

export function entryForTag(support: DataTypeSupport, tag: string):
  { readonly key: string; readonly entry: DataTypeAuthoringEntry } | undefined;
export function entryForPlain(support: DataTypeSupport, syntax: 'string' | 'boolean' | 'number'):
  { readonly key: string; readonly entry: DataTypeAuthoringEntry } | undefined;
export function knownTags(support: DataTypeSupport): readonly string[];
export function readWrittenValue(support: DataTypeSupport, written: WrittenScalar): Result<TypedValue, ReadRefusal>;
export function castTypedValue(support: DataTypeSupport, receivingType: DataTypeId, typed: TypedValue): Result<TypedValue, CastRefusal>;
export function admittedTags(support: DataTypeSupport, dataType: DataTypeId): readonly string[];
export type WrittenForm =
  | { readonly kind: 'tag'; readonly tag: string; readonly phrase: string }
  | { readonly kind: 'string' | 'boolean' | 'number'; readonly phrase: string };
export function tagForm(tag: string): WrittenForm;
export function admittedForms(support: DataTypeSupport, receivingTypes: readonly DataTypeId[]): readonly WrittenForm[];
export function describeAdmittedForms(support: DataTypeSupport, dataType: DataTypeId): string;

/** A cast-rule refusal worded for a diagnostic. */
export interface RefusalDescription {
  readonly code: 'PSL_UNKNOWN_LITERAL_TAG' | 'PSL_VALUE_TYPE_INCOMPATIBLE' | 'PSL_INVALID_LITERAL';
  readonly message: string;
}
export interface RefusalGuidance {
  readonly forms: readonly WrittenForm[];
  readonly rewrite: string | undefined;
}
export function describeRefusal(
  refusal: ReadRefusal | CastRefusal,
  support: DataTypeSupport,
  guidance: RefusalGuidance,
): RefusalDescription;
export function describeExpected(forms: readonly WrittenForm[]): string;
export function describeRefusedValueType(
  refused: { readonly receivingType: DataTypeId; readonly valueType: DataTypeId },
  support: DataTypeSupport,
  guidance: RefusalGuidance,
): string;
export function exactRewrite(support: DataTypeSupport, receivingType: DataTypeId, written: WrittenScalar): string | undefined;
```

`Result`, `ok` and `notOk` come from `@internal/utils/result`. The `tag` arm of `WrittenValue` names its field `text`, like the others (renamed in slice 2a, section 10).

Behaviour:

- `entryForTag` and `entryForPlain` return the matching entry under its raw string key, which is not always a data type id: SQLite's `json` tag sits under `tag:json`. The value's data type comes from `authoringEntryType(key, entry)`: the tag's `type` when the tag declares one, or else the key.
- `entryForTag`, `entryForPlain`, `knownTags`, `readWrittenValue` and `castTypedValue` are the current `entryForTag`, `entryForPlain`, `knownTags`, `readValue` and `castInto` from `data-type-default.ts`, with these changes: no lowering-entry filter; refusals carry no `elementIndex`; an `unreadable` refusal has no `json` field (section 10.1 retires the JSON-specific code); `castTypedValue` returns a `TypedValue` of the receiving type, and its `no-cast` refusal names the receiving type `receivingType`.
- `admittedTags(support, T)` returns, without duplicates and in this order: the tag of the entry keyed `T` when its written form is a tag; then, for each key `S` of `support.lookup.get(T)?.casts` in key order, the tag of the entry keyed `S` when its written form is a tag.
- `describeRefusal(refusal, support, guidance)` is the one wording of a cast-rule refusal. Every message leads with what to write. `guidance` is `{ forms, rewrite }`: `forms` are the admitted forms (`admittedForms`), whose phrases `describeExpected` joins with ` or ` as `F` in `` `Expected ${F}` ``, and `rewrite` is `exactRewrite` of the written value or `undefined`. `unknown-tag`: `PSL_UNKNOWN_LITERAL_TAG`, `` `Unknown literal tag "${tag}". Known tags: ${known.join(', ')}.` ``. `unwritable`: `PSL_VALUE_TYPE_INCOMPATIBLE`, `` `Expected ${F}; this target has no data type for a ${syntax} value` ``. `unreadable`: `PSL_INVALID_LITERAL`, the refusal's message. `no-cast`: `PSL_VALUE_TYPE_INCOMPATIBLE`, worded by `describeRefusedValueType`: when the value type's written form is one of `forms` (a number too large or not whole for a number type), `` `Expected ${F} that ${receivingType} can hold; got ${valueType}` ``; otherwise `` `Expected ${F}` ``, followed by `` `; write ${rewrite}` `` when there is a rewrite. Two forms are the same when their kinds are, and, for tags, their tags; the phrases are not compared. Each consumer adds only its location, if any.
- `exactRewrite(support, T, written)` is `printTaggedLiteral(tag, written.text)`, with `tag` the first of `admittedTags(support, T)`, when `written` is a quoted string, `T` admits a tag, `printedTaggedLiteralReadsBack(written.text)` holds, and `T` takes the tagged literal (it reads and casts without a refusal); `undefined` otherwise. `dataTypeValue` and `@default` both use it, so `meta Jsonb @default("{}")` gets ``Field "N.meta": Expected json`...`; write json`{}` ``.
- `admittedForms(support, types)` builds forms without duplicates, for each type `T` in `types`, `T` and then each cast source `S` in key order. For a type `X`: a tag entry gives `tagForm(tag)`, whose phrase is `` `${tag}\`...\`` ``; a plain string entry gives `a quoted string`; a plain boolean entry gives `true or false`; if `X` keys a plain number entry or is listed in any plain number entry's `types`, `a number`. `describeAdmittedForms` joins the phrases of one type's forms with ` or `, or returns `no written form`; `dataTypeValue` uses it only for its label. For `sql/expression` it returns ``sql`...` ``; for `pg/bool`, `true or false`; for `pg/int4`, `a number`.

`contract-psl` keeps `DefaultRefusal`, `readDataTypeDefault` and `lowerDataTypeDefault`. It deletes its own `WrittenValue`, `DataTypeSupport`, `entryForTag`, `entryForPlain`, `knownTags`, `plainText`, `readValue` and `castInto`, and imports the framework versions. `DefaultRefusal` is the framework's `ReadRefusal | CastRefusal` with `elementIndex`, plus four arms only a default has: `not-a-list`, `no-list-cast` (a list written on a scalar column whose type has no list cast, with `receivingType` and `casts`), `no-element-cast` (an element of a written list that the column type's list cast does not take, with `receivingType`, `valueType` and the cast's `elementTypes`) and `undecodable`. A refused `ReadDefaultResult` carries `suggestedTypes`: the column's type, or the element types of its list cast for an element of a list read through that cast. `lowerDataTypeDefault` words every cast-rule refusal with `describeRefusal`, passing `admittedForms` of `suggestedTypes` and, for a `no-cast`, `exactRewrite` of the refused written value, and prefixes `Field "X.y": ` or `Field "X.y" at element n: `. It words `no-list-cast` as `` `${describeExpected(forms)}; got a list` ``, and `no-element-cast` with `describeRefusedValueType`, the column's type as the receiving type, as in `Expected a number`, both `PSL_VALUE_TYPE_INCOMPATIBLE`, and the two default-only codes as before. `contract-prisma7` reads `receivingType`, words `no-list-cast` as `holds a list, which <type> has no cast from; it casts from <types>.` and `no-element-cast` as `holds a <value type> value at element n, which the list cast of <type> does not take; it takes <element types>.` `contract-psl/src/exports/resolution.ts` stops exporting `entryForTag`, `WrittenValue` and `DataTypeSupport`; `contract-prisma7` imports them from `@internal/framework-components/authoring`.

`@default` does not check a tag before it reads the value. `psl-column-resolution.ts` only canonicalizes a tagged literal; an unknown tag reaches `lowerDataTypeDefault` through `readWrittenValue`, whose `unknown-tag` refusal `lowerDataTypeDefault` reports as `PSL_UNKNOWN_LITERAL_TAG` at the written value, or at the list element it is about, worded by `describeRefusal`.

## 5. Reading PSL syntax into a written scalar (slice 2t)

New file `packages/1-framework/2-authoring/psl-parser/src/written-scalar.ts`. Export `readWrittenScalar` and `type WrittenScalarResult` from `src/exports/index.ts`:

```ts
/** The written scalar a PSL literal expression is, or why it is not one. */
export type WrittenScalarResult =
  | { readonly ok: true; readonly written: WrittenScalar }
  | { readonly ok: false; readonly reason: 'nul' | 'too-large' }
  | { readonly ok: false; readonly reason: 'not-a-literal'; readonly found: 'an identifier' | 'a function call' | 'a list' | 'an object' | 'an expression' };

/** Reads a PSL literal expression as a `WrittenScalar`, for a position that takes a value of a data type. ADR 254. */
export function readWrittenScalar(expression: ExpressionAst): WrittenScalarResult;
```

| Expression | Result |
| --- | --- |
| `StringLiteralExprAst` (any quote style) | `{ ok: true, written: { kind: 'string', text: literal.value() } }` |
| `NumberLiteralExprAst` | `{ ok: true, written: { kind: 'number', text } }` with the token text `numLiteral()` reads; a missing token is `not-a-literal`, `found: 'an expression'` |
| `BooleanLiteralExprAst` | `{ ok: true, written: { kind: 'boolean', value } }`, read the way `bool()` reads it |
| `TaggedLiteralExprAst`, canonicalization ok | `{ ok: true, written: { kind: 'tag', tag: literal.tagName(), text: canonicalization.text } }` |
| `TaggedLiteralExprAst`, canonicalization failed | `{ ok: false, reason: canonicalization.reason }` |
| identifier | `not-a-literal`, `found: 'an identifier'` |
| function call | `not-a-literal`, `found: 'a function call'` |
| array literal | `not-a-literal`, `found: 'a list'` |
| object literal | `not-a-literal`, `found: 'an object'` |
| anything else | `not-a-literal`, `found: 'an expression'` |

Match nodes by syntax kind (`XxxAst.cast(expression.syntax)`), as the combinators do.

## 6. The `dataTypeValue` combinator (slice 2t)

New file `packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/data-type-value.ts`. Export `dataTypeValue`, and add `ParsedTypedValue` and `DataTypeValueArgType` to the type exports, in `src/exports/index.ts`.

In `packages/1-framework/2-authoring/psl-parser/src/attribute-spec/types.ts`, add `'dataTypeValue'` to `ArgTypeKind`, add `DataTypeValueArgType<Ctx>` to `InspectableArgType`, and add:

```ts
/** A typed value parsed from an argument, with the argument's span. */
export interface ParsedTypedValue extends TypedValue {
  readonly span: PslSpan;
}

export interface DataTypeValueArgType<Ctx extends AttributeCtx = AttributeCtx>
  extends ArgTypeOutput<ParsedTypedValue, Ctx> {
  readonly kind: 'dataTypeValue';
  readonly dataType: DataTypeId;
  /** The tags a position of this type admits (section 1), for completion. */
  readonly tags: readonly string[];
  /** The documentation of this type's authoring entry, or '' when it has none. */
  readonly documentation: string;
}
```

```ts
/** An argument typed by a data type: any literal, admitted by the ADR 254 cast rule. Used as a parameter of an attribute or a `funcCall`. ADR 231, ADR 254. */
export function dataTypeValue(dataType: DataTypeId, support: DataTypeSupport): DataTypeValueArgType<AttributeCtx>;
```

`dataTypeValue` is used as a parameter of an attribute, a block or a `funcCall`, never as a bare arm of `oneOf`, which would replace its diagnostics with `Expected one of: …`. An alternative may claim an argument whose shape is its own (`ArgType.claims`); `funcCall` claims a call to its name whose callee is a plain identifier. When exactly one alternative claims the argument, `oneOf` returns that alternative's result, success or failure, so the diagnostics about the call's arguments are kept. So `oneOf(funcCall('f', { positional: [dataTypeValue('pg/int4', support)] }), str())` given `f("8")` reports `Expected a number` at `"8"`; given `other(1)` it still reports `Expected one of: f() | string`.

Construction never throws. The language server builds every spec only to list attribute names, including on stacks that lack the type.

- `tags = admittedTags(support, dataType)`; `documentation = support.entries[dataType]?.documentation ?? ''`.
- `label = tags.length > 0 ? \`${tags[0]}\\\`...\\\`\` : describeAdmittedForms(support, dataType)` (for `sql/expression`, ``sql`...` ``; for `pg/int4`, `a number`; for a boolean type, `true or false`).

`parse(arg, ctx)`, with `T = dataType`, `forms = admittedForms(support, [T])` (computed once, when the spec is built) and `F` their phrases joined with ` or `. Every diagnostic is `leafDiagnostic(ctx, arg, message, code)`, so its span is the argument value:

0. If `!support.lookup.has(T)`, throw `new InternalError(\`An argument receives data type "${T}", which this stack does not register.\`)`. This is a pack bug: a spec names a type its stack lacks. If `forms` is empty, throw `new InternalError(\`An argument receives data type "${T}", which nothing in this stack writes.\`)`, the same kind of pack bug.
1. `const literal = readWrittenScalar(arg)`.
   - `not-a-literal`: code `PSL_INVALID_ATTRIBUTE_SYNTAX`, message `` `${describeExpected(forms)}; got ${found}` `` (for example ``Expected sql`...`; got an identifier``).
   - `nul` / `too-large`: codes `PSL_TAGGED_LITERAL_NUL` / `PSL_TAGGED_LITERAL_TOO_LARGE`, message `describeTaggedLiteralFailure(reason)`.
2. `const read = readWrittenValue(support, literal.written)`. A refusal is `describeRefusal(refusal, support, { forms, rewrite: undefined })` (section 4):
   - `unknown-tag`: code `PSL_UNKNOWN_LITERAL_TAG`, message `` `Unknown literal tag "${tag}". Known tags: ${known.join(', ')}.` ``.
   - `unwritable`: code `PSL_VALUE_TYPE_INCOMPATIBLE`, message `` `Expected ${F}; this target has no data type for a ${syntax} value` ``.
   - `unreadable`: code `PSL_INVALID_LITERAL`, message `refusal.message`.
3. `const cast = castTypedValue(support, T, read.value)`. A refusal is `describeRefusal(refusal, support, { forms, rewrite })`, where `rewrite` is `exactRewrite(support, T, literal.written)` (section 4):
   - `no-cast` of a string for a type with a tag, whose text reads back: code `PSL_VALUE_TYPE_INCOMPATIBLE`, message `` `Expected ${F}; write ${rewrite}` ``. The message ends with the exact rewrite.
   - `no-cast` of a value whose written form is one of `forms`: code `PSL_VALUE_TYPE_INCOMPATIBLE`, message `` `Expected ${F} that ${T} can hold; got ${valueType}` ``.
   - other `no-cast`: code `PSL_VALUE_TYPE_INCOMPATIBLE`, message `` `Expected ${F}` ``.
   - `unreadable`: code `PSL_INVALID_LITERAL`, message `refusal.message`.
4. Return `ok({ type: T, value: cast.value.value, span: nodePslSpan(arg.syntax, ctx.sources) })`.

Examples on Postgres:

- `where: "(archived_at IS NULL)"`: `PSL_VALUE_TYPE_INCOMPATIBLE`, ``Expected sql`...`; write sql`(archived_at IS NULL)` ``.
- `where: archived`: `PSL_INVALID_ATTRIBUTE_SYNTAX`, ``Expected sql`...`; got an identifier``.
- `where: 42`: `PSL_VALUE_TYPE_INCOMPATIBLE`, ``Expected sql`...` ``.
- `` where: pg.sql`x` ``: `PSL_UNKNOWN_LITERAL_TAG`, `Unknown literal tag "pg.sql". Known tags: sql, json.`

## 7. Spec contexts carry the stack's data types (slice 2t)

- `AttributeSpecContext` (`packages/1-framework/2-authoring/psl-parser/src/attribute-spec/spec-context.ts`) gains `readonly dataTypes: DataTypeSupport`. `ControlDefaultRegistries` (`mutation-default-types.ts`) loses `dataTypeEntries` and keeps only `defaultFunctionRegistry`; update its doc to "What an attribute spec needs to build its `@default` function arms."
- `scalarDefaultArms` (`contract-psl/src/sql-attribute-specs.ts`) becomes `scalarDefaultArms(isList: boolean, dataTypes: DataTypeSupport, registries: ControlDefaultRegistries)` and reads tags from `dataTypes.entries`; `defaultFieldSpec` calls it with `ctx.field.list, ctx.dataTypes, ctx.controlMutationDefaults`.
- `modelSpecContext` and `fieldSpecContext` (`sql-attribute-specs.ts`) take `dataTypes: DataTypeSupport` and set it.
- Every construction site passes the stack's data types ([research/rebase-delta.md](research/rebase-delta.md) Part B lists them with what each has in scope):
  - The stack and the source context: `ControlStack` gains `readonly dataTypes: DataTypeSupport`, built once in `createControlStack` from `authoringContributions.dataTypes` and the assembled lookup. `ContractSourceContext` replaces `dataTypeLookup` with `readonly dataTypes: DataTypeSupport`; its two production construction sites (`load-contract-source.ts` and the language server's `config-resolution.ts`) pass `stack.dataTypes`. The SQL and Prisma 7 interpreter inputs replace `dataTypeLookup` with `dataTypes`, which their providers take from `context.dataTypes`; the SQL interpreter no longer reads entries from `authoringContributions.dataTypes`. (Added in the slice 2t review fixes.)
  - The contract print path: `ControlStack` loses `dataTypeLookup`; every reader uses `stack.dataTypes.lookup`. `SqlPslBuildContext` (`family-sql/src/core/control-target-descriptor.ts`) replaces `dataTypeLookup` and `authoringContributions.dataTypes` with `readonly dataTypes: DataTypeSupport`, which `control-instance.ts` fills from `stack.dataTypes`. `DefaultMappingOptions` in `default-mapping.ts` replaces `dataTypeEntries` and its lookup-only `dataTypes` with `dataTypes: DataTypeSupport`; `mapDefault`, the Postgres printer (`psl-print/column-defaults.ts`) and `createPostgresDefaultMapping` pass the pair. (Added in the slice 2t round 2 review fixes.)
  - contract-psl: `psl-column-resolution.ts` and `psl-field-resolution.ts` pass `dataTypes: input.dataTypes`; `interpreter.ts` builds one context per model (section 8.1) with `dataTypes: input.dataTypes`. The field that holds the pair is named `dataTypes` everywhere.
  - Mongo: the interpret input gains `readonly dataTypes: DataTypeSupport`. `mongo contract-psl/src/provider.ts` passes `context.dataTypes` and drops `dataTypeEntries` from `controlMutationDefaults`. `specContextFor` sets `dataTypes: input.dataTypes`. Mongo tests pass `EMPTY_DATA_TYPES`, which is that value.
  - Language server: `LspControlStack` (`lsp-control-stack.ts`) gains `readonly dataTypes?: DataTypeSupport`; `lspControlStackFromStack` (`config-resolution.ts`) sets `stack.dataTypes`. `AttributeSpecSource` (`attribute-spec-resolution.ts`) gains `readonly dataTypes?: DataTypeSupport`; the model and field branches set `dataTypes: source.dataTypes ?? EMPTY_DATA_TYPES` and no longer read `authoringContributions.dataTypes`. `EMPTY_DATA_TYPES` (`{ entries: {}, lookup: createDataTypeLookup([]) }`) is a constant in `psl-parser/src/attribute-spec/spec-context.ts`, exported as a value from `psl-parser/src/exports/index.ts`. An absent `dataTypes` never disables a resolver. `project.ts` already spreads `data.controlStack` into both `candidates` objects, so the source receives `dataTypes` with no other edit. (Corrected in slice 2t: the design named `PipelineInputs`, `pipeline.ts` and a `server.ts` edit, which `main` no longer has.)
  - The binder: `CreateBinderOptions` (`psl-parser/src/binder.ts`) gains a required `dataTypes: DataTypeSupport`, which it puts in the spec context of every model and field attribute it binds. `createSqlBinder` and `createMongoBinder` take a required `dataTypes`; the SQL interpreter passes the stack's, so a new caller cannot silently build a binder with no tag arms. (Corrected in the slice 2t review fixes: the design made it optional on `createSqlBinder`.) (Added in slice 2t: [research/rebase-delta.md](research/rebase-delta.md) Part B missed this site.)
  - Tests: every test that builds `controlMutationDefaults` with `dataTypeEntries` moves the entries to `dataTypes` ([research/rebase-delta.md](research/rebase-delta.md) B.3).
- The block spec context: section 9.1.

### 7.1 Carried over from the slice 2t review, done in slice 2b

- `ControlDefaultRegistries` is deleted. `AttributeSpecContext` carries `readonly defaultFunctionRegistry: ControlMutationDefaultRegistry` in place of `controlMutationDefaults`. `CreateBinderOptions`, `createSqlBinder`, `createMongoBinder`, `modelSpecContext`, `fieldSpecContext` and the Mongo interpreter input take `defaultFunctionRegistry`; the Mongo provider passes `context.controlMutationDefaults.defaultFunctionRegistry`. The language server passes `source.controlMutationDefaults.defaultFunctionRegistry`.
- The `@default` literal arms yield a written scalar with its span. `psl-parser` exports `writtenScalar(arm)`, which wraps a literal arm, keeps its kind and metadata, and yields `ParsedWrittenScalar` (`{ kind: 'scalar', written, span }`, or `{ kind: 'scalar', written: undefined, reason: 'nul' | 'too-large', span }` for a tagged literal that does not canonicalize), and `writtenList(of)`, generic over the context like `writtenScalar`, which yields `ParsedWrittenList` (`{ kind: 'list', elements, span }`). The other `@default` arms yield `{ kind: 'default-function', call }` (`DefaultFunctionCall`, a call to a registered default function, named apart from the contract's `{ kind: 'function' }` storage default) and `{ kind: 'member', name }`, so lowering switches on `kind`. `lowerDataTypeDefault` takes `spans: DefaultSpans` (`attribute`, `value`, `elements`) and returns the `span` to report at; `DefaultRefusalPlace`, `writtenScalar`, `defaultValueExpression` and `listElements` in `psl-column-resolution.ts` are gone. Every `@default` diagnostic keeps its code, message and span.

## 8. The attribute places (slice 2b)

### 8.1 `@@index` and `@@check`

In `packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts`:

- `indexModelSpec` becomes `function indexModelSpec(ctx: AttributeSpecContext)`. `expression` and `where` become `optional(dataTypeValue(SQL_EXPRESSION_DATA_TYPE_ID, ctx.dataTypes))`. Documentation strings stay. `refine` is unchanged.
- `checkModelSpec` becomes `function checkModelSpec(ctx: AttributeSpecContext)`. `expression` becomes `dataTypeValue(SQL_EXPRESSION_DATA_TYPE_ID, ctx.dataTypes)`. In `refine`, the empty check reads `sqlTextFromCanonical(value.expression.value).trim().length === 0`; code and message unchanged.
- Registry: `index: (ctx) => indexModelSpec(ctx)`, `check: (ctx) => checkModelSpec(ctx)`.

In `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts`, in `buildModelNodeFromPsl`:

- Build one context per model: `const specContext = modelSpecContext({ symbols: input.symbolTable, model, defaultFunctionRegistry: input.defaultFunctionRegistry, dataTypes: input.dataTypes })`. (Corrected in slice 2b: `AttributeSpecContext` has no `parsedBlocks` field on `main`, so there is none to copy; the context carries `defaultFunctionRegistry` directly, see below.)
- Pass it to `sqlAttributeSpecs.model.index(specContext)`, `sqlAttributeSpecs.model.check(specContext)` and the contributed model attribute factory (replacing the inline object at about line 1154). The other `sqlAttributeSpecs.model.*` factories take no argument.
- `@@index` node: `...ifDefined('expression', parsed.expression === undefined ? undefined : sqlTextFromCanonical(parsed.expression.value))` and `where: parsed.where === undefined ? undefined : sqlTextFromCanonical(parsed.where.value)`.
- `@@check` node: `expression: sqlTextFromCanonical(parsed.expression.value)`.

`IndexNode`, `CheckNode`, `lowerAuthoredIndex` and `lowerAuthoredCheck` keep strings.

### 8.2 `@@fullTextIndex`

In `packages/3-targets/3-targets/postgres/src/core/authoring.ts`: `postgresFullTextIndexSpec` becomes a function of `ctx: AttributeSpecContext` with `where: optional(dataTypeValue(SQL_EXPRESSION_DATA_TYPE_ID, ctx.dataTypes))`; `postgresFullTextIndexSpecFactory = (ctx) => postgresFullTextIndexSpec(ctx)`; `PostgresFullTextIndexParsed.where?: ParsedTypedValue`; `lower` passes `where: parsed.where === undefined ? undefined : sqlTextFromCanonical(parsed.where.value)`.

### 8.3 A guard for future places

New test `packages/3-targets/3-targets/postgres/test/sql-expression-places.test.ts` (contract-psl cannot depend on the target). It builds `sqlAttributeSpecs` from `@internal/sql-contract-psl/attribute-specs`, the `fullTextIndex` descriptor's spec and the three policy spec functions, with `dataTypes: { entries: postgresDataTypeEntries(), lookup: createDataTypeLookup(postgresDataTypes) }`, and asserts that the arguments of the six places are `dataTypeValue` of `sql/expression`. A future raw-SQL place written with `str()` must be added to this test, which makes the choice visible in review.

## 9. Policy predicates (slice 2b)

On the #30381 base, policy blocks are `fixedBlock` specs in `packages/3-targets/3-targets/postgres/src/core/authoring.ts`: `policyUsingParam` and `policyWithCheckParam` are `optional(str())`, `policyPermissiveParam` is `optional(bool())`, and each keyword's spec declares only its operation's predicates. Block values are parsed while the symbol table is built, and `BlockSpecContext` is `{ symbols, block }` ([research/block-specs.md](research/block-specs.md) §1–3). #30381 already refuses a `sql` literal in a policy, because it is not a string.

Serhii, the author of #30381, agreed (2026-09-25) that block specs may receive the stack's data types. As merged, block values are parsed by `interpretExtensionBlocks` (`psl-parser/src/block-spec/interpret.ts`), which the SQL and Mongo interpreters call.

### 9.1 The block spec context carries the stack's data types

- `BlockSpecContext` gains `readonly dataTypes: DataTypeSupport`, the same field and value as `AttributeSpecContext.dataTypes` (section 7).
- `InterpretExtensionBlocksInput` gains a required `readonly dataTypes: DataTypeSupport`, and `interpretExtensionBlocks` passes it into every `BlockSpecContext` it builds, for block specs and block attributes. `InterpretExtensionBlockInput` and `InterpretExtensionBlockAttributesInput` take it too. The binder also builds block spec contexts, when it binds block values and block attribute arguments; it puts its own `dataTypes` into them. (Corrected in slice 2b: the design missed the binder and the two single-block inputs.)
- The SQL interpreter passes its `dataTypes`, which its input carries. The Mongo interpreter passes the same value it puts in its attribute contexts.
- The language server's block attribute and block key completion contexts (`attribute-spec-resolution.ts`, `completion-provider.ts`) set `dataTypes: source.dataTypes ?? EMPTY_DATA_TYPES`. They build specs and never parse values, so the empty value cannot reach step 0 of section 6.

### 9.2 The policy spec

- `policyUsingParam` and `policyWithCheckParam` become functions of the context: `{ type: optional(dataTypeValue(SQL_EXPRESSION_DATA_TYPE_ID, ctx.dataTypes)), documentation: <unchanged> }`. The three spec functions (`policyUsingOnlySpec`, `policyWithCheckOnlySpec`, `policyBothPredicatesSpec`) take `ctx: BlockSpecContext` and build their parameters from it. `policyTargetParam`, `policyRolesParam` and `policyPermissiveParam` do not change.
- The policy values type (`InferBlock<ReturnType<typeof policyBothPredicatesSpec>>`) then gives `using?: ParsedTypedValue` and `withCheck?: ParsedTypedValue`.
- `lowerRlsPolicyFromBlock` reads `const using = block.values.using === undefined ? undefined : sqlTextFromCanonical(block.values.using.value)`, and likewise `withCheck`. Everything else in the lowering is unchanged.
- A refused value reports the codes and messages of section 6 at the value, through the block diagnostics path #30381 already has.

### 9.3 ADR 262

Amend ADR 262 (in slice 2b): a block spec may depend on the stack's data types. Admitting a value of a data type chooses no codec and no stored representation, so ADR 262's reason for keeping codecs out of parsing does not apply.

## 10. `@default` consumes a `sql/expression` value (slice 2a)

In `packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts`:

- `lowerTaggedLiteral` is renamed `readTaggedLiteral`, because a tag no longer lowers its own body. It loses its `context` parameter and the `LoweredPslDefaultResult` types; it returns its own result type, `{ ok: false, diagnostic }` or `{ ok: true, written: { kind: 'tag', tag: literal.tag, text } }`. Slice 2t removes its tag check and folds the canonicalization that remains into its caller, so the name goes; section 4 says who reports an unknown tag. Delete the outer `context` declaration in `lowerDefaultForField` (about lines 645-650), which is then unused; the inner one (about 724-729) stays.
- In `data-type-default.ts`, rename the `WrittenValue` tag arm's `body` field to `text`, with the matching edits in `psl-column-resolution.ts` and `contract-prisma7/src/defaults.ts` (about lines 277, 298, 300). Export `readValue` from `data-type-default.ts` (slice 2t replaces it with the framework's `readWrittenValue` and removes the export).
- At the point `if ('written' in lowered) return readAsLiteral(lowered.written);` (about line 746), for a scalar parsed value, call `readValue(support, lowered.written, undefined)`. When it returns `ok: true` with `typed.type === SQL_EXPRESSION_DATA_TYPE_ID`, take the SQL expression path below with `text = sqlTextFromCanonical(read.typed.value)`, on scalar and list columns alike. `@default` reads the value, not the written body, so it reads `sql/expression` the same way as the six places in slice 2b. In every other case call `readAsLiteral(lowered.written)` as today, so a refusal is reported once, by `lowerDataTypeDefault`. The SQL expression path:
  1. `reservedSqlDefaultText(text)` defined: report `PSL_INVALID_DEFAULT_SQL` at the literal span, `` `Write @default(${reserved}()) instead of ${SQL_EXPRESSION_TAG}\`${reserved}()\`; ${reserved}() is a Prisma default function, not raw SQL.` ``, and return no default.
  2. `checkSqlDefaultText(text)` defined: report `PSL_INVALID_DEFAULT_SQL` at the literal span with the reason.
  3. Otherwise the default is `{ kind: 'function', expression: text }`.
- Delete the list-element special case (about lines 683-690). A `sql` literal inside a list literal reaches `readDataTypeDefault` and is refused by the cast rule, for example ``Field "Post.tags" at element 1: Expected a quoted string`` with `PSL_VALUE_TYPE_INCOMPATIBLE`.
- Declare the constant `PSL_INVALID_DEFAULT_SQL: ContributedPslDiagnosticCode = 'PSL_INVALID_DEFAULT_SQL'` in `psl-column-resolution.ts`, next to the SQL expression path, its only user. `data-type-default.ts` holds no per-type code.

### 10.1 One set of codes (slice 2a)

In `data-type-default.ts`, `lowerDataTypeDefault` keeps its messages and changes codes by refusal kind:

| Refusal kind | Code |
| --- | --- |
| `unreadable` (any origin, including a JSON body, a nested list and a throwing list cast) | `PSL_INVALID_LITERAL` |
| `unknown-tag` | `PSL_UNKNOWN_LITERAL_TAG` |
| `unwritable`, `no-cast` (any origin, including a list written on a scalar column) | `PSL_VALUE_TYPE_INCOMPATIBLE` |
| `not-a-list` | `PSL_DEFAULT_LIST_EXPECTED` (default-only; renamed from `PSL_DEFAULT_TYPE_INCOMPATIBLE`, whose name read as a type mismatch) |
| `undecodable` | `PSL_INVALID_DEFAULT_LITERAL` (default-only) |

`PSL_INVALID_JSON_LITERAL` is retired; `DefaultRefusal.unreadable.json` is deleted. Rename `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` to `PSL_UNKNOWN_LITERAL_TAG` in the `PslDiagnosticCode` union (`psl-extension-block.ts`, doc "A tagged literal whose tag no pack in the stack registered.") and in `psl-column-resolution.ts`. Add `PSL_VALUE_TYPE_INCOMPATIBLE` ("A written value has a data type the receiving position's type neither is nor casts from, or the target has no data type for its syntax.") and `PSL_INVALID_LITERAL` ("A written value that its authoring entry's parse or a cast refused.") to the union.

Slice 2t's review fixes change the messages: `lowerDataTypeDefault` words every cast-rule refusal with the framework's `describeRefusal` (section 4), so `@default` and `dataTypeValue` say the same thing. A refusal leads with what to write, the forms the column's type admits (`Field "N.count": Expected a number`), not the column's casts; it names the types only when a value of an admitted form is still refused (`Field "N.count": Expected a number that pg/int4 can hold; got pg/int8`). `Unknown literal tag` gains the field prefix, and `Expected <forms>; this target has no data type for a <syntax> value` replaces the lower-case form that did not say what to write. A list on a column with no list cast is `Expected <forms>; got a list`. `contract-prisma7` reports `PSL.PRISMA7_UNKNOWN_DEFAULT` with its own wording, which still names the casts.

The TypeScript `sql` tag in `packages/2-sql/2-authoring/contract-ts/src/sql-default-literal.ts` is unchanged in slice 2a; slice 3 replaces it.

## 11. Printing

### 11.1 One printer for tagged literals (slice 2a)

Add to `packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts`:

```ts
/**
 * The PSL text of a tagged literal whose canonical text is `text`: the backtick form, or the double-quote form when the
 * text holds a backtick, which reads better than escaping each backtick. A multi-line text starts on the line after
 * the opening backtick, so indentation a printer adds to an enclosing block is common to every line and the
 * canonicalization removes it. ADR 129.
 */
export function printTaggedLiteral(tag: string, text: string): string {
  if (text.includes('`')) return `${tag}"${escapeQuotedText(text)}"`;
  const fenced = text.replace(/\\/g, '\\\\');
  return text.includes('\n') ? `${tag}\`\n${fenced}\n\`` : `${tag}\`${fenced}\``;
}
```

`escapeQuotedText` is private: it replaces `\` with `\\`, `"` with `\"`, a newline with `\n` and a carriage return with `\r`, in that order. The PSL printer indents every continuation line inside a namespace block (`wrapNamespaceBlock`, `psl-printer/src/serialize-print-document.ts:155-165`), which is why a multi-line text starts on its own line.

`packages/2-sql/9-family/src/core/psl-build/default-mapping.ts` (slice 2a):

- Delete `sqlLiteralText`. A function default that is not a named function prints `` `@default(${printSqlExpressionLiteral(expression)})` ``.
- `literalText` prints a tag entry's text with `printTaggedLiteral(written.tag, text)`, imported from `@internal/framework-components/authoring`. A `json` text holding a backtick now prints in the double-quote form.
- `writingSurface` has no special case for `sql/expression`. The cast rule keeps its entry out of literal defaults, because no column has the type and no type casts from it. The raw-expression fallback prints SQL.
- `contract infer` builds its default mapping from the target's own lists (`createPostgresDefaultMapping` in `postgres/src/core/psl-infer/postgres-default-mapping.ts`), so it does not see the family's or any extension's data types; because it prints SQL through `printSqlExpressionLiteral`, that changes no output.

### 11.2 `contract infer` prints the six places (slice 2b)

- `packages/3-targets/3-targets/postgres/src/core/psl-build/index-attributes.ts` (corrected in slice 2b; the design named `psl-infer/infer-index-attributes.ts`): `buildIndexAttribute` prints `namedArg('expression', printSqlExpressionLiteral(index.expression))` and `namedArg('where', printSqlExpressionLiteral(index.where))`; `buildCheckAttribute` prints `namedArg('expression', printSqlExpressionLiteral(check.expression))`.
- `packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-policy-blocks.ts`: `{ expression: printSqlExpressionLiteral(policy.using), span: SYNTHETIC_SPAN }` and likewise `withCheck` (about lines 105-110).
- `contract print` shares `buildIndexAttribute` and `buildCheckAttribute`, and `psl-print/row-level-security.ts` prints policy predicates with `printSqlExpressionLiteral` too (added in slice 2b). `printSqlExpressionLiteral` throws an internal error for a text that does not read back, so every caller checks first with `sqlTextsReadBack`. `contract print` refuses an index, check or policy whose SQL fails it with `CONTRACT.PRINT_UNSUPPORTED` through `refuseSqlTextThatDoesNotReadBack` in `psl-print/refusals.ts` (`dispatches/2b-findings.md` finding 1).
- **Bodies that do not read back.** An exact-named (`map:`) object compares its body with the database byte for byte, so infer never prints a body that would read back changed. A wire-named object is compared by name, and `normalizeSqlBody` gives its canonical text the same name, so infer prints it with that text. `psl-infer/infer-sql-text.ts` holds the note text and `printableIndex`:
  - In `buildModel` (`infer-model-blocks.ts`), `printableIndex` returns an index unchanged when its `expression` and `where` read back, the index with canonical texts when they do not and its naming is wire, and `undefined` otherwise. Infer detects every live check and policy as exact-named, so a non-derived check whose `expression` fails `sqlTextsReadBack` is skipped. Each skip adds the note `` `// prisma: skipped ${kind} "${name}": its SQL cannot be written as a sql literal that reads back unchanged. It is not in this schema, so migration plan will drop it. A sql literal written by hand holds different text, so migration plan then stops with a conflict for an index or check, or drops and recreates a policy. Either change the SQL in the database to the text of the literal, or add the object without map: or @@map so Prisma names it.` `` (`kind` is `index` or `check`) to the model's comment lines, after any policy notes.
  - In `buildIntrospectedPolicyBlocks` (`infer-policy-blocks.ts`), a policy whose `using` or `withCheck` fails `sqlTextsReadBack` is skipped with the same note, `policy` as its kind, through the existing `skipNotesByTable`.
  - Function defaults keep printing unconditionally, with `printTaggedLiteral` rather than the checking printer. Default expressions are compared with case and whitespace ignored (`resolvedDefaultsEqual`), not byte for byte, and canonicalization changes only whitespace, so the canonical text never shows as a difference. A string constant inside a default whose whitespace canonicalization changes reads back as a different value. Decided in slice 3, with the reason in ADR 268 ("Column defaults that do not read back"): `contract infer` keeps printing such a default and adds `` `// prisma: default of "${column}" holds text a sql literal cannot write back unchanged; check its string constants before applying a migration` `` to the model's comment lines (`defaultDoesNotReadBackNote` in `psl-infer/infer-sql-text.ts`). `contract print` refuses such a default through `refuseSqlTextThatDoesNotReadBack` with kind `default` and the column's coordinate.

## 12. Language server (slice 2b)

In `packages/1-framework/3-tooling/language-server/src/`:

- `completion-values.ts`: handle `dataTypeValue` in the branch that handles `taggedLiteral`: one item per `type.tags` entry, inserting `` `${tag}\`$1\`` `` when the client supports snippets, with `detail: type.documentation`.
- `completion-snippets.ts`, `argSnippetPlaceholder`: narrow with `const type = directArgType(param)` first; for `type.kind === 'dataTypeValue'` with at least one tag, return `` `${type.tags[0]}\`\${${n}:${key}}\`` ``. `@@check(` completes to ``check(expression: sql`${1:expression}`)``.
- `pipeline.ts`, `config-resolution.ts`, `attribute-spec-resolution.ts`, `server.ts`: section 7.
- `semantic-tokens.ts`, in `collectExpression`, replace the empty `TaggedLiteralExprAst` branch: `addIdentifier(expression.tag()?.namespace(), 'namespace', tokens)` when present; `addIdentifier(expression.tag()?.identifier(), 'keyword', tokens)`; `addToken(expression.literal()?.token(), 'string', tokens)`. The token builder already splits a multi-line `string` token per line.
- Block parameter values were a non-goal; `main` added their completion in #30567, and it offers `sql` at a policy's `using`.

## 13. Diagnostics after the project

| Code | Raised by | When |
| --- | --- | --- |
| `PSL_VALUE_TYPE_INCOMPATIBLE` (new) | `@default`; `dataTypeValue` | A value of a type the receiving type does not cast from; a syntax the target has no type for |
| `PSL_INVALID_LITERAL` (new) | `@default`; `dataTypeValue` | An entry's parse or a cast refused the value |
| `PSL_UNKNOWN_LITERAL_TAG` (renamed) | `@default`; `dataTypeValue` | An unregistered tag, including `pg.sql` and `sqlite.sql` |
| `PSL_TAGGED_LITERAL_NUL`, `PSL_TAGGED_LITERAL_TOO_LARGE` | `@default`; `dataTypeValue` | Canonicalization failed |
| `PSL_INVALID_ATTRIBUTE_SYNTAX` | `dataTypeValue` | The argument is not a literal |
| `PSL_INVALID_DEFAULT_SQL` (moved to contract-psl) | `@default` | Reserved text or `checkSqlDefaultText` refusal |
| `PSL_DEFAULT_LIST_EXPECTED` (renamed from `PSL_DEFAULT_TYPE_INCOMPATIBLE`), `PSL_INVALID_DEFAULT_LITERAL` | `@default` | Only `not-a-list` and a codec refusal |
| `PSL_INVALID_JSON_LITERAL`, `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` | — | Retired / renamed |
| `CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION` (new, slice 2a) | SQL family, when it creates its control instance | A registered data type declares a cast or a list cast from `sql/expression` (section 3.5) |
| `CONTRACT.SQL_EXPRESSION_INTERPOLATION` (renamed from `CONTRACT.DEFAULT_SQL_INTERPOLATION`) | TS `sql` tag | Something other than a `sql` value interpolated |
| `CONTRACT.SQL_EXPRESSION_INVALID` (new) | `SqlExpression` constructor; lowering, for a rendered index expression | Canonicalization failed; in lowering the message starts with the index's `what` |
| `CONTRACT.DEFAULT_INVALID` | TS `.default()` | Reserved text or unsafe SQL (moved from the tag) |
| `CONTRACT.ARGUMENT_INVALID` | `requireSqlExpression` | A TS raw-SQL field holds something other than a `SqlExpression` at run time |

`@default` and `dataTypeValue` word `PSL_VALUE_TYPE_INCOMPATIBLE`, `PSL_INVALID_LITERAL` and `PSL_UNKNOWN_LITERAL_TAG` with the framework's `describeRefusal` (section 4). `@default` adds `Field "X.y": ` or `Field "X.y" at element n: ` in front; `dataTypeValue` adds nothing. A missing cast reads `Expected <forms>`, followed by `; write <literal>` for a quoted string refused by a type with a tag whose text reads back, or `Expected <forms> that <type> can hold; got <value type>` for a value of an admitted form.

Policy predicates report the `dataTypeValue` rows (section 9.2).

## 14. Line comments in raw SQL (slice 1)

### 14.1 The node and its renderer

New file `packages/2-sql/4-lanes/relational-core/src/ast/opaque-sql.ts`; add `export * from '../ast/opaque-sql';` to `src/exports/ast.ts`.

```ts
/**
 * SQL text that Prisma does not parse, placed inside a larger statement: a CHECK or policy predicate, an index element
 * list or predicate, a column default, or an ALTER COLUMN TYPE conversion. ADR 244 calls such text opaque.
 */
export class OpaqueSql {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
    Object.freeze(this);
  }
}

export function opaqueSql(text: string): OpaqueSql {
  return new OpaqueSql(text);
}

/**
 * The text as a statement includes it. Text containing `--` ends with a line break, so a line comment on its last
 * line cannot hide what the statement writes after it.
 */
export function renderOpaqueSql(sql: OpaqueSql): string {
  return sql.text.includes('--') ? `${sql.text}\n` : sql.text;
}
```

The invariant: every site that places contract SQL inside a statement renders it through `renderOpaqueSql`. Output is byte-identical to today for any text without `--`, and no committed `ops.json` contains `--` ([research/ddl.md](research/ddl.md) §5.2), so no committed `ops.json` or `migrationHash` changes.

### 14.2 DDL nodes hold `OpaqueSql`

Node fields become `OpaqueSql`; node constructors take `OpaqueSql`; contract-free factories that migration files call keep taking strings and wrap them with `opaqueSql`.

| Node | Field | Factory that wraps |
| --- | --- | --- |
| `FunctionColumnDefault` (`relational-core/src/ast/ddl-types.ts`) | `expression: OpaqueSql` | `fn(expression: string)` in `relational-core/src/contract-free/column.ts` |
| `CheckExpressionConstraint` (same file) | `expression: OpaqueSql` | `checkExpression(name, expression: string)` (same) |
| `PostgresCreatePolicy` (`postgres/src/core/ddl/nodes.ts`) | `using`, `withCheck`: `OpaqueSql \| undefined` | `createPolicy` in `postgres/src/contract-free/ddl.ts` (options keep `using?: string`, `withCheck?: string`) |
| `PostgresCreateIndex` (same) | `where: OpaqueSql \| undefined`; `elements: { columns } \| { expression: OpaqueSql }` (`DdlIndexElements`) | `createIndex` in `postgres/src/contract-free/ddl.ts` (options take `elements: CreateIndexElements`, `where: string \| undefined`) |

Move `CreateIndexElements` (`{ readonly columns: readonly string[] } | { readonly expression: string }`) from `postgres/src/core/migrations/operations/indexes.ts` to `postgres/src/core/ddl/nodes.ts`, next to `DdlIndexElements`. `operations/indexes.ts`, `contract-free/ddl.ts` and `core/migrations/op-factory-call.ts` import it from there.

These places build nodes directly and wrap their string with `opaqueSql`: `postgresDefaultToDdlColumnDefault` (`postgres/src/core/migrations/op-factory-call.ts`), the temporary default in `postgres/src/core/migrations/planner-recipes.ts` (about line 64), and `sqlite/src/core/migrations/column-ddl-rendering.ts` (about line 73). Search for `new FunctionColumnDefault(`, `new CheckExpressionConstraint(`, `new PostgresCreatePolicy(` and `new PostgresCreateIndex(` to confirm there are no others. Code that reads these fields reads `.text`, including the adapters' `autoincrement()` and SQLite `now()` checks and the TypeScript renderers.

### 14.3 Every site renders through `renderOpaqueSql`

| Site | New template |
| --- | --- |
| PG `pgRenderDdlColumnDefault` (postgres adapter `control-adapter.ts`) | `` `DEFAULT (${renderOpaqueSql(def.expression)})` `` |
| PG CHECK in CREATE TABLE (same file) | `` `CONSTRAINT ${quoteIdentifier(name)} CHECK (${renderOpaqueSql(constraint.expression)})` `` |
| PG policy (same file) | `` ` USING (${renderOpaqueSql(node.using)})` ``, `` ` WITH CHECK (${renderOpaqueSql(node.withCheck)})` `` |
| PG index (same file) | element list `renderOpaqueSql(node.elements.expression)`; `` ` WHERE (${renderOpaqueSql(node.where)})` `` |
| PG `addCheckConstraint` (`postgres/src/core/migrations/operations/constraints.ts`) | `` `... CHECK (${renderOpaqueSql(opaqueSql(expression))})` `` |
| PG `buildColumnDefaultSql`, function case (`postgres/src/core/migrations/planner-ddl-builders.ts`) | `` `DEFAULT (${renderOpaqueSql(opaqueSql(columnDefault.expression))})` `` after `assertSafeDefaultExpression` |
| PG `alterColumnType` hand-written `using` (`postgres/src/core/migrations/operations/columns.ts`) | `` ` USING ${renderOpaqueSql(opaqueSql(options.using))}` `` |
| SQLite `sqliteRenderDdlColumnDefault` (sqlite adapter `control-adapter.ts`) | `` `DEFAULT (${renderOpaqueSql(def.expression)})` `` |
| SQLite `buildColumnDefaultSql`, function case (`sqlite/src/core/migrations/planner-ddl-builders.ts`) | `` `DEFAULT (${renderOpaqueSql(opaqueSql(columnDefault.expression))})` `` after `assertSafeDefaultExpression` |

The four rows that wrap a string only to render it are sites the stalled typed-DDL project did not convert to DDL nodes. The index element list keeps its enclosing parentheses and gets no extra pair: it may be a list such as `lower(email), id`. Not changed: the data-transform `SELECT [NOT] EXISTS (…)` wrapper, which wraps a lowered query plan, not contract SQL. The schema IR and contract IR keep strings.

### 14.4 Wire names keep line breaks around `--`

`normalizeSqlBody` (`packages/2-sql/1-core/schema-ir/src/naming.ts`) becomes:

```ts
export function normalizeSqlBody(sql: string): string {
  if (!sql.includes('--')) return sql.replace(/\s+/g, ' ').trim();
  return sql
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}
```

Update its doc: a body with a line comment keeps its line breaks, because a line break ends the comment. The rule applies the same output to its own output, which policies rely on (they normalize twice). Every body without `--`, and every one-line body, hashes exactly as before. No committed body contains `--` ([research/review-followups.md](research/review-followups.md) F02), so no committed wire name changes. A user body that already has both `--` and a line break gets a new wire name once; the upgrade note says so (section 19).

## 15. TypeScript contract builder (slice 3)

### 15.1 The tag and the value

- Section 2's slice 3 exports are added.
- Delete `packages/2-sql/2-authoring/contract-ts/src/sql-default-literal.ts`. `contract-ts/src/exports/contract-builder.ts` exports `sql` and `type SqlExpression` from `@internal/sql-contract/sql-expression`. The Postgres and SQLite contract-builder facades keep re-exporting `sql` and add `type SqlExpression`. No builder facade exports the `SqlExpression` class as a value.
- Remove `'DEFAULT_SQL_INTERPOLATION'` from `ContractSubcode` in `contract-ts/src/contract-errors.ts`.

### 15.2 `.default()`

In `packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts`:

- `ScalarFieldBuilder.default(value: ColumnDefaultLiteralInputValue | ColumnDefault | SqlExpression)`.
- `toColumnDefault` checks `isSqlExpression(value)` first:
  1. `reservedSqlDefaultText(value.text)` defined: throw `contractError('CONTRACT.DEFAULT_INVALID', \`Write .default(${reserved}()) instead of sql\\\`${reserved}()\\\`; ${reserved}() is a Prisma default function, not raw SQL.\`, { meta: { reason: 'reserved-function', expression: value.text } })`.
  2. `checkSqlDefaultText(value.text)` defined: throw `contractError('CONTRACT.DEFAULT_INVALID', reason, { meta: { reason: 'unsafe-sql', expression: value.text } })`.
  3. Return `{ kind: 'function', expression: value.text }`.
- The existing branches follow unchanged. `now()` and `autoincrement()` still return `ColumnDefault`. `.default({ kind: 'function', expression })` keeps working (non-goal).

### 15.3 Index, check and full-text index

In `contract-dsl.ts`: `IndexOptionsBase.where?: SqlExpression`; `IndexExpressionInput = SqlExpression | DeferredIndexExpression`; `IndexConstraint.where?: SqlExpression`; the `index()` implementation signature's `where` is `SqlExpression`; `check(input: { readonly expression: SqlExpression; readonly name?: string; readonly map?: string })`; `AuthoredCheckConstraint.expression: SqlExpression`. Move the orphaned doc block above `DeferredIndexColumn` to `DeferredIndexExpression`, whose `render` keeps returning a string (its text is generated by code).

In `contract-ts/src/contract-lowering.ts`, `resolveModelNode`:

- The `what` string names the object. An index or check with a `name` or `map` is `Index "<name>"` or `Check "<name>"` (`map` when there is no `name`). One with neither, before lowering names it, is `Index on "<Model>"` or `Check on "<Model>"`. The field follows: `where` or `expression`.
- Index `where`: `index.where === undefined ? undefined : requireSqlExpression(index.where, \`${owner} where\`).text`, for example `Index "post_user_active" where` or `Index on "Post" where`.
- Index `expression`, in this order: `isSqlExpression(e)` → `e.text`; `typeof e === 'object' && e !== null && 'render' in e` → `new SqlExpression(e.render(...)).text`, so rendered text is canonicalized like every other raw-SQL text; a refusal is rethrown as `CONTRACT.SQL_EXPRESSION_INVALID` with the message prefixed by `` `${owner} expression: ` `` and `what` added to `meta`; otherwise `requireSqlExpression(e, \`${owner} expression\`)`, which throws. Testing `'render' in e` on a string would throw a `TypeError`, so the order matters.
- Check: `expression: requireSqlExpression(check.expression, \`${owner} expression\`).text`, for example `Check "post_email_no_space" expression`.

In `packages/3-extensions/postgres/src/contract/full-text-index.ts`: `FullTextIndexOptionsBase.where?: SqlExpression`. `fullTextIndex` checks it with `requireSqlExpression(where, 'Full-text index "<name>" where')`, `<name>` being its `name` or `map`; with neither (only an untyped caller can omit both), it is `Full-text index on fields "<field>", "<field>" where`, listing the field names of every weight group in order, because the helper does not know the model. ("on fields" keeps it apart from `Index on "<Model>"`, which names a model.) It checks `where` itself because lowering sees only an index and cannot tell the author used `fullTextIndex`.

### 15.4 Policies

- `packages/3-extensions/postgres/src/contract/rls.ts`: every `using` and `withCheck` in `RlsPolicyHandle`, `RlsUsingPolicyDescriptor`, `RlsWithCheckPolicyDescriptor`, `RlsUsingWithCheckPolicyDescriptor` and `buildPolicyHandle`'s parameter becomes `SqlExpression`; values are copied unchanged.
- `packages/3-targets/3-targets/postgres/src/core/authoring.ts`: `RlsPolicyHandleShape.using?: SqlExpression`, `withCheck?: SqlExpression`. `postgresLowerEntityHandles` passes `requireSqlExpression(policy.using, 'Policy "<name>" using').text` (and `'Policy "<name>" withCheck'`) to `buildRlsPolicyEntity` when defined, `<name>` being the policy's name (its prefix).

### 15.5 What stays strings

`buildSqlContractFromDefinition` and the definition tree (`IndexNode`, `CheckNode`) take strings; PSL builds the same tree. `DeferredIndexExpression.render` returns a string, which lowering canonicalizes (section 15.3).

## 16. Migration files: untagged template literals (slice 4)

Generated `migration.ts` files are formatted by prettier with `singleQuote: true` (`packages/1-framework/3-tooling/migration/src/migration-ts.ts`), which already picks the quote that avoids escaping. A SQL body keeps escaped quotes only when it holds both `'` and `"`, for example `"kind" IN ('admin', 'user')`.

Add to `packages/1-framework/1-core/ts-render/src/ts-string-literal.ts`, exported from the package entry:

```ts
/**
 * TypeScript source for a string: an untagged template literal when the text holds both quote kinds and no line
 * break, so neither quote is escaped; otherwise `tsStringLiteral(text)`.
 */
export function tsQuotedTextSource(text: string): string;
```

When `text` contains `'` and `"` and none of `\n`, `\r`, U+2028 or U+2029, it returns `` `\`${escaped}\`` `` where `escaped` replaces `\` with `\\`, then `` ` `` with `` \` ``, then `${` with `\${`. Otherwise it returns `tsStringLiteral(text)`. Biome's `style/noUnusedTemplateLiteral`, which lints committed example migrations, does not report a template that holds a quote.

Add to the same package, next to `jsonToTsSource`, and export it from `ts-render/src/index.ts` (as `tsQuotedTextSource` is):

```ts
/** An object literal from entries whose values are already TypeScript source, laid out as `jsonToTsSource` lays out objects. */
export function tsObjectSource(entries: readonly (readonly [key: string, source: string])[]): string;
```

It returns `{}` for no entries; otherwise it renders each entry as `` `${renderKey(key)}: ${source}` `` and returns the one-line form when it is at most 80 characters and has no line break, else the multi-line form with two-space indentation and a trailing comma. `jsonToTsSource`'s object branch calls it, so its output is unchanged for every existing input.

Sites that print a SQL text field with `tsQuotedTextSource` in place of `jsonToTsSource`/`tsStringLiteral`:

- `renderDdlColumnDefault` (both targets): `fn(${tsQuotedTextSource(def.expression.text)})`.
- `renderDdlConstraintAsTsCall` (Postgres): `checkExpression(${jsonToTsSource(name)}, ${tsQuotedTextSource(c.expression.text)})`.
- `CreateIndexCall.renderTypeScript` (Postgres): `expression: ${tsQuotedTextSource(this.expression ?? '')}` and, in `extras`, `where: ${tsQuotedTextSource(this.where)}`.
- `AddCheckConstraintCall.renderTypeScript`: `expression: ${tsQuotedTextSource(this.expression)}`.
- `CreatePostgresRlsPolicyCall.renderTypeScript`: keep building `input` typed as `RenderedRlsPolicyLiteral`, then print `policy: ${tsObjectSource(entries)}` where `entries` are `Object.entries(input)` without `undefined` values, in `input`'s key order, with `using` and `withCheck` rendered by `tsQuotedTextSource` and every other value by `jsonToTsSource`.

No migration function, type or import changes. Rendered SQL is unchanged, so `ops.json` is identical, and committed migration files are not regenerated.

## 17. Stretch: `sql` values in migration files (slice 5)

Confirmed by Will on 2026-10-08. Checked against `main` plus slice 3 on 2026-10-08; the corrections from that check are written into 17.1 to 17.3.

### 17.1 Migration methods accept both forms

In `packages/2-sql/4-lanes/relational-core/src/contract-free/column.ts` (exported from `@internal/sql-relational-core/contract-free`):

```ts
/** SQL in a migration-file argument: a `sql` value, or a string. The string form is permanent: committed files use it, and the generator writes it when a template cannot hold the text unchanged. */
export type MigrationSqlText = string | SqlExpression;
export function sqlTextOf(value: MigrationSqlText): string;
// A string is returned unchanged. Anything else is read with `requireSqlExpression(value, 'SQL text')`, so a `sql` value from another
// installed copy is canonicalized (slice 3's `readSqlExpression`) and a value of any other type throws CONTRACT.ARGUMENT_INVALID.
```

Each method or factory below reads such a value with `sqlTextOf` at its entry and passes a string on, converting only defined values (`exactOptionalPropertyTypes`). `CreateIndexExtras`, `CreateIndexElements`, `PostgresRlsPolicyInput`, `RenderedRlsPolicyLiteral` and `AlterColumnTypeOptions` stay strings.

- `fn(expression: MigrationSqlText)`, `checkExpression(name: string, expression: MigrationSqlText)`: wrap `opaqueSql(sqlTextOf(expression))`.
- `PostgresMigration` (`postgres/src/core/migrations/postgres-migration.ts`):
  - `createIndex`: the expression arm is `{ readonly expression: MigrationSqlText; readonly columns?: never }`; `extras?: Omit<CreateIndexExtras, 'where'> & { readonly where?: MigrationSqlText }`. It passes `sqlTextOf(options.expression)` and `options.extras === undefined ? undefined : { ...options.extras, ...ifDefined('where', options.extras.where === undefined ? undefined : sqlTextOf(options.extras.where)) }`.
  - `addCheckConstraint`: `readonly expression: MigrationSqlText`.
  - `createRlsPolicy`: `readonly policy: Omit<RenderedRlsPolicyLiteral, 'using' | 'withCheck'> & { readonly using?: MigrationSqlText; readonly withCheck?: MigrationSqlText }`; where it spreads them (lines 647–653 of `postgres-migration.ts` on 2026-10-08) it writes `using: options.policy.using === undefined ? undefined : sqlTextOf(options.policy.using)`, likewise `withCheck`.
  - `alterColumnType`: `readonly options: Omit<AlterColumnTypeOptions, 'using'> & { readonly using?: MigrationSqlText }`, passing `{ ...options.options, ...ifDefined('using', options.options.using === undefined ? undefined : sqlTextOf(options.options.using)) }`.
- SQLite `SqliteMigration.addColumn` and `recreateTable` (`sqlite/src/core/migrations/sqlite-migration.ts`) take `SqliteColumnSpec` (`operations/shared.ts`), whose `default` function arm is `{ kind: 'function', expression: string }` and holds user SQL. Their input type takes `expression: MigrationSqlText` in that arm, and each method reads it with `sqlTextOf` before passing the spec on; the stored `ColumnDefault` stays a string.
- The Postgres and SQLite targets' `src/exports/migration.ts` add `export { sql } from '@internal/sql-contract/sql-expression';`. The `@internal/postgres/migration` and `@internal/sqlite/migration` facades re-export with `export *`.

### 17.2 The renderer prints `sql` values

Add to `packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts`, exported from `src/exports/authoring.ts`:

```ts
/** TypeScript source for `text` in generated code: a template literal with `tag` when the tag reads it back unchanged, else a string literal. */
export function renderTaggedTemplateSource(tag: string, text: string): { readonly source: string; readonly usesTag: boolean };
```

1. Fall back to `{ source: tsQuotedTextSource(text), usesTag: false }` when `canonicalizeTaggedLiteralBody(text)` fails or changes the text; when a line of `text` matches `/^\s+$/` but not `/^[ \t]*$/` (the renderer's `indent()` treats such a line as blank); or when `text` holds a character a template cannot carry unchanged in a UTF-8 file: a lone surrogate, a control character other than `\n` and `\t`, or U+2028 or U+2029 (the characters `tsQuotedTextSource` escapes).
2. `escaped`: `\` → `\\`, then `` ` `` → `` \` ``, then `${` → `\${`.
3. One line: `` `${tag}\`${escaped}\`` ``. Several lines: `` `${tag}\`\n${escaped}\n\`` ``.

These slice 4 sites use `renderTaggedTemplateSource(SQL_EXPRESSION_TAG, text).source` in place of `tsQuotedTextSource`, because their text is user or contract SQL that a migration function now takes as a `sql` value:

- Postgres `op-factory-call.ts`: `renderDdlColumnDefault` (`fn(...)`), `renderDdlConstraintAsTsCall` (`checkExpression`), `AddCheckConstraintCall`, `CreateIndexCall` (`expression` and `where`), `CreatePostgresRlsPolicyCall` (`using` and `withCheck`).
- SQLite `op-factory-call.ts`: `renderDdlColumnDefault` (`fn(...)`), and `renderSpecDefault` (the function default inside a `SqliteColumnSpec`, for `addColumn` and `recreateTable`).

SQLite `renderPostcheck` keeps `tsQuotedTextSource`: its text is SQL the planner builds itself (`buildRecreatePostchecks`), and `RecreatePostcheck.sql` stays a string.

The three render helpers keep returning a string. Each call's `importRequirements()` adds `{ moduleSpecifier: <facade constant>, symbol: SQL_EXPRESSION_TAG }` when `renderTaggedTemplateSource(SQL_EXPRESSION_TAG, text).usesTag` holds for any text it renders, computed from the same texts (calls are frozen). That covers `CreateTableCall`, `AddColumnCall` and `SetDefaultCall` (Postgres), `AddCheckConstraintCall`, `CreateIndexCall`, `CreatePostgresRlsPolicyCall`, and SQLite `CreateTableCall`, `AddColumnCall` and `RecreateTableCall`. The facade constants are `POSTGRES_MIGRATION_FACADE` and `TARGET_MIGRATION_MODULE` (SQLite), both module-local to the file that holds the calls. `AlterColumnTypeCall` is unchanged (the planner never sets `using`). ADR 195's "same argument shapes" rule gets a recorded exception: the rendered file passes `sql` values where the IR holds strings.

## 18. Committed artefacts

### 18.1 Slice 2b regeneration (F30)

The refusal, the printers and the regeneration land in one dispatch.

- Regenerate `packages/3-extensions/supabase/src/contract/contract.prisma` with `pnpm --filter @internal/extension-supabase run contract:generate`. `src/contract/contract.json` and `contract.d.ts` must come out byte-identical.
- Rewrite by hand with the codemod of section 20 (then review the diff), turning each plain string into a `sql` literal with the same canonical text:
  - `examples/supabase/src/contract.prisma`;
  - `packages/3-extensions/supabase/test/fixtures/example-app/contract.prisma`, `renamed-policy/contract.prisma`;
  - `test/integration/test/authoring/parity/rls/schema.prisma`;
  - `test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/contract-expression-authored.prisma`, `contract-expression-authored-renamed.prisma`, `contract-expression-authored-editedbody.prisma`, `contract-rls-adopted.prisma`, `contract-rls-wire.prisma`.
- Update every inline PSL body in the test files in [research/artefacts-docs.md](research/artefacts-docs.md) §1.4 and [research/rebase-delta.md](research/rebase-delta.md) section 17, including `postgres/test/psl-policy-placement.test.ts` and `language-server/test/pipeline.test.ts`, and the infer assertions listed there.
- `pnpm fixtures:check` shows no `contract.json` change.

### 18.2 Slice 2a edits

- `test/integration/test/authoring/parity/default-sql-literal/schema.prisma`: `pg.sql` becomes `sql`.
- The formatter fixture `packages/1-framework/2-authoring/psl-parser/test/format/fixtures/tagged-literal/{input,expected}.prisma`: `pg.sql` becomes `postgis.geometry` (it only illustrates a dotted tag), and `pg . sql` in the input becomes `postgis . geometry`.
- `packages/1-framework/2-authoring/psl-parser/src/syntax/ast/expressions.ts:215`: the doc example `pg.sql` becomes `postgis.geometry`.

### 18.3 Test fixtures and test stacks

These fail at run time, not compile time:

- Tests that build contributions by hand from a target's lists add the family's type and entry, first, as a stack assembles them.
- `contract-psl/test/fixture-data-types.ts` (slice 2a): add `sqlExpressionDataType` as the first element of `fixtureDataTypes`; replace the `loweringEntryKey('sql')` and `loweringEntryKey('pg.sql')` keys with `[SQL_EXPRESSION_DATA_TYPE_ID]: sqlExpressionAuthoringEntry` as the first key (known tags then read `sql, json`, as on a real stack). Delete `test/fixture-sql-tag.ts`.
- Adapter tests (slice 2a): delete `6-adapters/{postgres,sqlite}/test/data-type-authoring.test.ts`. Their cases about the target's own entries (the number classifiers at each bound, the boolean reader, JSON and numeric read and print) move to `3-targets/3-targets/{postgres,sqlite}/test/data-type-entries.test.ts`; only the cases about lowering keys are dropped. In `6-adapters/{postgres,sqlite}/test/control-mutation-defaults.test.ts`, delete the `createPostgresDataTypeEntries` and `createSqliteDataTypeEntries` describe blocks, import entries from `@internal/target-{postgres,sqlite}/data-types`, and assert that the adapter descriptor's `authoring.dataTypes` has no `sql/expression` key and only the tag `json`.
- Language server `test/completion-provider.test.ts` (slice 2a, about lines 1350-1357): it loads pack sources by path, because the server does not depend on the targets. Load `3-targets/3-targets/{postgres,sqlite}/src/exports/data-types.ts` and `2-sql/1-core/contract/src/exports/sql-expression.ts` with `importFromPackageRoot`, typed through local module interfaces, and put the family's entry first, so `@default(` offers `sql` before `json` as on a real stack. In slice 2b, the new `@@index`/`@@check` completion tests also build a lookup from those types with `createDataTypeLookup`.
- `postgres/test/data-types.test.ts` and `sqlite/test/data-types.test.ts` (slice 2a): the sorted id lists do not contain `sql/expression`, and no type casts from it.
- `test/integration/test/authoring/sql-expression-registration.test.ts` (slice 2a): on each assembled SQL stack, Postgres with every shipped extension pack, the registered type and entry are the family's objects (`toBe`), and no registered type casts from `sql/expression`.
- Tests that assemble contributions without the Postgres adapter and interpret `@@index`, `@@check`, `@@fullTextIndex` or a policy (slice 2b): add `dataTypes: postgresDataTypeEntries()` and pass `createDataTypeLookup(postgresDataTypes)`, and pass the same data types wherever the test binds block specs (`buildSymbolTable`, or the interpreter, per section 9.1). The list is in [research/rebase-delta.md](research/rebase-delta.md) B.2, including `postgres/test/psl-policy-placement.test.ts`, `postgres/test/block-documentation.test.ts` and the adapter's `rls-*` integration tests.
- `contract-psl/test/sql-attribute-specs.test.ts`: in slice 2a, the `@default` tag arm expects `tags: ['sql']` with the `sqlExpressionAuthoringEntry` documentation; in slice 2b, `sqlAttributeSpecs.model.index()` and `.check()` calls pass a context.
- contract-psl tests that interpret `@@index` or `@@check` (slice 2b) add `dataTypes: fixtureDataTypeSupport.entries` to their `authoringContributions`: `interpreter.check-attribute.test.ts`, `interpreter.model-attribute-indexes.test.ts`, `interpreter.index-naming.test.ts`, `interpreter.unknown-attributes.test.ts`, and the shared `authoringContributions` in `ts-psl-parity.test.ts`.

### 18.4 Slice 3 sources

`test/integration/test/authoring/parity/rls/contract.ts` (`ownerPredicate` becomes a `sql` value), `.../cli-journeys/contract-expression-authored.ts`, `test/integration/test/sql-builder/fixtures/contract.ts`, the TS test call sites in [research/ts-builder.md](research/ts-builder.md) §6, and `test/integration/test/rls-ts-walking-skeleton.integration.test.ts:79-80`, which composes `EDITED_PREDICATE` with `` sql`${OWNER_PREDICATE} AND deleted_at IS NULL` ``.

## 19. Documentation and ADRs

A new ADR 268, "Raw SQL is a value of the data type `sql/expression`", written in slice 2b (numbered 268 because `main` uses 256 to 266 and an open pull request claims 267), holds design-notes decisions 1–7, 11 and 12 with their rejected alternatives. ADRs 129, 195, 231, 234, 236, 243, 244, 249, 254 and 262 are amended briefly and link to it.

| Doc | Slice | Change |
| --- | --- | --- |
| ADR 234 | 1 | "Normalizer stability": the `--` rule (section 14.4), and why no existing name changes |
| `docs/architecture docs/subsystems/7. Migration System.md` | 1 | New section "Opaque SQL in DDL": the node, the renderer rule, the invariant, the template-string sites, the data-transform exception |
| ADR 254 | 2a | Widen the definition: a data type is the type of a value Prisma stores or passes to the database; most are database types; `sql/expression` has no codec and no DDL name, no column has it, it declares no casts, and no type casts from it. A family registers only a type that is the same on every target and that nothing casts from; the SQL family registers `sql/expression` itself. Lowering entries are gone; `sql` is `sql/expression`'s tag. Tell the follow-up project that a DDL name is optional for such types. State the prefix rule once: a tag is unprefixed when the owner of its data type is the family or a target; every other owner prefixes its tags. `@default` reports the cast-rule codes at the `@default` attribute. Only the scalar cast rule moves to the framework (2t); list casts stay in the family's default reader |
| ADR 129 | 2a | Retitle it "Tagged literals write values of data types" (the file name stays). The tag names the data type of the text, not a pack that owns it. The body is what is written between the quotes; the text is the canonical value. Delete the prefixed-alias rule and link to the prefix rule in ADR 254. Move "the SQL family owns the unprefixed `sql` tag" from rejected alternatives into the decision, with the reason: the tag is part of the definition of `sql/expression`, which the family owns. `@default` stores a `sql/expression` value; its checks belong to `@default`, and in TypeScript the `sql` tag runs the same checks |
| ADR 129 | 2b | The six places; move "check the tag while parsing the argument" from rejected alternatives into the decision for typed positions, with the rule that `dataTypeValue` is used as a parameter of a `funcCall`, whose diagnostics `oneOf` keeps when exactly one arm names the called function; record the infer read-back rule and the skip notes (section 11.2) |
| ADR 129 | 3 | The TS tag returns `SqlExpression`, interpolates other `sql` values, and the checks moved to `.default()` |
| ADR 254 | 3 | The TypeScript paragraph gains `SqlExpression`, the TypeScript value of a type that has no codec |
| ADR 231 | 2b | Add `taggedLiteral`, `jsonValue` and `dataTypeValue` to the combinator kit; `dataTypeValue` decides literal-to-type compatibility for positions with a fixed receiving type (its "follow-up" item); `@default` still casts in lowering because its type comes from the column; the `oneOf` rule |
| ADR 249 | 2b | `index` and `check` are built from the context; the context carries `dataTypes`; `ControlDefaultRegistries` holds only the function registry |
| ADR 262 | 2b | Section 9.3 |
| ADR 195 | 5 | The recorded exception (section 17.2) |
| ADRs 234, 236, 243, 244 | 2b, 3 | PSL examples in 2b, TS examples in 3 |
| `docs/architecture docs/ADR-INDEX.md` | 2a, 2b | Rows for ADR 129, 254 and the new 256 |
| `docs/architecture docs/subsystems/6. Ecosystem Extensions & Packs.md` | 2a, 2b | 2a: the section on tagged literals becomes two sentences that point to ADR 129 and ADR 254 (a tag names a data type; `sql` writes `sql/expression`); the view example is dropped, because a view query is not an expression. 2b: add an `` @@index(where: sql`...`) `` example |
| `docs/reference/error-reference.md` | 2a, 2b, 3 | New, renamed and retired codes (section 13); correct `PSL_TAGGED_LITERAL_*` ("at every place"), `PSL_INVALID_DEFAULT_SQL` (tag `sql` only), `CONTRACT.DEFAULT_INVALID` (raised by `.default()`), `CONTRACT.CAST_REFUSED` and `CONTRACT.INVALID_JSON_LITERAL` cross-references |
| `docs/reference/psl-editor-tooling-tagged-literals.md` | 2a, 2b | Cover every place; no prefixed tags; `dataTypes` on the context; completion and semantic tokens now done; the multi-line formatter check is done |
| `docs/reference/codec-authoring-guide.md` | 2a | Line 477 codes; a type whose entry is a tag with no casts; a family-defined type |
| `docs/README.md` | 2b | Link text drops "defaults" |
| `packages/2-sql/2-authoring/contract-psl/README.md` | 2a, 2b | Codes and prefixed tags in 2a; the places in 2b |
| `packages/3-targets/3-targets/postgres/README.md` | 2b | `@@index(expression:)` and `@@fullTextIndex(where:)` examples |
| `packages/2-sql/2-authoring/contract-ts/README.md` | 3 | Lines in [research/artefacts-docs.md](research/artefacts-docs.md) §3.4 |
| `skills/prisma-8/references/{contract,queries-postgres,supabase,quickstart}.md` | 2b, 3 | PSL examples in 2b, TS examples in 3 |
| `docs/architecture docs/subsystems/7. Migration System.md` | 4, 5 | Untagged templates (4); `sql` values, and that the string form of migration arguments is permanent (5) |

Historical records are not edited: `CHANGELOG.md`, `docs/releases/*`, `skills/prisma-8/upgrading/**/upgrades/*`.

## 20. Upgrade instructions

Each slice that changes `examples/` or `packages/3-extensions/` adds its own fragments under `upgrade-instructions/pending/<name>/<audience>/instructions.md`, following `skills-contrib/record-upgrade-instructions/SKILL.md`, and validates them by execution as that skill requires. A change that affects both audiences is written into both. Never edit another PR's fragment; a new fragment names the pending fragment it supersedes. Test each detection pattern against a true positive and the nearest false positive.

| Slice | Fragment | Changes (ids) |
| --- | --- | --- |
| 1 | `line-comments-in-raw-sql/extension` | `ddl-nodes-hold-opaque-sql` (detection `**/*.{ts,mts,cts}`: `new (FunctionColumnDefault\|CheckExpressionConstraint\|PostgresCreatePolicy\|PostgresCreateIndex)\(`; the instructions also say that code reading `.expression`, `.using`, `.withCheck` or `.where` of these nodes reads `.text`, which no pattern detects); `sql-with-a-line-comment-gets-a-new-wire-name` (a body with both `--` and a line break gets a new index, check or policy name once; the next migration renames or recreates it) — also in an `app` fragment if the coverage check requires one |
| 2a | `sql-is-a-data-type/app` and `/extension` | `prefixed-sql-tags-are-removed` (`**/*.{prisma,ts}`: `(?<![\w./-])(pg\|sqlite)\s*\.\s*sql\s*\\?[\x60"']`, which also matches spaces around the dot and a backtick escaped inside a TypeScript template, and not a file name such as `seed.pg.sql`); `default-diagnostic-codes-changed` (`PSL_INVALID_JSON_LITERAL`, `PSL_UNKNOWN_DEFAULT_LITERAL_TAG`, the moved `PSL_DEFAULT_TYPE_INCOMPATIBLE`/`PSL_INVALID_DEFAULT_LITERAL` cases, the rename of `PSL_DEFAULT_TYPE_INCOMPATIBLE` to `PSL_DEFAULT_LIST_EXPECTED`, and a `sql` literal inside a list literal, whose code, message and location changed; supersedes `data-types-column-defaults/app` lines 59, 82 and 102 and `data-types-column-defaults/extension` line 168; both were released and are now under `upgrade-instructions/releases/8.0.0-rc.11-to-8.0.0-rc.12/sources/`). Extension only: `the-sql-tag-writes-the-sql-expression-data-type` (lowering entries gone; supersedes the lowering-entry text in `data-types-column-defaults/extension`) |
| 2b | `sql-expression-literals-psl/app` and `/extension` | `raw-sql-is-a-sql-literal`, with `script: ./scripts/rewrite-sql-strings.mjs` (below); detection `**/*.prisma`: `\b(where\|expression)\s*:\s*["']` and `^\s*(using\|withCheck)\s*=\s*["']`. Supersedes the PSL plain string in `postgres-full-text-search/app` (line 79). `storage-hash-may-change-once` (a body with indentation, blank first or last lines or CRLF breaks gets canonical stored text; run `migration plan` once and commit the migration, which has no operations). Extension only: `block-spec-context-carries-data-types` (`AttributeSpecContext.dataTypes` and `BlockSpecContext.dataTypes`; `ControlDefaultRegistries.dataTypeEntries` removed; and, if blocks are still parsed in `buildSymbolTable`, its new `dataTypes` option); `supabase-contract-writes-sql-literals` |
| 3 | `sql-expression-literals-ts/app` and `/extension` | `builder-raw-sql-is-a-sql-value` (`index`, `check`, `fullTextIndex`, `policy*` fields; supersedes the TypeScript `where` string in `postgres-full-text-search/app` line 54); `sql-tag-interpolates-sql-values`; `sql-tag-error-codes-renamed`; `storage-hash-may-change-once` (a multi-line template string, or one with leading whitespace or CRLF breaks, is canonicalized once written as `sql`). Extension only: `policy-handles-hold-sql-values`; `sql-tag-lives-in-sql-contract` (supersedes the tag text in `sql-default-literal/extension`) |
| 4 | `migration-files-template-literals/extension` | `changes: []` if only files outside `examples/` and `packages/3-extensions/` change |
| 5 | `migration-files-sql-values/extension` | `migration-functions-accept-sql-values` |

**The codemod.** The canonical file is `scripts/codemods/rewrite-sql-strings.mjs`, tested by `scripts/codemods/rewrite-sql-strings.test.mjs`, which is added to the root `test:scripts`. Copies sit at `upgrade-instructions/pending/sql-expression-literals-psl/{app,extension}/scripts/rewrite-sql-strings.mjs` and are referenced as `script: ./scripts/rewrite-sql-strings.mjs`. It follows the pending `add-model-map.mjs` codemod: `node:*` imports only, no network, no environment variables, invoked as `node scripts/rewrite-sql-strings.mjs '**/*.prisma'` with glob arguments. In each matching file it finds a quoted string (`"…"` or `'…'`) in these positions: the `where:` or `expression:` argument of `@@index`, `@@fullTextIndex` or `@@check`, and `using =` or `withCheck =` in a `policy_*` block. It decodes the PSL string escapes the way `decodeStringLiteral` does, and writes the text with its own copy of the section 11.1 rule: the backtick form, multi-line text on its own lines, or the double-quote form with `\\`, `\"`, `\n`, `\r` escapes when the text holds a backtick. It prints each changed file and the number of rewrites. The test covers each position, both quote kinds, escaped quotes, a text with a backtick, and a file with nothing to rewrite.

## 21. Non-goals

- SQL highlighting inside a `sql` literal, and hover.
- Completion at a block parameter value. (`main` added it in #30567; the merge passes the stack's data types, so a policy's `using` completes `sql`.)
- Typing function arguments such as `nanoid(8)`; the rest of ADR 254's follow-up.
- Any check on SQL text outside `@default`.
- `.default({ kind: 'function', expression })` in TypeScript, which stays accepted; `.defaultSql()`, removed at 8.0.0 by TML-3286.
- The Prisma 7 reader's `dbgenerated(...)` mapping.
- A `contract infer` printer for `@@fullTextIndex`.
- The data-transform wrapper.
- Regenerating committed migration files.
- Empty `where`, `expression` and policy predicates, which render invalid DDL such as `WHERE ()`; this already happens with strings and needs its own ticket.
