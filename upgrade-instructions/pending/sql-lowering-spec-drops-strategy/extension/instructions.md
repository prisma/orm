---
changes:
  - id: sql-lowering-spec-drops-strategy
    summary: |
      `SqlLoweringSpec` from `@internal/sql-operations` no longer has a `strategy` field.
      Remove `strategy: 'infix'` and `strategy: 'function'` from every operation descriptor's
      `lowering` object; `template` alone describes the lowering.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - "strategy: 'infix'"
        - "strategy: 'function'"
        - "strategy: \"infix\""
        - "strategy: \"function\""
---

## `sql-lowering-spec-drops-strategy`

Nothing ever read `strategy`; the template already says whether an operation lowers as an infix operator or a function call. The field is gone from `SqlLoweringSpec`, so a descriptor that still sets it fails to typecheck as an excess property. Delete the line:

```ts
// before
lowering: { targetFamily: 'sql', strategy: 'function', template: 'lower({{self}})' },
// after
lowering: { targetFamily: 'sql', template: 'lower({{self}})' },
```

The rendered SQL is unchanged.
