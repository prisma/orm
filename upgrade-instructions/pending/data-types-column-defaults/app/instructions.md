---
changes:
  - id: a-json-default-is-a-json-tag
    summary: |
      A `Json` or `Jsonb` column's default is written ``@default(json`{ "a": 1 }`)``. A quoted
      string is refused: `pg/jsonb` casts from `pg/json`, not from `pg/text`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(Jsonb|Json)(\[\])?\??([ \t]+@[\w.]+(\([^)\n]*\))?)*?[ \t]+@default\([\s\[]*"'
  - id: a-decimal-default-is-written-unquoted
    summary: |
      A `Decimal` or `Numeric` column's default is written as a number, not as a quoted string:
      `@default(1.50)`. Trailing zeros are kept.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(Decimal|Numeric)(\([^)]*\))?(\[\])?\??([ \t]+@[\w.]+(\([^)\n]*\))?)*?[ \t]+@default\([\s\[]*"'
  - id: a-float-non-finite-default-is-written-bare
    summary: |
      A `Float` or `Real` column's default is written as a number, and `NaN`, `Infinity` and
      `-Infinity` are written bare: `@default(NaN)`, not `@default("NaN")`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(Float|Real)(\[\])?\??([ \t]+@[\w.]+(\([^)\n]*\))?)*?[ \t]+@default\([\s\[]*"'
  - id: a-json-list-default-is-one-json-literal
    summary: |
      A written list on a `Json` or `Jsonb` column that holds one value is refused. A JSON list
      default is one JSON document: ``@default(json`[1, 2]`)``.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(Jsonb|Json)\??([ \t]+@[\w.]+(\([^)\n]*\))?)*?[ \t]+@default\([ \t]*\['
  - id: infer-prints-a-literal-where-it-printed-dbgenerated
    summary: |
      `prisma contract infer` now prints a default as a literal wherever it can read the literal
      back as the stored value, including forms it used to print as `dbgenerated("...")`. Re-running
      infer produces different schema text for the same database. Nothing to fix; review the diff.
    detection:
      glob: "**/*.prisma"
      contains:
        - "dbgenerated("
  - id: number-valued-64-bit-columns-store-their-default-as-digit-text
    summary: |
      This flags every contract that holds a `pg/int8number@1` or `sqlite/bigintnumber@1` column.
      Only those columns that carry a literal default change form: the default is digit text now,
      where it was a JSON number. A column with no default, or with a function default, is
      unaffected. For an affected contract, re-run `prisma contract emit`, then `prisma db sign`.
    detection:
      glob: "**/contract.json"
      contains:
        - '"codecId": "pg/int8number@1"'
        - '"codecId": "sqlite/bigintnumber@1"'
---

## `a-json-default-is-a-json-tag`

Every value written in PSL now has a data type of its own, decided by what is written rather than by the column. A quoted string is text, and a JSON column's type does not cast from text, so a quoted JSON default is refused with `PSL_DEFAULT_TYPE_INCOMPATIBLE`:

```text
Field "Account.meta": pg/jsonb has no cast from pg/text; it casts from pg/json
```

The `json` tag reads its body as a JSON document, which is what `pg/json` holds, and `pg/jsonb` casts from `pg/json`:

| Before | After |
| --- | --- |
| `meta Jsonb @default("{}")` | ``meta Jsonb @default(json`{}`)`` |
| `meta Jsonb @default("{\"plan\":\"free\"}")` | ``meta Jsonb @default(json`{ "plan": "free" }`)`` |
| `docs Jsonb[] @default(["{}"])` | ``docs Jsonb[] @default([json`{}`])`` |
| `meta Jsonb? @default("null")` | ``meta Jsonb? @default(json`null`)`` |

The body inside the tag is the JSON document itself, so it needs none of the escaping a PSL string needed. The backtick fence resolves `` \` `` and `\\` and nothing else, so `` json`{ "plan": "free" }` `` needs no escaping at all.

A backslash has to survive the fence and then JSON, so a JSON string that holds one backslash is written with four:

| In the schema | After the fence | JSON reads |
| --- | --- | --- |
| ``json`{ "re": "\\\\d+" }` `` | `{ "re": "\\d+" }` | the string `\d+` |

Two backslashes are not enough: the fence turns them into one, and `\d` is not a JSON escape, so the body is refused with `PSL_INVALID_JSON_LITERAL` — as is any other body that is not a JSON document.

## `a-decimal-default-is-written-unquoted`

A written number's data type comes from its own size and precision. Quoted digits are text, and `pg/numeric` does not cast from text:

```text
Field "Account.price": pg/numeric has no cast from pg/text; it casts from pg/int2, pg/int4, pg/int8
```

| Before | After |
| --- | --- |
| `price Decimal @default("1.50")` | `price Decimal @default(1.50)` |
| `price Numeric(10, 2) @default("-1.25")` | `price Numeric(10, 2) @default(-1.25)` |
| `prices Numeric(65, 30)[] @default(["-1.5", "2"])` | `prices Numeric(65, 30)[] @default([-1.5, 2])` |

The stored value does not change. Trailing zeros are kept (`1.50` stays `1.50`), leading zeros are dropped (`007.50` is `7.50`), and `-0.0` is `0.0` — the values these defaults always had.

## `a-float-non-finite-default-is-written-bare`

`NaN`, `Infinity` and `-Infinity` are number tokens in PSL, not identifiers and not text. A `Float` or `Real` column's type casts from the number types, not from text, so the quoted forms are refused with `PSL_DEFAULT_TYPE_INCOMPATIBLE`.

| Before | After |
| --- | --- |
| `ratio Float @default("NaN")` | `ratio Float @default(NaN)` |
| `ratio Float @default("-Infinity")` | `ratio Float @default(-Infinity)` |
| `ratio Real @default("NaN")` | `ratio Real @default(NaN)` |
| `ratios Float[] @default(["-1.5", "2"])` | `ratios Float[] @default([-1.5, 2])` |

## `a-json-list-default-is-one-json-literal`

A written list is several values, and the column takes it only when the column is a list or when the column's data type declares a list cast. `pg/json` and `pg/jsonb` declare none, so a written list on a column that holds one JSON value is refused:

```text
Field "Account.meta": pg/jsonb has no cast from a list; it casts from pg/json
```

A JSON list default is one JSON document, written inside the tag:

| Before | After |
| --- | --- |
| `meta Jsonb @default([1, 2])` | ``meta Jsonb @default(json`[1, 2]`)`` |
| `meta Jsonb @default([])` | ``meta Jsonb @default(json`[]`)`` |

A `Jsonb[]` column is unaffected: it is a list of JSON columns, and each element is written as its own `json` tag — ``docs Jsonb[] @default([json`{}`, json`[]`])``.

## `infer-prints-a-literal-where-it-printed-dbgenerated`

`prisma contract infer` classifies a stored default with the same rules a written value uses, prints it with the same authoring entry, and reads the text straight back to prove it returns the stored value. A default it can read back is now printed as a literal, including forms it used to print as `dbgenerated("...")` or as a quoted string:

| Column in the database | Before | After |
| --- | --- | --- |
| `jsonb NOT NULL DEFAULT '{}'::jsonb` | `@default(dbgenerated("'{}'::jsonb"))` | ``@default(json`{}`)`` |
| `jsonb DEFAULT 'null'::jsonb` | `@default(dbgenerated("'null'::jsonb"))` | ``@default(json`null`)`` |
| `timestamp(3) NOT NULL DEFAULT '2024-01-01 00:00:00'` | `@default(dbgenerated("'2024-01-01 00:00:00'::timestamp without time zone"))` | `@default("2024-01-01 00:00:00")` |
| `numeric(65,30) DEFAULT -0.5` | `@default("-0.5")` | `@default(-0.5)` |
| `numeric(10,2) NOT NULL DEFAULT 1.50` | `@default("1.50")` | `@default(1.50)` |
| `float8 DEFAULT 'NaN'` | `@default("NaN")` | `@default(NaN)` |
| `timestamp(3)[] DEFAULT ARRAY['2024-01-01 00:00:00'::timestamp(3)]` | `@default(dbgenerated("ARRAY[...]"))` | `@default(["2024-01-01 00:00:00"])` |

This is not a break to fix. The contract is the same; only the schema text differs. Re-run `prisma contract infer`, read the diff, and commit the new text. A default whose value the codec cannot read back, such as `NULL::character varying`, still prints as `dbgenerated(...)`, so infer never prints a schema that emit cannot read.

## `number-valued-64-bit-columns-store-their-default-as-digit-text`

Every codec of one data type now stores and reads that type's one canonical form. `pg/int8` stores digit text, so `pg/int8number@1` — the codec behind `BigIntNumber`, which reads a 64-bit integer as a JavaScript `number` — stores digit text too, where it used to store a JSON number. `sqlite/bigintnumber@1` changed the same way.

The detection flags every contract holding such a column, because a JSON file gives no reliable way to ask for the two facts together. A column is affected only when both are true: its codec is `pg/int8number@1` or `sqlite/bigintnumber@1`, **and** it carries a literal default. A column with no default, or with a function default, is unaffected — read the flagged file and check. In `contract.json` an affected column reads:

```json
"viewCount": {
  "codecId": "pg/int8number@1",
  "default": { "kind": "literal", "value": 10 },
  "nativeType": "int8",
  "nullable": false
}
```

and becomes:

```json
"viewCount": {
  "codecId": "pg/int8number@1",
  "default": { "kind": "literal", "value": "10" },
  "nativeType": "int8",
  "nullable": false
}
```

Re-run `prisma contract emit` to rewrite `contract.json`, then `prisma db sign` so the signature matches the new contract. Nothing in the schema changes, and nothing in the database changes.

No example in this repository has such a column, so a project is affected only if its own contract holds one.
