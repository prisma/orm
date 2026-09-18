---
changes:
  - id: codec-descriptors-declare-literal-types
    summary: |
      A codec descriptor declares `literalTypes`: the literal types its columns accept as a
      `@default`. A descriptor that declares none accepts no literal default at all, so a column
      typed by it takes only a ``sql`...` `` default.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "CodecDescriptor"
  - id: decode-json-accepts-every-named-shape
    summary: |
      Each literal type fixes the shape of the value it produces, so a codec's `decodeJson` must
      accept the shape of every type its descriptor names, in addition to its own JSON form.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bdecodeJson\('
  - id: default-literal-tag-entry-is-a-union
    summary: |
      `ControlDefaultLiteralTagEntry` is a union: the lowering entry it was, and a new entry that
      names the literal type its body is read as. Narrow with `isDefaultLiteralTagLoweringEntry`
      before reaching for `lower`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "ControlDefaultLiteralTagEntry"
  - id: map-default-takes-literal-types
    summary: |
      `mapDefault(columnDefault, options)` writes a literal default through the column codec's
      declared literal types; a target printer passes `literalTypes` and `list` per column.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bmapDefault\('
  - id: psl-string-escaper-moved-to-the-framework
    summary: |
      `escapePslString` is exported from `@internal/framework-components/codec`, beside
      `writeLiteral`, so a printed literal and the parser's decoder share one definition.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "escapePslString"
---

## `codec-descriptors-declare-literal-types`

`CodecDescriptor` gained an optional `literalTypes`. Declare the types a column of this codec accepts as a `@default` literal:

```ts
import {
  integerLiteralTypesUpTo,
  type LiteralTypeDeclaration,
} from '@internal/framework-components/codec';

class MyInt4Descriptor extends PostgresCodecDescriptor<void> {
  override readonly literalTypes: readonly LiteralTypeDeclaration[] =
    integerLiteralTypesUpTo('i32');
  // …
}
```

The ten type names are `string`, `boolean`, `i8`, `i16`, `i32`, `i64`, `bigint`, `decimal`, `float` and `json`. A written number's type comes from its own size and precision, never from the column, so `42` is an `i8` on every column and `100000000000000099` an `i64`; naming a chain is what makes a too-large value an incompatibility rather than a decode failure. `integerLiteralTypesUpTo(name)` gives the chain from `i8` up to and including `name`.

A declaration may also name a list of element types, which lets a column that is not a list take a PSL list — this is how a vector column takes `@default([0.1, 0.2, 0.3])`:

```ts
override readonly literalTypes: readonly LiteralTypeDeclaration[] = [
  { list: [...integerLiteralTypesUpTo('i64'), 'bigint', 'decimal'] },
];
```

Declaring nothing is a decision, not an omission: the column then accepts no literal default, and a `@default` on it is refused with `PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE` naming `no literal defaults`.

A descriptor that adapts another (`postgresCodec(...)`, `sqliteCodec(...)`) forwards the wrapped descriptor's declaration; a hand-written adapter must copy `literalTypes` across as it copies `traits` and `targetTypes`.

## `decode-json-accepts-every-named-shape`

Each literal type fixes the shape of the value it produces: `i8`, `i16` and `i32` give a JSON number; `i64` and `bigint` give digit text, because a JSON number rounds past 2^53; `decimal` gives decimal text with its trailing zeros; `float` gives the word `NaN`, `Infinity` or `-Infinity`; `string` gives the text; `boolean` a boolean; `json` the parsed document. Converting between those shapes and the codec's own stored form is the codec's job — no contract source branches per codec.

So a codec whose stored form differs from a named type's shape widens `decodeJson`. `pg/int8@1` stores digit text and names `i8` to `i64`, so it takes a whole JSON number as well:

```diff
 decodeJson(json: JsonValue): bigint {
-  if (typeof json !== 'string') {
+  if (typeof json !== 'string' && typeof json !== 'number') {
     throw myError('RUNTIME.DECODE_FAILED', 'value must be a decimal string or a whole number');
   }
   return decodeInt8(json);
 }
```

The mirror case is a number-valued codec that names `i64`: it must read digit text, and refuse text past `Number.MAX_SAFE_INTEGER` with a message naming that limit rather than rounding. `isNumeralText` and `isNonFiniteText`, exported from `@internal/framework-components/codec`, recognise the text a numeric literal carries; use them instead of a local regex so the codec and the classifier cannot drift.

A codec that validates in `decodeJson` still may: a literal the codec refuses is reported as `PSL_INVALID_DEFAULT_LITERAL` carrying the codec's own message. `contract infer` calls `decodeJson` on what it is about to write and falls back to the raw expression when it throws, so a value the codec cannot read is never printed as a literal.

## `default-literal-tag-entry-is-a-union`

`ControlDefaultLiteralTagEntry` is now:

```ts
type ControlDefaultLiteralTagEntry =
  | ControlDefaultLiteralTagLoweringEntry // usage, documentation, lower(...)
  | ControlDefaultLiteralTagTypeEntry; //    usage, documentation, literalType
```

A lowering entry is unchanged: it turns its body into a default itself, as `` sql`...` `` does. A literal-type entry names the literal type its body is read as, and the body then goes through the column's codec like any other literal — `jsonDefaultLiteralTagEntry()`, exported from `@internal/framework-components/codec`, is the `` json`...` `` tag that Postgres and SQLite register.

Code that reads `entry.lower` must narrow first:

```diff
-const lowered = entry.lower({ literal, context });
+if (!isDefaultLiteralTagLoweringEntry(entry)) return readAsLiteral(entry.literalType, body);
+const lowered = entry.lower({ literal, context });
```

`isDefaultLiteralTagLoweringEntry` is exported from `@internal/framework-components/control`; it is the only place the discriminating key is named. A registry built as `new Map([...])` with both kinds of entry needs its type argument spelled out: `new Map<string, ControlDefaultLiteralTagEntry>([...])`.

Tags are grouped by their `documentation` when the `@default` attribute spec is built, so each tag's completion and signature help carries its own text. Give a new tag a description of its own rather than reusing another tag's.

## `map-default-takes-literal-types`

`mapDefault` (`@internal/family-sql/psl-infer`) no longer guesses a PSL form from the JavaScript type of the stored value. `DefaultMappingOptions` gained:

- `literalTypes` — what the column's codec accepts, the same declaration the descriptor carries;
- `list` — whether the column is a list, whose elements are each written against the declaration's scalar types.

A target printer builds those per column and passes them with the rest of the mapping:

```ts
const result = mapDefault(columnDefault, {
  ...defaultMapping,
  literalTypes: literalTypesForPrintedColumn(column),
  list: column.many === true,
});
```

A literal no named type writes now comes back as `{ comment }` rather than an attribute, which is the signal to fall back to the raw database default. `formatLiteralValue` is gone, and with it the per-PSL-type formatter table a target printer used to supply (`PslDefaultValueFormat`, `formatPslValue`, `formatPslListLiteralValue`); delete those and read the declaration instead.

## `psl-string-escaper-moved-to-the-framework`

A printed `string` default and a hand-written PSL string must escape the same way, or what a printer writes does not parse back. `escapePslString` is exported from `@internal/framework-components/codec`, beside `writeLiteral`, and is the one definition. Delete a local copy and import it:

```diff
-function escapePslString(value: string): string {
-  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
-}
+import { escapePslString } from '@internal/framework-components/codec';
```
