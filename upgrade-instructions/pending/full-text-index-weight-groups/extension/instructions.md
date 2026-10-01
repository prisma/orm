---
changes:
  - id: render-full-text-index-expression-takes-a-definition
    summary: |
      `renderFullTextIndexExpression` from `@internal/target-postgres/sql-utils` takes the index definition `{ fields, language }` instead of a language and one column name.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\brenderFullTextIndexExpression\s*\('
  - id: structured-index-option-values-hash-as-json
    summary: |
      An index option whose value is an array or an object now enters the index name's hash as JSON rather than through `String()`. A wire-named index with such an option gets a new name; re-emit contracts that declare one.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'constraints\.index\([\s\S]*options:\s*\{[^}]*[\[{]'
---

# A full-text index is stored as data

## `render-full-text-index-expression-takes-a-definition`

The renderer now draws the whole search document of a full-text index, which may cover several columns in weight groups. Pass the definition the contract stores in the index's `options`:

```diff
-renderFullTextIndexExpression('english', 'body')
+renderFullTextIndexExpression({ fields: [['body']], language: 'english' })
```

One field renders exactly what it rendered before, `to_tsvector('english', "body")`. A document of several columns wraps every column in `coalesce(column, '')`.

A Postgres full-text index in a contract is now an index of type `fullText`, registered in the Postgres index type registry, with `columns` and `options: { fields, language }`, not an expression. `columns` is exactly `fields.flat()`; a contract where they differ is refused with `CONTRACT.INDEX_INVALID`. Code that reads indexes from a contract recognises a full-text index by `type === 'fullText'` (exported as `FULL_TEXT_INDEX_TYPE` from `@internal/target-postgres/sql-utils`), and must not treat its `columns` as a plain index over those columns. In the database it is a `gin` index over the rendered document.

## `structured-index-option-values-hash-as-json`

`normalizeIndexOptionValue` from `@internal/sql-schema-ir/naming` writes an array or object value as JSON, so `[['a', 'b']]` and `[['a'], ['b']]` no longer hash to the same index name. Scalar values hash as before. If an extension's contract declares a wire-named index whose options hold an array or an object, rebuild its contract space so the emitted index name and storage hash move together.
