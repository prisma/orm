---
changes:
  - id: preserve-grouped-orm-pagination-expressions
    summary: Preserve expression-valued limit and offset when consuming ORM GroupPagingState.
---

## `preserve-grouped-orm-pagination-expressions`

Update extension code that reads or mirrors ORM `GroupPagingState.limit` and `offset`: these fields now contain relational-core `LimitOffsetValue | undefined` (`number | AnyExpression | undefined`), not just numbers. Forward them unchanged to the existing `SelectAst.withLimit` and `withOffset` methods. If processing numeric literals separately, narrow with `typeof value === 'number'`; preserve expression nodes rather than coercing, serializing or boxing them as literal parameters. Test presence against `undefined`, not truthiness, so zero limits and offsets survive. Keep grouped post-aggregation paging separate from pre-group collection paging, preserving expression operands at both stages. This extends the existing collection-pagination migration to grouped pagination; do not keep grouped paging numeric-only.
