---
from: "8.0.0-rc.15"
to: "8.0.0-rc.16"
changes:
  - id: engine-pin-moves-to-0-6-3
    summary: |
      The toolchain now requires `@prisma/cli-engine@0.6.3` (up from 0.6.2). A project that pins `@prisma/cli-engine` itself must move the pin to `0.6.3`. The engine's only change is that it accepts any ArkType `^2.2.7`, so it shares one ArkType copy with the Prisma ORM packages.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/cli-engine": "0.6.2"'
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
      A `@default` refusal from the cast rule starts with what to write instead, as in `Expected a number`, not the list of types the column casts from. It names the column's type and the value's type only when a value of an admitted form is still refused, such as a number too large for the column. `Unknown literal tag` in a `@default` starts with the field it is about, and `this target has no data type for` comes after what to write.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,json}"
      matches:
        - '; it casts from '
        - '(: |[''"`])this target has no data type for a (string|boolean|number) value[''"`]'
        - '[''"`]Unknown literal tag '
  - id: function-call-arguments-keep-their-diagnostics
    summary: |
      A call to a function that exactly one alternative of an attribute argument names, such as `@default(uuid(5))`, reports what is wrong with its arguments instead of `Expected one of: …`.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs}"
      matches:
        - 'Expected one of: string \| number \| boolean \| autoincrement\(\)'
  - id: contract-artifacts-restamp
    summary: |
      An extension that writes its own package version into the contracts it emits, such as the
      Supabase extension, now writes 8.0.0-rc.16. Run `contract emit` once after upgrading so the
      emitted `contract.json` and `contract.d.ts` match the installed extension.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.15"'
---

# 8.0.0-rc.15 → 8.0.0-rc.16 — User upgrade instructions

## `engine-pin-moves-to-0-6-3`

For every `package.json` matched by `detection`, change the `@prisma/cli-engine` version from `0.6.2` to `0.6.3` and reinstall. Projects assembled by the `prisma` CLI resolve the engine automatically.

Engine 0.6.2 required ArkType `2.2.3` exactly, while the Prisma ORM packages accept any `^2.2.2`. A package manager could then install two ArkType copies, and with Bun `prisma contract emit` failed on a valid contract with `CONTRACT.VALIDATION_FAILED`. Engine 0.6.3 accepts `^2.2.7`, so one copy serves both. Nothing in the engine's commands or output changes.

## `default-refusals-point-at-the-written-value`

This entry, `default-refusals-say-what-to-write` and `function-call-arguments-keep-their-diagnostics` matter only to code that reads the location of a PSL diagnostic, or the text of a diagnostic message, such as a test that asserts one. Schemas and contracts do not change.

`PSL_VALUE_TYPE_INCOMPATIBLE` and `PSL_INVALID_LITERAL` from `@default` used to point at the whole `@default(...)` attribute. They now point at the written value. When the message names a list element (`at element 2`), they point at that element. The codes are unchanged; the next section describes the new wording. `PSL_DEFAULT_LIST_EXPECTED` and `PSL_INVALID_DEFAULT_LITERAL` still point at the attribute.

For `tags Int[] @default([1, "x"])`, the diagnostic `Field "Post.tags" at element 2: Expected a number` now spans `"x"`.

When a tagged literal has both an unknown tag and a NUL character or more text than the limit, `@default` now reports the canonicalization code, `PSL_TAGGED_LITERAL_NUL` or `PSL_TAGGED_LITERAL_TOO_LARGE`, where it used to report `PSL_UNKNOWN_LITERAL_TAG`.

This supersedes the last row of the table in `default-diagnostic-codes-changed` in the 8.0.0-rc.14 to 8.0.0-rc.15 guide: a `sql` literal inside a list literal is reported with `PSL_VALUE_TYPE_INCOMPATIBLE` at the element, not at the `@default` attribute.

Update an assertion on the span or range of one of these diagnostics to the written value.

### `sql` is no longer offered as a list element

A `sql` literal is never a list element, so the list arm of `@default` no longer lists it. The editor stops offering `sql` inside `@default([`, and an `Expected one of` message for `@default` ends with `list of (string | number | boolean | json`...`)` instead of `list of (string | number | boolean | sql`...` | json`...`)`. A `sql` literal written inside a list is still refused by the cast rule, as before.

Update an assertion on that message to the new text.

## `default-refusals-say-what-to-write`

`@default` and every other position that takes a value of a data type now word a refusal of the cast rule the same way. A refusal starts with what to write instead, the forms the column's type admits, as in `Expected a number`, not the list of types it casts from. It names the column's type and the value's type only when the value has an admitted form and is still refused, such as a number too large for the column. A quoted string on a column whose type has a tag also gets that string as a tagged literal to write, when the column's type takes it, as the `Jsonb` row shows. An element of a list written on a column whose type has a list cast, such as a vector, is refused with the forms of the list cast's element types. The two other refusals change as the table shows. The codes do not change.

| Written | Message before | Message now |
| --- | --- | --- |
| `count Int @default(100000000000000099)` | `Field "N.count": pg/int4 has no cast from pg/int8; it casts from pg/int2` | `Field "N.count": Expected a number that pg/int4 can hold; got pg/int8` |
| `meta Jsonb @default("{}")` | `Field "N.meta": pg/jsonb has no cast from pg/text; it casts from pg/json` | ``Field "N.meta": Expected json`...`; write json`{}` `` |
| `count Int @default([1])` | `Field "N.count": pg/int4 has no cast from a list; it casts from pg/int2` | `Field "N.count": Expected a number; got a list` |
| `embed pgvector.Vector(3) @default([1, "x", 3])` | `Field "N.embed" at element 2: pgvector/vector has no cast from pg/text; it casts from pg/int2, pg/int4, pg/int8, pg/numeric` | `Field "N.embed" at element 2: Expected a number` |
| `active Int @default(true)` on SQLite | `Field "N.active": this target has no data type for a boolean value` | `Field "N.active": Expected a number; this target has no data type for a boolean value` |
| ``v String @default(pg.sql`x`)`` | `Unknown literal tag "pg.sql". Known tags: sql, json.` | `Field "N.v": Unknown literal tag "pg.sql". Known tags: sql, json.` |
| ``tags String[] @default([sql`'a'`])`` | `Field "Post.tags" at element 1: pg/text has no cast from sql/expression; it casts from nothing` | `Field "Post.tags" at element 1: Expected a quoted string` |
| `enum P { @@type("pg/text@1") Low = 1 }` | `enum "P" member "Low": pg/text has no cast from pg/int2; it casts from nothing` | `enum "P" member "Low": Expected a quoted string` |
| `enum P { Low = 3000000000 }`, an enum without `@@type` | `enum "P" member "Low": pg/int4 has no cast from pg/int8; it casts from pg/int2` | `enum "P" member "Low": Expected a number that pg/int4 can hold; got pg/int8` |

Update an assertion on one of these messages to the new text.

## `function-call-arguments-keep-their-diagnostics`

A call to a default function with wrong arguments used to report `PSL_INVALID_ATTRIBUTE_SYNTAX` with `Expected one of: string | number | boolean | autoincrement() | …` at the whole `@default` value. When exactly one alternative names the called function, the diagnostic now comes from that function, at the argument it is about. The code is still `PSL_INVALID_ATTRIBUTE_SYNTAX`. The same holds for any attribute argument that offers several functions, such as the field functions of a MongoDB `@@index`.

| Written | Message before | Message now |
| --- | --- | --- |
| `@default(uuid(5))` | `Expected one of: string \| number \| …`, at `uuid(5)` | `Expected one of: 4 \| 7`, at `5` |
| `@default(nanoid(1))` | `Expected one of: string \| number \| …`, at `nanoid(1)` | `Expected an integer between 2 and 255`, at `1` |
| `@default(cuid())` | `Expected one of: string \| number \| …`, at `cuid()` | `Attribute "cuid" is missing required argument "version"`, at `cuid()` |

A call to a function no alternative names, such as `@default(other(1))`, still reports `Expected one of: …`. Schemas and contracts do not change. Update an assertion on the old message or span to the new one.

## `contract-artifacts-restamp`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. This entry accounts for the extension's embedded `version` moving to `8.0.0-rc.16`; any other difference in the emitted files comes from an earlier entry in this guide.
