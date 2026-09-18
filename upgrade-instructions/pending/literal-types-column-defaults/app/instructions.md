---
changes:
  - id: json-column-default-is-a-json-tag
    summary: |
      A `Json` or `Jsonb` column's literal default is written ``@default(json`{ "a": 1 }`)``.
      A quoted string is now refused: a JSON column accepts a `json` literal, not a `string` one.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(Json|Jsonb)(\[\])?\??\s+@default\("'
  - id: decimal-and-float-defaults-are-numbers
    summary: |
      A `Decimal`, `Numeric` or `Float` column's literal default is written as a number, not as a
      quoted string: `@default(1.50)`, `@default(NaN)`, `@default(-Infinity)`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(Decimal|Numeric(\([^)]*\))?|Float|Real)(\[\])?\??\s+@default\("'
  - id: a-quoted-default-needs-a-column-that-takes-text
    summary: |
      Every literal `@default` is now checked against the column's codec by type. A quoted value on
      a column whose codec does not accept a `string` literal is refused with
      `PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE`, and a number too large for its column with the same
      code instead of a decode failure.
    detection:
      glob: "**/*.prisma"
      contains:
        - "@default("
  - id: infer-prints-literals-where-it-printed-dbgenerated
    summary: |
      `prisma contract infer` now prints a temporal, numeric or JSON column default as the literal
      its codec reads back, where it printed `dbgenerated("...")` or dropped the default before.
      Re-run infer and review the diff before emitting.
    detection:
      glob: "**/*.prisma"
      contains:
        - "dbgenerated("
  - id: a-number-column-default-authored-as-text-now-stores-the-number
    summary: |
      A number-typed column whose default was authored as quoted text — `.default('0')` on a SQLite
      `integer` column — now renders `DEFAULT 0` rather than `DEFAULT '0'`. Author the number.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - "\\.default\\(['\"]-?\\d+(\\.\\d+)?['\"]\\)"
---

## `json-column-default-is-a-json-tag`

A column default is now a literal of a type, and the column's codec names the types it accepts. `pg/json@1`, `pg/jsonb@1`, `sqlite/json@1` and `arktype/json@1` accept a `json` literal, which is written as a tagged literal:

| Before | After |
| --- | --- |
| `meta Jsonb @default("{}")` | ``meta Jsonb @default(json`{}`)`` |
| `meta Jsonb @default("{\"plan\":\"free\"}")` | ``meta Jsonb @default(json`{ "plan": "free" }`)`` |
| `docs Jsonb[] @default(["{}"])` | ``docs Jsonb[] @default([json`{}`])`` |

The body inside the tag is the JSON document itself, so it needs none of the escaping a PSL string needed. A backtick body resolves `` \` `` and `\\` and nothing else, so `` json`{ "plan": "free" }` `` needs no escaping at all.

A backslash has to survive twice — the backtick fence, then JSON — so a JSON string that needs one backslash is written with four:

| In the schema | After the fence | JSON reads |
| --- | --- | --- |
| ``json`{ "re": "\\\\d+" }` `` | `{ "re": "\\d+" }` | the string `\d+` |

Two backslashes are not enough: the fence turns them into one, and `\d` is not a JSON escape, so the body is refused with `PSL_INVALID_JSON_LITERAL` — as is any other body that is not a JSON document.

`` @default(json`null`) `` stores the JSON value null, as `@default("null")` did.

## `decimal-and-float-defaults-are-numbers`

A number's literal type comes from what is written, so a quoted value is a `string` literal, which no numeric codec accepts:

| Before | After |
| --- | --- |
| `price Decimal @default("1.50")` | `price Decimal @default(1.50)` |
| `ratio Float @default("NaN")` | `ratio Float @default(NaN)` |
| `ratio Float @default("-Infinity")` | `ratio Float @default(-Infinity)` |
| `prices Decimal[] @default(["1.50", "2"])` | `prices Decimal[] @default([1.50, 2])` |

Trailing zeros are kept (`1.50` stays `1.50`), and leading zeros and the sign of zero are dropped (`007.50` is `7.50`, `-0.0` is `0.0`) — the same values these defaults have had. `NaN`, `Infinity` and `-Infinity` are written bare; they are number tokens in PSL, not identifiers.

`Real` on SQLite and `Float` on a column whose codec refuses non-finite values (`sqlite/real@1`, `sql/float@1`, `pg/float@1`) do not accept `NaN` at all; that is now `PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE` rather than a decode failure at emit.

## `a-quoted-default-needs-a-column-that-takes-text`

Every literal default is classified into a type — `string`, `boolean`, `i8`/`i16`/`i32`/`i64`/`bigint` by the number's size, `decimal`, `float`, `json`, or a list of those — and checked against the column's codec before anything is decoded. Two families of schema that used to emit now fail at `contract emit`:

```text
count  Int     @default("1")                  // pg/int4@1 is not compatible with a string literal
count  Int     @default(100000000000000099)   // ... with an i64 literal; it accepts i8, i16, i32 literals
count  Int     @default(1.5)                  // ... with a decimal literal
payload Bytes  @default(1234)                 // pg/bytea@1 ... it accepts string literals
```

The message names the column, the codec, the literal's type and what the codec accepts, so the fix is to write a literal of an accepted type, or to widen the column. A column whose codec accepts no literal default at all — `pg/enum@1` (write the member name), `pg/text-array@1`, every Mongo codec — reads `it accepts no literal defaults`; give it a `` sql`...` `` default instead.

## `infer-prints-literals-where-it-printed-dbgenerated`

`prisma contract infer` chooses the literal from the same declaration, so a default it used to print as a raw expression now prints as a literal:

| Column | Before | After |
| --- | --- | --- |
| `jsonb DEFAULT '{}'::jsonb` | `@default(dbgenerated("'{}'::jsonb"))` | ``@default(json`{}`)`` |
| `timestamp(3) DEFAULT '2024-01-01 00:00:00'` | `@default(dbgenerated("'2024-01-01 00:00:00'::timestamp without time zone"))` | `@default("2024-01-01 00:00:00")` |
| `numeric(10,2) DEFAULT 1.50` | `@default("1.50")` | `@default(1.50)` |
| `float8 DEFAULT 'NaN'` | `@default("NaN")` | `@default(NaN)` |

The printed schema emits and verifies clean against the same database, so the change is in the text, not in the contract. Re-run `prisma contract infer` and commit the new text; a default whose value the codec cannot read back — `timestamp DEFAULT 'infinity'` — still prints as `dbgenerated(...)`.

## `a-number-column-default-authored-as-text-now-stores-the-number`

A codec now reads the value shape of every literal type it accepts, so `sqlite/integer@1` reads the digit text `'0'` as the number `0`. A contract that authored a number column's default as a quoted string therefore renders `DEFAULT 0` where it rendered `DEFAULT '0'`, and a schema diff over DDL text will show it. Author the number:

```diff
-priority: field.column(integerColumn).default('0'),
+priority: field.column(integerColumn).default(0),
```

Re-emit and run `prisma db verify --schema-only` against an existing database: if it reports the column's default, apply the change with `prisma db update` or a migration.
