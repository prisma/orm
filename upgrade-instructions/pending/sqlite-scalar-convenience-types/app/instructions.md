---
changes:
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

On SQLite, `Int`, `BigInt`, `Float`, `String`, `Bytes` and `Json` are now convenience types, as on PostgreSQL and MongoDB. Each chooses one explicit type named after the SQLite column type that stores it: `Int` is `IntegerNumber`, `BigInt` is `IntegerBigInt`, `BigInt(as: number)` is `IntegerNumber`, `Float` is `Real`, `String` is `Text`, `Bytes` is `Blob` and `Json` is `PlainJson`. Written bare, each gives the same codec as before, so schemas need no change and every contract stays the same.

The column helpers of the TypeScript contract builder are renamed after the explicit type each gives.

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

Any other form, such as a dynamic import, fails type-checking because the export is gone; rename it where the compiler reports it. `field.column(type.Int())` and `field.column(type.IntegerNumber())` give the same column. A file that imports `jsonColumn` from a PostgreSQL package is covered by the PostgreSQL rename, not this one. `textColumn`, `realColumn` and `blobColumn` keep their names.
