---
changes:
  - id: render-full-text-index-document-takes-a-definition
    summary: |
      `renderFullTextIndexExpression` from `@internal/target-postgres/sql-utils` is now `renderFullTextIndexDocument`, and it takes the index definition `{ weightGroups, language }` instead of a language and one column name.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\brenderFullTextIndexExpression\b'
  - id: full-text-indexable-codec-check-replaced
    summary: |
      `isFullTextIndexableCodec` is no longer exported from `@internal/target-postgres/sql-utils`. Check a full-text index with `fullTextIndexProblems`, or read a codec's traits with `postgresCodecTraitsOf`, both from `@internal/target-postgres/full-text-index-authoring`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bisFullTextIndexableCodec\b'
  - id: structured-index-option-values-hash-as-json
    summary: |
      An index option whose value is an array or an object now enters the index name's hash as JSON rather than through `String()`. A wire-named index with such an option gets a new name; re-emit contracts that declare one.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'constraints\.index\([\s\S]*options:\s*\{[^}]*[\[{]'
---

# A full-text index is stored as data

## `render-full-text-index-document-takes-a-definition`

The renderer now draws the whole search document of a full-text index, which may cover several columns in weight groups, and is named for it. Import `renderFullTextIndexDocument` instead and pass the definition the contract stores in the index's `options`:

```diff
-import { renderFullTextIndexExpression } from '@internal/target-postgres/sql-utils';
+import { renderFullTextIndexDocument } from '@internal/target-postgres/sql-utils';

-renderFullTextIndexExpression('english', 'body')
+renderFullTextIndexDocument({ weightGroups: [['body']], language: 'english' })
```

One field renders exactly what it rendered before, `to_tsvector('english', "body")`. A document of several columns wraps every column in `coalesce(column, '')`. A definition that breaks a rule of a full-text index (no group, more than four groups, an empty group, or a column named twice) is refused with `CONTRACT.INDEX_INVALID`.

A Postgres full-text index in a contract is now an index of type `fullText`, registered in the Postgres index type registry, with `columns` and `options: { weightGroups, language }`, not an expression. `columns` is exactly `weightGroups.flat()`; a contract where they differ is refused with `CONTRACT.INDEX_INVALID` when it is loaded, as is a full-text index over a column whose codec Postgres does not know to be `textual`. Code that reads indexes from a contract recognises a full-text index by `type === 'fullText'` (exported as `FULL_TEXT_INDEX_TYPE` from `@internal/target-postgres/full-text-index-authoring`), and must not treat its `columns` as a plain index over those columns. In the database it is a `gin` index over the rendered document: the `fullText` entry of the Postgres index type registry declares `accessMethod: 'gin'`.

## `full-text-indexable-codec-check-replaced`

The rules of a full-text index, including that it covers text columns only, are now one function. Call it instead of testing each codec:

```diff
-import { isFullTextIndexableCodec } from '@internal/target-postgres/sql-utils';
+import {
+  fullTextIndexProblems,
+  postgresCodecTraitsOf,
+} from '@internal/target-postgres/full-text-index-authoring';

-if (!isFullTextIndexableCodec(codecId)) refuse();
+const problems = fullTextIndexProblems({
+  weightGroups: [[columnName]],
+  codecs: { codecIdOf: () => codecId, traitsOf: postgresCodecTraitsOf },
+});
+if (problems.length > 0) refuse();
```

To test one codec alone, `postgresCodecTraitsOf(codecId)?.includes('textual') === true` is what `isFullTextIndexableCodec(codecId)` returned.

## `structured-index-option-values-hash-as-json`

`normalizeIndexOptionValue` from `@internal/sql-schema-ir/naming` writes an array or object value as JSON, with object keys sorted at every depth, so `[['a', 'b']]` and `[['a'], ['b']]` no longer hash to the same index name and the order in which an object's keys were written does not change it. Scalar values hash as before. If an extension's contract declares a wire-named index whose options hold an array or an object, rebuild its contract space so the emitted index name and storage hash move together.
