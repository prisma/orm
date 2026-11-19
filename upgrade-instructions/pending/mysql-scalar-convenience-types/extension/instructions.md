---
changes:
  - id: mysql-reemit-contract
    summary: |
      On MySQL and MariaDB, `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` and `Json` are now convenience types, and the target has new codecs for them. The emitted `contract.d.ts` gains aggregate result types for the new codecs. Re-emit the contract; `contract.json` and its hashes do not change, so the database needs no migration and no new signature.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - '[''"]@prisma/orm-(?:mysql|mariadb)/config[''"]'
  - id: mysql-codec-descriptor-wrap-parameter
    summary: |
      A MySQL or MariaDB codec descriptor now has `wrapParameter(parameter, ref)`, which returns the expression a parameter of its codec is written as, and the codec registry refuses a descriptor without it. A descriptor that extends `MysqlCodecDescriptor` or is made with `mysqlCodec()` inherits it. One that implements `AnyMysqlCodecDescriptor` itself must add it.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bAnyMysqlCodecDescriptor\b'
---

# MySQL and MariaDB scalars get convenience types

On MySQL and MariaDB, `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` and `Json` are now convenience types, as on PostgreSQL, SQLite and MongoDB. Each chooses one explicit type named after the MySQL column type that stores it: `Int` is `Int4`, `BigInt` is `Int8BigInt`, `BigInt(as: number)` is `Int8Number`, `Float` is `Float8` (a `double`), `Decimal` is `NumericString(65, 30)`, `String` is `Varchar(191)` and `String(storage: text)` is `Text`, `Boolean` is `Bool` (a `tinyint(1)`), `Bytes` is `Longblob` and `Json` is `PlainJson`. A field written `Int`, `BigInt` or `String` gives the same codec as before, so no schema needs a change.

## `mysql-reemit-contract`

In each matched project, emit the contract again:

```bash
pnpm prisma contract emit
```

The generated `contract.d.ts` gains entries under `AggregateTypes` for the new codecs, such as `sum` over `mysql/decimal@1` and `avg` over `mysql/double@1`. `contract.json` does not change, so its hashes and the database's signature stay as they are, and no migration is needed. Leave the `contract.d.ts` copy inside each migration snapshot under `migrations/snapshots/` as it is.

## `mysql-codec-descriptor-wrap-parameter`

In each matched file, find any object or class that implements `AnyMysqlCodecDescriptor` itself, without extending `MysqlCodecDescriptor` (from `@prisma/orm-target-mysql/target/codec-descriptor`) or being made with `mysqlCodec()`. If a matched file gives the type another name, such as `type CustomDescriptor = AnyMysqlCodecDescriptor`, search the project for that name too: a descriptor typed through it can sit in a file this step does not match. Give each such descriptor a `wrapParameter` method that returns the parameter it is given:

```ts
import type { CodecRef } from '@prisma/orm-framework/components/codec';
import type { AnyExpression, AnyParamRef } from '@prisma/orm-family-sql/relational-core/ast';

wrapParameter(parameter: AnyParamRef, _ref: CodecRef): AnyExpression {
  return parameter;
}
```

The MySQL renderer calls it for every parameter of the codec but those of `LIMIT` and `OFFSET`, with the parameter as an expression and the codec reference, which carries the column's type parameters, and writes the expression it returns into the statement. Return an expression around the parameter only when the server must read the value as a particular type, as MySQL's own `mysql/decimal@1` returns `CastExpr.as(parameter, 'DECIMAL(65,30)')` for a column with at most 35 digits before the point, and a cast with fewer digits after the point for a wider column, read from the type parameters of the codec reference. The expression must hold the parameter exactly once, or the renderer refuses the statement with `RUNTIME.CODEC_DESCRIPTOR_INVALID`. Without the method, building the codec registry fails with `RUNTIME.CODEC_DESCRIPTOR_INVALID`. A file that only uses `AnyMysqlCodecDescriptor` as a type, such as the type of a parameter, needs no change.
