---
changes:
  - id: psl-renamed-mongo-int64
    summary: |
      On MongoDB, the explicit type `Int64` (a BSON long read as a `bigint`) is renamed `Int64BigInt`. `Int64` stays for one release line as a deprecated alias that warns with `PSL_DEPRECATED_SCALAR_NAME`. The contract does not change.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\w.])Int64(?![\w])'
  - id: ts-removed-mongo-int64-helper
    summary: |
      In a MongoDB TypeScript contract, `type.Int64()` is removed. Write `type.BigInt()`, the convenience type, or `type.Int64BigInt()`, the explicit type. Both give the same contract.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.\s*Int64\s*\('
        - '\{[^{}]*\bInt64\b[^{}]*\}\s*=\s*\w'
  - id: psl-optional-mongo-convenience-names
    summary: |
      Optional: in a MongoDB schema, the explicit types `Int32`, `Double` and `Bool` may be written as the convenience types `Int`, `Float` and `Boolean`. The contract does not change.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\bObjectId\b)[\s\S]*(?<![\w.])(?:Int32|Double|Bool)(?![\w])'
---

# MongoDB scalars get convenience types

On MongoDB, `Int`, `BigInt`, `Float`, `Decimal`, `Boolean`, `Bytes`, `String` and `Json` are now convenience types, as on PostgreSQL. Each chooses one explicit type named after the BSON type that stores it: `Int` is `Int32`, `BigInt` is `Int64BigInt`, `BigInt(as: number)` is `Int64Number`, `Float` is `Double`, `Decimal` is `Decimal128`, `Boolean` is `Bool`, `Bytes` is `Binary`, `String` is `BsonString` and `Json` is `PlainJson`. Every contract stays the same.

`Int`, `Float` and `Boolean` no longer warn, and `type.Int()`, `type.Float()` and `type.Boolean()` exist again. `BigInt`, `Bytes` and `Decimal`, which MongoDB refused before, now resolve.

## `psl-renamed-mongo-int64`

In each matched schema, replace the type `Int64` with `BigInt`, the convenience type, or `Int64BigInt`, the explicit type. Do this in fields, value object members and `types {}` aliases. Leave `Int64Number` as it is, or write it `BigInt(as: number)`:

```prisma
model Post {
  id    ObjectId @id @map("_id")
  views BigInt   // was Int64
}
```

The contract does not change. A file that matches only because a comment or a string mentions `Int64` needs no change. Leave the `contract.prisma` copy inside each migration folder under `migrations/` as it is: it records the schema that migration was planned from, and `Int64` still reads there as the same type.

## `ts-removed-mongo-int64-helper`

In each matched file, replace every `Int64(` call on the `type` helpers with `BigInt(` or `Int64BigInt(`, including a call split across lines:

```ts
field.scalar(type.BigInt()); // was type.Int64()
```

A helper taken out of `type` by destructuring, such as `const { Int64 } = type`, also matches. Take out `BigInt` or `Int64BigInt` instead and rename its calls. The contract does not change. A file that matches only because a comment mentions `Int64(`, or because it uses another library's `Int64`, such as Apache Arrow's `new arrow.Int64()`, needs no change.

## `psl-optional-mongo-convenience-names`

This change is optional. In a MongoDB schema, `Int`, `Float` and `Boolean` are now the names to write, and they give exactly the same codecs as `Int32`, `Double` and `Bool`. To use them, replace the type `Int32` with `Int`, `Double` with `Float` and `Bool` with `Boolean`, in fields, lists, value object members and `types {}` aliases:

```prisma
model Order {
  id     ObjectId @id @map("_id")
  amount Int      // was Int32
  total  Float    // was Double
  paid   Boolean  // was Bool
}
```

The contract does not change. Do this only in a MongoDB schema: on other targets `Int32`, `Double` and `Bool` are different types or do not exist. Leave `Int32` in a codec id such as `mongo/int32@1`, and leave names that only start with these, such as a composite type named `DoubleValue`, as they are. Leave the `contract.prisma` copy inside each migration folder under `migrations/` as it is: it records the schema that migration was planned from.
