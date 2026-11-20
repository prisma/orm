---
changes:
  - id: postgres-search-condition-is-nullable-over-one-nullable-column
    summary: |
      In the SQL builder, `fns.fullTextMatches` over a full-text index of one nullable column, or over `fullTextDocument([column])` of one nullable column, now has the type `boolean | null` when it is selected, because Postgres returns `NULL` for a row where the column is `NULL`. Before, it was typed `boolean`. A document or index of two or more columns is still `boolean`, since each column is wrapped in `coalesce`. Code that assigns such a selected value to a `boolean` must handle `null`. Conditions in `where` are not affected.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - 'fullTextMatches\('
---

# A full-text search over one nullable column can be null

## `postgres-search-condition-is-nullable-over-one-nullable-column`

When a query selects the result of `fullTextMatches` and the search document is one nullable column, the selected value is now typed `boolean | null`:

```ts
const plan = db.public.documents
  .select('matches', (f, fns) =>
    fns.fullTextMatches(fullTextDocument([f.subtitle]), fns.websearchToTsquery('zebra')),
  )
  .build();
// matches: boolean | null
```

This also holds when the document is a full-text index declared over one nullable column. Postgres returns `NULL` for the rows where that column is `NULL`, so the value was already `null` at run time; only the type changes. Where code passes the value on as a `boolean`, decide what a missing column means, for example `row.matches ?? false`.

A document or index of two or more columns keeps the type `boolean`. Using the result as a condition, in `where` or in `fns.and`, is unchanged.
