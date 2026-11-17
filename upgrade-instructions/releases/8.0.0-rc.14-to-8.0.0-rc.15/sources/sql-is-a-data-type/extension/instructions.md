---
changes:
  - id: prefixed-sql-tags-are-removed
    summary: |
      The tags `pg.sql` and `sqlite.sql` are removed. Write `sql`.
    detection:
      glob: "**/*.{prisma,ts}"
      matches:
        - '(?<![\w./-])(pg|sqlite)\s*\.\s*sql\s*\\?[\x60"'']'
  - id: default-diagnostic-codes-changed
    summary: |
      Four PSL diagnostic codes for written values changed: `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` is now `PSL_UNKNOWN_LITERAL_TAG`, `PSL_INVALID_JSON_LITERAL` is now `PSL_INVALID_LITERAL`, `PSL_DEFAULT_TYPE_INCOMPATIBLE` is now `PSL_VALUE_TYPE_INCOMPATIBLE`, or `PSL_DEFAULT_LIST_EXPECTED` for a single value on a list column, and most cases of `PSL_INVALID_DEFAULT_LITERAL` moved to `PSL_INVALID_LITERAL`.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs}"
      matches:
        - '\bPSL_INVALID_JSON_LITERAL\b'
        - '\bPSL_UNKNOWN_DEFAULT_LITERAL_TAG\b'
        - '\bPSL_DEFAULT_TYPE_INCOMPATIBLE\b'
        - '\bPSL_INVALID_DEFAULT_LITERAL\b'
  - id: the-sql-tag-writes-the-sql-expression-data-type
    summary: |
      Lowering entries are removed. Every entry in `authoring.dataTypes` is a `DataTypeAuthoringEntry`
      keyed by a registered data type id, and `sql` is the tag of the data type `sql/expression`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(loweringEntryKey|isLoweringEntryKey|isDataTypeLoweringEntry)\b'
        - '\b(AuthoringDataTypeEntry|DataTypeLoweringAuthoringEntry|TaggedLiteralValue)\b'
        - '\bsqlDefaultLiteralTagEntry\b'
        - '\bcreate(Postgres|Sqlite)DataTypeEntries\b'
        - '\bPSL_INVALID_DEFAULT_SQL\b'
---

# `sql` is the tag of a data type

## The prefixed `sql` tags are removed

`pg.sql` and `sqlite.sql` were second names for the `sql` tag. They are removed, and a schema that uses one is refused with `PSL_UNKNOWN_LITERAL_TAG`: `Unknown literal tag "pg.sql". Known tags: sql, json.`

Replace the tag with `sql` and leave the text unchanged:

```diff
- createdAt DateTime @default(pg.sql`(now() + interval '1 hour')`)
+ createdAt DateTime @default(sql`(now() + interval '1 hour')`)
```

The stored default does not change, so no migration follows.

## Diagnostic codes for written values changed

This matters only to code that reads PSL diagnostic codes, such as a test that asserts one. The messages did not change, except for a `sql` literal inside a list literal and the list of known tags, both described below the table.

| Refusal | Old code | New code |
| --- | --- | --- |
| A tag no pack registered | `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` | `PSL_UNKNOWN_LITERAL_TAG` |
| A `json` literal whose text is not a JSON document | `PSL_INVALID_JSON_LITERAL` | `PSL_INVALID_LITERAL` |
| Text an authoring entry or a cast refused | `PSL_INVALID_DEFAULT_LITERAL` | `PSL_INVALID_LITERAL` |
| A value whose type the column's type has no cast from, including a list written on a column that holds one value | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `PSL_VALUE_TYPE_INCOMPATIBLE` |
| A written form the target has no data type for | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `PSL_VALUE_TYPE_INCOMPATIBLE` |
| A single value on a list column | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `PSL_DEFAULT_LIST_EXPECTED` |
| A value the column's codec refused | `PSL_INVALID_DEFAULT_LITERAL` | unchanged |
| A `sql` literal inside a list literal | `PSL_INVALID_DEFAULT_LITERAL`, at the element | `PSL_VALUE_TYPE_INCOMPATIBLE`, at the `@default` attribute |

`PSL_INVALID_JSON_LITERAL` no longer exists.

The unknown-tag message lists the known tags in the order the stack registers them. The SQL family registers `sql` before the target registers `json`, so a Postgres or SQLite stack lists `sql, json`, where it used to list `json, sql, pg.sql` or `json, sql, sqlite.sql`. The completion list and the `Expected one of` message of `@default` offer `sql` before `json` for the same reason.

A `sql` literal inside a list literal used to report `Literal tag "sql" produces a default of its own and cannot be an element of a list literal.` It is now refused by the cast rule, like any other value the column's type does not take: `Field "Post.tags" at element 1: pg/text has no cast from sql/expression; it casts from nothing`. Write the whole list as one `sql` literal instead, as in `` @default(sql`'{}'::text[]`) ``.

This supersedes the statement in the `data-types-column-defaults` extension instructions of the upgrade from 8.0.0-rc.11 to 8.0.0-rc.12 that a cast's refusal surfaces as `PSL_INVALID_DEFAULT_LITERAL`. It surfaces as `PSL_INVALID_LITERAL`.

## Lowering entries are removed

This supersedes the section about lowering entries in the `data-types-column-defaults` extension instructions of the upgrade from 8.0.0-rc.11 to 8.0.0-rc.12.

`sql` used to be a tag that named no data type and lowered its own body. It is now the tag of the data type `sql/expression`, which the SQL family defines and registers. The second kind of authoring entry is gone.

| Removed | Replacement |
| --- | --- |
| `AuthoringDataTypeEntry` | `DataTypeAuthoringEntry`, from `@internal/framework-components/authoring` |
| `DataTypeLoweringAuthoringEntry`, `loweringEntryKey`, `isLoweringEntryKey`, `isDataTypeLoweringEntry` | None. Remove the branch that told the two kinds of entry apart |
| `TaggedLiteralValue` from `@internal/framework-components/control` | None |
| `sqlDefaultLiteralTagEntry` from `@internal/family-sql/control` | Nothing to register. The SQL family descriptor registers `sqlExpressionAuthoringEntry` from `@internal/sql-contract/sql-expression` under `SQL_EXPRESSION_DATA_TYPE_ID` |
| `PSL_INVALID_DEFAULT_SQL` from `@internal/family-sql/control` | The string `'PSL_INVALID_DEFAULT_SQL'`. The code itself is unchanged |
| `createPostgresDataTypeEntries`, `createSqliteDataTypeEntries` in the adapters | `postgresDataTypeEntries()` from `@internal/target-postgres/data-types`, `sqliteDataTypeEntries()` from `@internal/target-sqlite/data-types` |

Every key of `authoring.dataTypes` must now be the id of a data type that a component in the stack registers. A key such as `lowering:sql` fails assembly with `CONTRACT.DATA_TYPE_UNREGISTERED`.

The SQL family registers `sql/expression` and its entry itself. A target or an extension does not register it, and a target that registered it too fails assembly with `CONTRACT.DATA_TYPE_ENTRY_DUPLICATE` (or `CONTRACT.DATA_TYPE_DUPLICATE` if it registers only the type). Remove both from the target. No component's data types may declare a cast or a list cast from `sql/expression`. The SQL family refuses a stack that has one with `CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION` when it creates its control instance.

Two types exported from `@internal/sql-contract-psl/resolution` changed:

- The `WrittenValue` tag arm names its text `text`, not `body`.
- The `unreadable` arm of `DefaultRefusal` has no `json` field. A JSON text that is not a JSON document is an ordinary `unreadable` refusal.
