---
changes:
  - id: raw-columns-take-a-sql-literal
    summary: |
      A raw column's type is written as a `sql` literal: ``Raw(sql`ltree`)`` in a schema,
      ``type.Raw(sql`ltree`)`` and ``rawColumn(sql`ltree`)`` in TypeScript. `contract emit` refuses
      `Raw("ltree")` with ``Expected sql`...`; write sql`ltree` ``, and TypeScript refuses a plain
      string. Replace the quotes with a `sql` literal holding the same text. The contract does not
      change.
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      matches:
        - '(?<![\w$])Raw\((?!\s*sql\s*`)'
        - '(?<![\w$])rawColumn\((?!\s*sql\s*`)'
  - id: type-constructor-arguments-are-values
    summary: |
      A type-constructor argument is read as a value of a data type, as an attribute argument is.
      A quoted number, such as `VarChar("255")`, `VarChar(length: "255")` or `Timestamp("3")`, is
      refused with `PSL_VALUE_TYPE_INCOMPATIBLE` (`Expected a number; write 255`); write the number
      without quotes. On Postgres a whole number written with a fraction, such as `VarChar(255.0)`,
      is refused too (`Expected a number that pg/int4 can hold; got pg/numeric`); write `255`. A
      number its type cannot hold, such as `VarChar(3000000000)` or `Timestamp(2.5)`, is refused
      at the argument. The same applies to a field preset's precision, such as
      `temporal.timestamp("3")`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![@\w])(?:[a-z]\w*\.)?[A-Z]\w*\((?:[^()"]*[,:])?\s*"[+-]?\d'
        - '(?<![@\w])(?:[a-z]\w*\.)?[A-Z]\w*\((?:[^()"]*[,:])?\s*[+-]?\d+\.0+\s*[,)]'
        - '(?<![\w$])temporal\.\w+\((?:[^()"]*[,:])?\s*"[+-]?\d'
        - '(?<![\w$])temporal\.\w+\((?:[^()"]*[,:])?\s*[+-]?\d+\.0+\s*[,)]'
---

# Type-constructor arguments are values of data types

## `raw-columns-take-a-sql-literal`

The type text of a raw column is SQL the database reads, so it is written as a `sql` literal, like every other place that takes SQL. In a schema:

```prisma
// Before
model Category {
  id     Int @id
  search Raw("tsvector")
  area   Raw("circle") @default(sql`'<(0,0),1>'::circle`)
}

// After
model Category {
  id     Int @id
  search Raw(sql`tsvector`)
  area   Raw(sql`circle`) @default(sql`'<(0,0),1>'::circle`)
}
```

A `types` alias changes the same way: `Search = Raw("tsvector")` becomes ``Search = Raw(sql`tsvector`)``. A type whose name needs double quotes can now be written: ``Raw(sql`"MyType"`)``.

In TypeScript, import `sql` from the contract builder and pass a `sql` value:

```ts
// Before
search: field.column(type.Raw('tsvector')),
codes: field.column(rawColumn('character varying(3)')).many(),

// After
import { sql } from '@prisma/orm-postgres/contract-builder';
search: field.column(type.Raw(sql`tsvector`)),
codes: field.column(rawColumn(sql`character varying(3)`)).many(),
```

Keep the text between the backticks exactly as it was between the quotes.

## `type-constructor-arguments-are-values`

Write each number argument of a type constructor as a number, positional or named. `VarChar("255")` becomes `VarChar(255)`, `VarChar(length: "255")` becomes `VarChar(length: 255)`, and `Numeric("10", "2")` becomes `Numeric(10, 2)`.

A length, precision, scale or SRID on Postgres is a 32-bit integer, so a number written with a fraction is refused, even when the fraction is zero: `VarChar(255.0)` becomes `VarChar(255)`, and `Timestamptz(3.0)` becomes `Timestamptz(3)`. A number larger than 2147483647 is refused too; write the value the column needs.

On SQLite, the length of `sql.String` is a value of `sqlite/real`, so `sql.String(2.0)` is accepted and gives the length `2`. Write `sql.String(2)` anyway, so the schema reads the same on every target. A SQLite length is at most 2147483647, SQLite's largest string length.
