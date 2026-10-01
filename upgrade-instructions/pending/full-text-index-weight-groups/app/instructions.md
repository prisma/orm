---
changes:
  - id: re-emit-contracts-with-a-full-text-index
    summary: |
      A full-text index is stored in `contract.json` as data: an index of type `fullText` over its columns whose `options` hold the weight groups and the language, with no `expression`. Its storage hash and its index name change. Re-emit the contract and plan a migration, which renames the index; `db update` instead drops and rebuilds it.
    detection:
      glob: "**/*.{prisma,ts,mts}"
      matches:
        - '@@fullTextIndex\s*\('
        - '(?<![\w$.])fullTextIndex\s*\('
  - id: full-text-index-one-field-diagnostic-removed
    summary: |
      `@@fullTextIndex` now takes several fields, so the diagnostic `PSL_FULL_TEXT_INDEX_ONE_FIELD` is gone. Code that asserts it asserts a diagnostic that is never raised.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs}"
      matches:
        - '\bPSL_FULL_TEXT_INDEX_ONE_FIELD\b'
---

# A full-text index is stored as data

## `re-emit-contracts-with-a-full-text-index`

`@@fullTextIndex` and the TypeScript `fullTextIndex` helper used to store a SQL expression in the contract. They now store the index's definition as an index of type `fullText`, and the SQL is rendered from it when the index is created and when a query searches it. The database index is still a `gin` index over the same expression. For `@@fullTextIndex([title], name: "post_title_search")` the emitted index changes like this:

```diff
 {
-  "expression": "to_tsvector('english', \"title\")",
-  "name": "post_title_search_724b05e5",
+  "columns": ["title"],
+  "name": "post_title_search_1c180f5a",
+  "options": { "fields": [["title"]], "language": "english" },
   "prefix": "post_title_search",
-  "type": "gin",
+  "type": "fullText",
   "unique": false
 }
```

The schema source does not change. The index's name ends in a hash of its contract entry, so the name changes, and the database needs one rename. Do this:

1. Run `prisma contract emit` and commit the regenerated `contract.json` and `contract.d.ts`. The storage hash changes. Do not hand-edit the generated files.
2. Run `prisma migration plan` and apply the migration as usual. Planned from the previous contract, it renames each full-text index: `ALTER INDEX "post_title_search_724b05e5" RENAME TO "post_title_search_1c180f5a"`. A rename is instant and keeps the index.

Do not use `prisma db update` for this step if a full-text index is large. `db update` compares the contract with the live database, where Postgres prints the expression in its own form, so it cannot tell that the old index is the new one under another name. It drops the index and builds it again. For the index above it plans:

```
├─ ⚠ Drop index "post_title_search_724b05e5"
└─ Create index "post_title_search_1c180f5a" on "post"

DROP INDEX "public"."post_title_search_724b05e5";
CREATE INDEX "post_title_search_1c180f5a" ON "public"."post" USING "gin" (to_tsvector('english', "title"));
```

Building a GIN index reads the whole table. If you must use `db update`, rename each index by hand first, with the old name from the database and the new one from the re-emitted contract (`ALTER INDEX "post_title_search_724b05e5" RENAME TO "post_title_search_1c180f5a"`). `db update` then has nothing to do for it.

Until the rename, `prisma db verify` reports the new index name as missing. With `--strict` it also reports the old name as an extra index.

If code reads a full-text index's `expression` from the contract, recognise the index by `type: "fullText"` and read `options.fields` and `options.language` instead. `fields` lists the weight groups, each a list of storage column names, and `columns` is the same columns in the same order. The search document is no longer stored anywhere in the contract.

An index declared with `map:` keeps its exact name, so neither the name nor the database changes. Only the storage hash moves. `db verify` compares a `map:` index's expression with the text Postgres prints for it, character for character, so it reports a `map:` full-text index as changed, as it did before.

A full-text index can now cover several fields, each top-level item a weight group, strongest first. This is optional:

```prisma
@@fullTextIndex([[title, subtitle], body], name: "post_search")
```

In an index of several fields, every column is wrapped in `coalesce(column, '')`, so the index does not change when a column becomes optional or required. To search it, pass the same groups to `fns.fullTextMatches` and `fns.fullTextRank` in the SQL builder: `fns.fullTextMatches([[f.title, f.subtitle], [f.body]], q)`.

## `full-text-index-one-field-diagnostic-removed`

`@@fullTextIndex([a, b])` was refused with `PSL_FULL_TEXT_INDEX_ONE_FIELD`. It is now a valid index with two weight groups, and that code is never raised. Remove assertions on it. The new refusals are `PSL_FULL_TEXT_INDEX_TOO_MANY_GROUPS` (more than four groups), `PSL_FULL_TEXT_INDEX_EMPTY_GROUP` (an empty group or no fields) and `PSL_FULL_TEXT_INDEX_DUPLICATE_FIELD` (a field named twice). `PSL_FULL_TEXT_INDEX_TEXT_FIELD`, `PSL_FULL_TEXT_INDEX_REQUIRES_NAME` and `PSL_FULL_TEXT_INDEX_NAME_XOR_MAP` are unchanged.
