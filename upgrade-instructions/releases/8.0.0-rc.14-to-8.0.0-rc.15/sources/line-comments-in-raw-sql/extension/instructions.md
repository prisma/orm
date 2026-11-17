---
changes:
  - id: ddl-nodes-hold-opaque-sql
    summary: |
      `FunctionColumnDefault`, `CheckExpressionConstraint`, `PostgresCreatePolicy` and `PostgresCreateIndex` hold their SQL as an `OpaqueSql` value instead of a string, and `DdlIndexElements` changed with them. Wrap the string with `opaqueSql(...)` when you construct one, read `.text` where you read the SQL, and render it with `renderOpaqueSql(...)`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bnew\s+(?:[\w$]+\.)?(FunctionColumnDefault|CheckExpressionConstraint|PostgresCreatePolicy|PostgresCreateIndex)\s*\('
---

# Line comments in raw SQL are safe

## DDL nodes hold `OpaqueSql`

SQL that Prisma places inside a larger statement now travels as an `OpaqueSql` value, exported with `opaqueSql` and `renderOpaqueSql` from `@internal/sql-relational-core/ast`. These types changed:

| Type | Field | Was | Is |
| --- | --- | --- | --- |
| `FunctionColumnDefault` | `expression` | `string` | `OpaqueSql` |
| `CheckExpressionConstraint` | `expression` | `string` | `OpaqueSql` |
| `PostgresCreatePolicy` | `using`, `withCheck` | `string \| undefined` | `OpaqueSql \| undefined` |
| `PostgresCreateIndex` | `where` | `string \| undefined` | `OpaqueSql \| undefined` |
| `PostgresCreateIndex` | `elements.expression` | `string` | `OpaqueSql` |
| `DdlIndexElements` (`@internal/target-postgres/ddl`) | `expression` | `string` | `OpaqueSql` |

Code that constructs one of these nodes directly wraps the string:

```diff
- new FunctionColumnDefault('now()')
+ new FunctionColumnDefault(opaqueSql('now()'))
```

The factories `fn` and `checkExpression` still take strings, as do `createPolicy` and `createIndex` inside the Postgres target. Prefer a factory over a constructor where one is exported:

```diff
- new CheckExpressionConstraint({ name: 'chk', expression: 'price > 0' })
+ checkExpression('chk', 'price > 0')
```

`createIndex` now takes its element list as `CreateIndexElements`, which holds strings and is exported from `@internal/target-postgres/ddl` next to `DdlIndexElements`. Code that typed the elements it passes to `createIndex` as `DdlIndexElements` uses `CreateIndexElements` instead.

Code that reads `.expression`, `.using`, `.withCheck` or `.where` of these nodes now reads `.text`. The TypeScript compiler reports a read only where the value goes to a `string`, such as a comparison with a string or a `string` parameter. It does not report a read placed in a template string, which renders `[object Object]`, or passed to a function that accepts any value, such as `JSON.stringify` or a code generator. Search your code for these reads and check each one.

An adapter that renders these nodes into SQL renders the SQL with `renderOpaqueSql(node.expression)`, not `node.expression.text`. `renderOpaqueSql` ends text that contains `--` with a line break, so a line comment on the last line cannot comment out the rest of the statement.
