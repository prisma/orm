---
changes:
  - id: ts-renamed-postgres-json-column-helper
    summary: |
      The PostgreSQL column helper `jsonColumn` is renamed `plainJsonColumn`, after the explicit type it gives (`PlainJson`, a `json` column). The old name is removed. The contract does not change. SQLite's `jsonColumn` is not renamed.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'import[ \t]+(?:type[ \t]+)?\{[^}]*(?<![\w$])jsonColumn(?![\w$])[^}]*\}[ \t]*from[ \t]*[''"](?:@prisma/orm-postgres/adapter/column-types|@prisma/orm-target-postgres/adapter/column-types|@internal/adapter-postgres/column-types)[''"]'
---

# PostgreSQL's `Json` is a convenience type

On PostgreSQL, `Json` is now a convenience type, as `Int` and `String` are. Its optional `storage` argument chooses the column: `Json` and `Json(storage: json)` are a `json` column, and `Json(storage: jsonb)` is a `jsonb` column. Written bare, `Json` gives the same `json` column as before, so schemas need no change and every contract stays the same. `Jsonb` is unchanged.

The explicit type of a `json` column is named `PlainJson`, and the column helper is renamed to match it.

## `ts-renamed-postgres-json-column-helper`

The detection matches a file that imports `jsonColumn` from `@prisma/orm-postgres/adapter/column-types`, `@prisma/orm-target-postgres/adapter/column-types` or `@internal/adapter-postgres/column-types`. In that file, rename the import and every use of the imported name:

```ts
import { plainJsonColumn } from '@prisma/orm-postgres/adapter/column-types';

field.column(plainJsonColumn); // was jsonColumn
```

`field.column(type.Json())` and `field.column(type.PlainJson())` give the same column. A file that imports `jsonColumn` from a SQLite package needs no change.
