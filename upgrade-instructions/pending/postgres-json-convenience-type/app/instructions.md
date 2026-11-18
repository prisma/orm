---
changes:
  - id: ts-renamed-postgres-json-column-helper
    summary: |
      The PostgreSQL column helper `jsonColumn` is renamed `plainJsonColumn`, after the explicit type it gives (`PlainJson`, a `json` column). The old name is removed. The contract does not change. SQLite's `jsonColumn` has a rename of its own.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:import|export)[ \t]+(?:type[ \t]+)?\{[^}]*(?<![\w$])jsonColumn(?![\w$])[^}]*\}[ \t]*from[ \t]*[''"](?:@prisma/orm-postgres/adapter/column-types|@prisma/orm-target-postgres/adapter/column-types|@internal/adapter-postgres/column-types)[''"]'
        - 'import[ \t]+(?:type[ \t]+)?\*[ \t]*as[ \t]+([\w$]+)[ \t]+from[ \t]*[''"](?:@prisma/orm-postgres/adapter/column-types|@prisma/orm-target-postgres/adapter/column-types|@internal/adapter-postgres/column-types)[''"][\s\S]*(?<![\w$])\1\s*\.\s*jsonColumn(?![\w$])'
  - id: psl-renamed-sql-string
    summary: |
      The SQL family's `sql.String(n)`, a `varchar(n)` column on PostgreSQL, SQLite and MySQL, is renamed `sql.Varchar(n)`. `sql.String` stays for one release line as a deprecated alias that warns with `PSL_DEPRECATED_SCALAR_NAME`. The contract does not change.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\w.])sql\s*\.\s*String\s*\('
  - id: ts-renamed-sql-string
    summary: |
      In a TypeScript contract, `type.sql.String(n)` is renamed `type.sql.Varchar(n)`. `type.sql.String` still compiles as a deprecated alias and gives the same type and contract.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])sql\s*\.\s*String\s*\('
---

# PostgreSQL's `Json` is a convenience type

On PostgreSQL, `Json` is now a convenience type, as `Int` and `String` are. Its optional `storage` argument chooses the column: `Json` and `Json(storage: json)` are a `json` column, and `Json(storage: jsonb)` is a `jsonb` column. Written bare, `Json` gives the same `json` column as before, so schemas need no change and every contract stays the same. `Jsonb` is unchanged.

The explicit type of a `json` column is named `PlainJson`, and the column helper is renamed to match it.

On every SQL target, `sql.String(n)` is renamed `sql.Varchar(n)`, with `sql.String` kept as a deprecated alias.

## `ts-renamed-postgres-json-column-helper`

The detection matches a file that imports or re-exports `jsonColumn` from `@prisma/orm-postgres/adapter/column-types`, `@prisma/orm-target-postgres/adapter/column-types` or `@internal/adapter-postgres/column-types`, or imports one of them as a namespace and reads `jsonColumn` from it. In that file, rename the import or re-export and every use of the name. Any other form, such as a dynamic import, fails type-checking because the export is gone; rename it where the compiler reports it:

```ts
import { plainJsonColumn } from '@prisma/orm-postgres/adapter/column-types';

field.column(plainJsonColumn); // was jsonColumn
```

`field.column(type.Json())` and `field.column(type.PlainJson())` give the same column. A file that imports `jsonColumn` from a SQLite package is covered by the SQLite rename, not this one.

## `psl-renamed-sql-string`

`sql.String(n)` shared a name with the `String` convenience type and meant something else: a `varchar(n)` column. It is renamed `sql.Varchar(n)`. In each matched schema, replace `sql.String(` with `sql.Varchar(`, in fields and in `types {}` aliases:

```prisma
model Label {
  id   Int             @id
  name sql.Varchar(50) // was sql.String(50)
}
```

The contract does not change. `sql.Char(n)` keeps its name.

## `ts-renamed-sql-string`

In each matched file, rename every `sql.String` call to `sql.Varchar`, including a call split across lines such as `type.sql` and `.String(64)` on the next line:

```ts
field.column(type.sql.Varchar(50)); // was type.sql.String(50)
```

The contract does not change.
