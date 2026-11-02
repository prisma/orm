---
changes:
  - id: psl-renamed-postgres-scalar-types
    summary: |
      In a Prisma 8 schema on PostgreSQL, `SmallInt`, `BigIntNumber`, `Numeric`, `UnboundedInt`, `Real` and `VarChar` are deprecated and report `PSL_DEPRECATED_SCALAR_NAME` as a warning. Write the convenience call that gives the same type instead: `Int(storage: int2)`, `BigInt(as: number)`, `Decimal(precision: p, scale: s)`, `BigInt(storage: numeric)`, `Float(storage: float4)` and `String(storage: varchar, length: n)`. The contract does not change. A Prisma 7 schema, which has a `datasource` block, is not affected.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?![\s\S]*(?<![\w$])datasource[ \t]+\w+[ \t]*\{)[\s\S]*\n[ \t]+[A-Za-z_]\w*[ \t]+(?:=[ \t]*)?(?:SmallInt|BigIntNumber|Numeric|UnboundedInt|Real|VarChar)(?![\w$])'
  - id: ts-renamed-postgres-scalar-helpers
    summary: |
      In a TypeScript contract on PostgreSQL, `type.SmallInt()`, `type.BigIntNumber()`, `type.Numeric(...)`, `type.UnboundedInt()`, `type.Real()` and `type.VarChar(...)` are deprecated. Call the convenience helper that gives the same type instead, such as `type.String({ storage: 'varchar', length: 64 })` for `type.VarChar(64)`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])type\.(?:SmallInt|BigIntNumber|Numeric|UnboundedInt|Real|VarChar)\('
---

# PostgreSQL's integer, decimal, float and text types are convenience types

On PostgreSQL, `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean` and `Bytes` are now convenience types, as `DateTime` already is. Each is named for what a field means, and its optional `storage` argument (and `as`, for `BigInt`) chooses an explicit type named after the database type. Written bare, each gives the same type as before, so schemas that use these names need no change.

The explicit types took the database's names. Six old names stay for one release line as deprecated aliases: they give the same codec and the same contract, and `prisma contract emit` and the editor report a warning where one is written.

## `psl-renamed-postgres-scalar-types`

Rewrite each field or `types {}` alias written with an old name, keeping its other arguments and attributes:

| Before | After | Explicit type it gives |
| --- | --- | --- |
| `SmallInt` | `Int(storage: int2)` | `Int2` |
| `BigIntNumber` | `BigInt(as: number)` | `Int8Number` |
| `Numeric` | `Decimal` | `NumericString` |
| `Numeric(p)` | `Decimal(precision: p)` | `NumericString(p)` |
| `Numeric(p, s)` | `Decimal(precision: p, scale: s)` | `NumericString(p, s)` |
| `UnboundedInt` | `BigInt(storage: numeric)` | `NumericBigInt` |
| `Real` | `Float(storage: float4)` | `Float4` |
| `VarChar` | `String(storage: varchar)` | `Varchar` |
| `VarChar(n)` | `String(storage: varchar, length: n)` | `Varchar(n)` |

Writing the explicit type in the last column instead is equally correct; it is the same type.

```prisma
model Account {
  id     Int                                  @id
  visits Int(storage: int2)                   // was SmallInt
  rank   BigInt(as: number)                   // was BigIntNumber
  price  Decimal(precision: 10, scale: 2)     // was Numeric(10, 2)
  code   String(storage: varchar, length: 12) // was VarChar(12)
}
```

Rewrite only Prisma 8 schemas whose config uses the PostgreSQL target, including the `contract.prisma` copies in migration folders. The detection cannot tell which target a schema is for, so it also matches SQLite's `BigIntNumber` and MySQL's `VarChar`; a match in a project whose `prisma.config.ts` uses the SQLite or MySQL target needs no change. Update comments and documentation that name the old types the same way. Re-emit the contract with `prisma contract emit`: it is byte for byte the same as before.

## `ts-renamed-postgres-scalar-helpers`

Rewrite only in contracts on PostgreSQL:

```ts
field.column(type.Int({ storage: 'int2' })); // was type.SmallInt()
field.column(type.BigInt({ as: 'number' })); // was type.BigIntNumber()
field.column(type.Decimal({ precision: 10, scale: 2 })); // was type.Numeric(10, 2)
field.column(type.BigInt({ storage: 'numeric' })); // was type.UnboundedInt()
field.column(type.Float({ storage: 'float4' })); // was type.Real()
field.column(type.String({ storage: 'varchar', length: 64 })); // was type.VarChar(64)
```

The explicit helpers `type.Int2()`, `type.Int8Number()`, `type.NumericString(10, 2)`, `type.NumericBigInt()`, `type.Float4()` and `type.Varchar(64)` give the same types.
