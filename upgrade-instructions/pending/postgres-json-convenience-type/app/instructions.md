---
changes:
  - id: psl-postgres-json-stores-jsonb
    summary: |
      In a Prisma 8 schema on PostgreSQL, `Json` is now a convenience type that stores `jsonb` by default. A field written bare `Json`, `Json?` or `Json[]`, or a `types {}` alias `= Json`, changes from a `json` column to a `jsonb` column. To keep `json`, write `Json(storage: json)` or `PlainJson`. To move to `jsonb`, re-emit and migrate, and answer the data-loss question the migration asks. A Prisma 7 schema, which has a `datasource` block, is not affected.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?![\s\S]*(?<![\w$])datasource[ \t]+\w+[ \t]*\{)[\s\S]*\n[ \t]+[A-Za-z_]\w*[ \t]+(?:=[ \t]*)?Json(?![\w$(])'
  - id: ts-postgres-json-stores-jsonb
    summary: |
      In a TypeScript contract on PostgreSQL, `type.Json()` and `type.Json({})` now give a `jsonb` column (`Jsonb`) instead of a `json` column. To keep `json`, write `type.Json({ storage: 'json' })` or `type.PlainJson()`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])type\.Json\(\s*(?:\{\s*\}\s*)?\)'
  - id: ts-renamed-postgres-json-column-helper
    summary: |
      The PostgreSQL column helper `jsonColumn` is renamed to `plainJsonColumn`, after the explicit type it gives (`PlainJson`). The old name is removed. The contract does not change.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'import[ \t]+(?:type[ \t]+)?\{[^}]*(?<![\w$])jsonColumn(?![\w$])[^}]*\}[ \t]*from[ \t]*[''"](?:@prisma/orm-postgres/adapter/column-types|@prisma/orm-target-postgres/adapter/column-types|@internal/adapter-postgres/column-types)[''"]'
---

# PostgreSQL's `Json` stores `jsonb` by default

On PostgreSQL, `Json` is now a convenience type, as `String` and `Bytes` are. Its optional `storage` argument chooses the column: `jsonb`, the default, gives `Jsonb`, and `json` gives `PlainJson`, the explicit type for a plain `json` column. Before this change, `Json` was the explicit type for a `json` column.

So a field written `Json` changes from `json` to `jsonb`. `Jsonb` keeps its name and is not affected. Nothing warns: `prisma contract emit` writes a new storage hash, and `prisma db verify` reports the column.

## `psl-postgres-json-stores-jsonb`

For each field or `types {}` alias the detection finds, choose one of two paths.

**Keep `json`.** Write `Json(storage: json)`, or the explicit type `PlainJson`, keeping the field's other arguments and attributes. The contract does not change.

```prisma
model Event {
  payload Json(storage: json)  // was Json
  extra   Json(storage: json)? // was Json?
}

types {
  Payload = Json(storage: json) // was Json
}
```

**Move to `jsonb`.** Keep `Json`, re-emit the contract with `prisma contract emit`, then plan the migration. `jsonb` is PostgreSQL's usual JSON type: it can be indexed and compared. The change is not a safe widening, so `prisma migration plan` and `prisma db update` ask before they alter the column:

```text
accept lossy type change of field "Event.payload"
```

Answer `--delete Event.payload` to accept the in-place change, which runs `ALTER COLUMN "payload" TYPE jsonb USING "payload"::jsonb`. On `prisma migration plan`, `--convert Event.payload` instead writes a conversion for you to fill in. The change can lose information or fail:

- `jsonb` drops duplicate keys in an object, keeping the last, and does not keep whitespace or key order.
- `jsonb` refuses the `\u0000` escape, which `json` accepts, so the change fails on a row that holds one.
- PostgreSQL refuses to change the type of a column that a view depends on. Drop the view first and create it again afterwards.

Choose `jsonb` only if the application does not depend on duplicate keys or key order. Rewrite only Prisma 8 schemas whose config uses the PostgreSQL target.

**A `contract.prisma` copy in a migration folder always keeps `json`,** whichever path the current schema takes. The copy records the schema of a migration planned before this change, when `Json` meant `json`, so write `Json(storage: json)` there. The Prisma CLI does not read these copies when it plans or applies migrations, so a copy left as bare `Json` breaks nothing at once. But it no longer describes its migration: emitting it gives a `jsonb` column and a storage hash that differs from the one the migration recorded.

The detection cannot tell which target a schema is for, so it also matches SQLite's and MongoDB's `Json`, which do not change; a match in a project whose `prisma.config.ts` uses the SQLite or MongoDB target needs no change.

## `ts-postgres-json-stores-jsonb`

The same change, in a TypeScript contract on PostgreSQL. To keep `json`:

```ts
field.column(type.Json({ storage: 'json' })); // was type.Json()
field.column(type.PlainJson()); // the same type
```

To move to `jsonb`, keep `type.Json()`, re-emit and migrate as above. The detection also matches SQLite's `type.Json()`, which does not change.

## `ts-renamed-postgres-json-column-helper`

The detection matches a file that imports `jsonColumn` from `@prisma/orm-postgres/adapter/column-types`, `@prisma/orm-target-postgres/adapter/column-types` or `@internal/adapter-postgres/column-types`. In that file, rename the import and every use of the imported name:

```ts
import { plainJsonColumn } from '@prisma/orm-postgres/adapter/column-types';

field.column(plainJsonColumn); // was jsonColumn
```

`jsonbColumn` keeps its name. SQLite's `jsonColumn` is not renamed.
