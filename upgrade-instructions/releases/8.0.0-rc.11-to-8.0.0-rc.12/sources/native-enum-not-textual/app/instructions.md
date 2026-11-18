---
changes:
  - id: native-enum-columns-have-no-text-operations
    summary: |
      A native Postgres enum column (`pg.enum(...)`) no longer offers `like`, `ilike`,
      `fullTextMatches`, `fullTextRank` or `fullTextHeadline`, is no longer accepted as the text of
      a tsquery parser, and cannot carry `@@fullTextIndex` or `fullTextIndex`. These calls used to
      compile and then fail in Postgres. Now they fail to compile.
---

## `native-enum-columns-have-no-text-operations`

Postgres has no `LIKE`, `ILIKE` or `to_tsvector` for an enum type. Every one of these calls on a native enum column failed when the query ran, with `operator does not exist` or `function ... does not exist`. A `@@fullTextIndex` on a native enum column failed when the migration ran. So code that uses them never worked. It is now a type error, and `@@fullTextIndex` / `fullTextIndex` on a native enum column is refused when the contract is built (`PSL_FULL_TEXT_INDEX_TEXT_FIELD` in PSL, `CONTRACT.INDEX_INVALID` in TypeScript).

Replace a pattern match on an enum with an equality check on its members:

```ts
// before: failed at runtime
db.orm.public.Ticket.where((t) => t.status.ilike('open%'));
// after
db.orm.public.Ticket.where((t) => t.status.in(['open', 'reopened']));
```

Remove any `@@fullTextIndex` or `fullTextIndex` on a native enum column. If you really need a pattern search over the enum labels, write that query through the raw SQL lane (``db.raw.sql`…` ``) and cast the column to text there, for example `status::text ILIKE $1`.

Nothing else about native enum columns changes: `eq`, `in`, ordering, and `min`/`max` work as before. A PSL `enum` block stored as text (`@@type("pg/text@1")`) is a text column and keeps every text operation.
