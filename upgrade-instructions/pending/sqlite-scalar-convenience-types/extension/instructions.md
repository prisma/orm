---
changes:
  - id: sqlite-decimal-codec
    summary: |
      On SQLite, `Decimal` is now a convenience type over the explicit type `DecimalString`, with its own codec `sqlite/decimal@1` on the same `text` column. A field written `Decimal` (or `type.Decimal()`) emitted `sqlite/text@1` before. Re-emit the contract and sign the database; no column changes and no data moves. Stored text that is not a decimal now fails to read, so find and fix such rows.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?:^|\n)[ \t]*[A-Za-z_]\w*[ \t]+Decimal(?![\w])'
        - '=[ \t]*Decimal(?![\w])'
  - id: ts-sqlite-decimal-codec
    summary: |
      In a SQLite TypeScript contract, `type.Decimal()` now emits codec `sqlite/decimal@1` instead of `sqlite/text@1`, and `type.DecimalString()` is the same type. Re-emit the contract and sign the database; no column changes and no data moves.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*[''"](?:@prisma/orm-sqlite|@internal/sqlite)/contract-builder[''"])[\s\S]*\.\s*Decimal\s*\('
  - id: sqlite-bigintnumber-deprecated
    summary: |
      On SQLite, `BigIntNumber` is a deprecated alias of `IntegerNumber` that warns with `PSL_DEPRECATED_SCALAR_NAME`, and a field written with it now emits codec `sqlite/integer@1` instead of `sqlite/bigintnumber@1`. Write `BigInt(as: number)` (or `type.BigInt({ as: 'number' })`), re-emit the contract and sign the database. No column changes and no data moves.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '(?<![\w.])BigIntNumber(?![\w])'
        - '\.\s*BigIntNumber\s*\('
  - id: ts-renamed-sqlite-column-helpers
    summary: |
      The SQLite column helpers are renamed after the explicit type each gives: `integerColumn` is `integerNumberColumn` (`IntegerNumber`), `bigintColumn` is `integerBigIntColumn` (`IntegerBigInt`) and `jsonColumn` is `plainJsonColumn` (`PlainJson`). The old names are removed. The contract does not change.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:import|export)[ \t]+(?:type[ \t]+)?\{[^}]*(?<![\w$])(?:integerColumn|bigintColumn|jsonColumn)(?![\w$])[^}]*\}[ \t]*from[ \t]*[''"](?:@prisma/orm-sqlite/adapter/column-types|@prisma/orm-target-sqlite/adapter/column-types|@internal/adapter-sqlite/column-types)[''"]'
        - 'import[ \t]+(?:type[ \t]+)?\*[ \t]*as[ \t]+([\w$]+)[ \t]+from[ \t]*[''"](?:@prisma/orm-sqlite/adapter/column-types|@prisma/orm-target-sqlite/adapter/column-types|@internal/adapter-sqlite/column-types)[''"][\s\S]*(?<![\w$])\1\s*\.\s*(?:integerColumn|bigintColumn|jsonColumn)(?![\w$])'
---

# SQLite scalars get convenience types

On SQLite, `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Bytes` and `Json` are now convenience types, as on PostgreSQL and MongoDB. Each chooses one explicit type named after the SQLite column type that stores it: `Int` is `IntegerNumber`, `BigInt` is `IntegerBigInt`, `BigInt(as: number)` is `IntegerNumber`, `Float` is `Real`, `String` is `Text`, `Bytes` is `Blob` and `Json` is `PlainJson`. `Decimal` is `DecimalString`, named after its data type because SQLite has no decimal column type. Written bare, `Int`, `BigInt`, `Float`, `String`, `Bytes` and `Json` give the same codec as before.

Two names change the contract. A `Decimal` field gets its own codec, `sqlite/decimal@1`, where it was the same codec as `String`. `BigIntNumber` is a deprecated alias of `IntegerNumber`, so its codec id changes. Neither changes a column, and no data moves.

The column helpers of the TypeScript contract builder are renamed after the explicit type each gives, and `decimalStringColumn` is new.

## Sign the database with the new contract

The `Decimal` and `BigIntNumber` changes below change the contract's storage hash, so `db verify` reports `CONTRACT.MARKER_MISMATCH` until the database is signed with the new contract. After re-emitting the contract:

- In a project with migrations, run `migration plan`. It writes a migration with no operations, which names the changed table, and `db migrate` applies it and signs the database. No table is rebuilt.
- In a project without migrations, run `db update`. It runs no operation and signs the database.

`db verify --schema-only` passes before and after: the columns are the same.

## `sqlite-decimal-codec`

This applies to a schema whose target is SQLite. On PostgreSQL and MongoDB, `Decimal` does not change; skip this entry there. The detection matches every schema with a field or a `types {}` alias written `Decimal`, whatever its target.

Nothing in the schema changes. Re-emit the contract: each `Decimal` field's column now has codec `sqlite/decimal@1` and data type `sqlite/decimal` where it had `sqlite/text@1`. Then sign the database as described above.

`sqlite/decimal@1` reads and writes decimal text such as `"12.50"`, as before. It now refuses to write text that is not a decimal, and reading stored text that is not a decimal raises `RUNTIME.DECODE_FAILED`, naming the column. Such text is most often the `''` that an earlier migration wrote into the rows of a new required `Decimal` column; a new required column is now filled with `'0'`. Find those rows with this query, putting in each `Decimal` column and its table:

```sql
SELECT rowid, "price"
FROM "product"
WHERE "price" IS NOT NULL
  AND NOT (
    typeof("price") = 'text'
    AND ltrim("price", '-') <> ''
    AND length("price") - length(ltrim("price", '-')) <= 1
    AND ltrim("price", '-') NOT GLOB '*[^0-9.]*'
    AND ltrim("price", '-') NOT GLOB '*.*.*'
    AND ltrim("price", '-') NOT GLOB '.*'
    AND ltrim("price", '-') NOT GLOB '*.'
  );
```

Set each row it returns to a decimal, such as `UPDATE "product" SET "price" = '0' WHERE "price" = '';`, or make the field optional and set it to `NULL`.

A `Decimal` field can be compared for equality only. Text compares by its characters, so `"1.5"` and `"1.50"` are different values, and ordering and aggregates such as `sum` and `max` are not offered; code that used them on a `Decimal` field no longer type-checks. A `Decimal` default may be written as text, `@default("12.50")`, or as a whole number, `@default(3)`.

Leave the `contract.prisma` copy inside each migration folder under `migrations/` as it is: it records the schema that migration was planned from.

## `ts-sqlite-decimal-codec`

In a SQLite TypeScript contract, `type.Decimal()` and `type.DecimalString()` give the same column, with codec `sqlite/decimal@1`. The code does not change. Re-emit the contract and sign the database as described above; the notes under `sqlite-decimal-codec` about stored text that is not a decimal, equality and the column's values apply here too. A file that matches only because another library's `Decimal(` is called in it needs no change.

## `sqlite-bigintnumber-deprecated`

This applies to a SQLite schema or TypeScript contract. On PostgreSQL, `BigIntNumber` is covered by the PostgreSQL scalar rename; skip this entry there.

In each matched SQLite schema, replace the type `BigIntNumber` with `BigInt(as: number)`, in fields, value object members and `types {}` aliases. In a SQLite TypeScript contract, replace `type.BigIntNumber()` with `type.BigInt({ as: 'number' })`:

```prisma
model Post {
  id        Int                 @id
  viewCount BigInt(as: number)  // was BigIntNumber
}
```

`IntegerNumber`, the explicit type, and `Int` give the same column too. The field's codec id changes from `sqlite/bigintnumber@1` to `sqlite/integer@1`, which reads a `number` within the safe integer range and refuses a value outside it, as `sqlite/bigintnumber@1` did. Re-emit the contract and sign the database as described above.

`sqlite/bigintnumber@1` stays: `count()` and the `sum` of an integer column still read their result through it, so a reference to it in generated `contract.d.ts` aggregate types is expected. A file that matches only because a comment or a string mentions `BigIntNumber` needs no change. Leave the `contract.prisma` copy inside each migration folder under `migrations/` as it is.

## `ts-renamed-sqlite-column-helpers`

The detection matches a file that imports or re-exports `integerColumn`, `bigintColumn` or `jsonColumn` from `@prisma/orm-sqlite/adapter/column-types`, `@prisma/orm-target-sqlite/adapter/column-types` or `@internal/adapter-sqlite/column-types`, or imports one of them as a namespace and reads one of those names from it. In that file, rename the import or re-export and every use of the name:

| Old name | New name | Explicit type |
| --- | --- | --- |
| `integerColumn` | `integerNumberColumn` | `IntegerNumber`, codec `sqlite/integer@1` |
| `bigintColumn` | `integerBigIntColumn` | `IntegerBigInt`, codec `sqlite/bigint@1` |
| `jsonColumn` | `plainJsonColumn` | `PlainJson`, codec `sqlite/json@1` |

```ts
import { integerNumberColumn, plainJsonColumn } from '@prisma/orm-sqlite/adapter/column-types';

field.column(integerNumberColumn); // was integerColumn
field.column(plainJsonColumn); // was jsonColumn
```

Any other form, such as a dynamic import, fails type-checking because the export is gone; rename it where the compiler reports it. `field.column(type.Int())` and `field.column(type.IntegerNumber())` give the same column. A file that imports `jsonColumn` from a PostgreSQL package is covered by the PostgreSQL rename, not this one. `textColumn`, `realColumn` and `blobColumn` keep their names. `decimalStringColumn` is new and gives `DecimalString`, codec `sqlite/decimal@1`.
