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

This supersedes the codes named in the `data-types-column-defaults` app instructions of the upgrade from 8.0.0-rc.11 to 8.0.0-rc.12: where they name `PSL_DEFAULT_TYPE_INCOMPATIBLE` for a value a column's type has no cast from, or `PSL_INVALID_JSON_LITERAL`, read the new codes above.
