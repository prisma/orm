# Slice 3 round 2 fixes: findings

## B04 and G02: `fullTextIndex` does not know the model name

The decision says a full-text index with neither `name` nor `map` is named `Full-text index on "<Model>" where`. The helper cannot produce that text. `fullTextIndex(column, options)` in `packages/3-extensions/postgres/src/contract/full-text-index.ts` receives only a `ColumnRef`, which holds `kind` and `fieldName` and no model name (`packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts`, `ColumnRef`). The helper checks `where` with `requireSqlExpression` when it is called, before lowering, so the model is not known at that point.

Two ways to make it work, for Will to choose:

1. Name the field instead, as both reviewers suggested: `Full-text index on "<field>" where`. One-line change in the helper; it differs from `Index on "<Model>" where` in what it names. Recommended: it is the smallest change and still names the index's column.
2. Leave `where` unchecked in the helper when neither `name` nor `map` is given, so lowering checks it with its own owner string. The message then reads `Index on "<Model>" where`, without the words "Full-text".

I did not change B04 in the first pass. The other findings are fixed.

**Decision (coordinator, 2026-10-01): option 1.** A full-text index with neither `name` nor `map` reports `Full-text index on "<field>" where`, using the column's field name. Implemented with a test of an untyped call with a string `where` and no name or map; recorded in design section 15.3 and the error reference.
