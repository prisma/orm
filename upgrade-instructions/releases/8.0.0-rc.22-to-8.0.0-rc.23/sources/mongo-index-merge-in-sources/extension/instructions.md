---
changes:
  - id: mongo-build-refusal-index-duplicate-restored
    summary: |
      The MongoDB contract builder's `BuildRefusal` type, exported from `@prisma/orm-family-mongo/contract-ts/contract-builder`, has the kind `indexDuplicate` again. The builder no longer merges indexes; it refuses two identical indexes in one collection. To merge identical and redundant indexes before building, as Prisma 8 PSL and TypeScript do, call `mergeRedundantIndexes` from the same entry point.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bBuildRefusal\b'
        - '\bbuildMongoContractFromDefinition\b'
---

# MongoDB contract builder refuses identical indexes again

## `mongo-build-refusal-index-duplicate-restored`

Code that switches over every `refusal.kind` must handle `indexDuplicate`:

```typescript
switch (refusal.kind) {
  case 'indexDuplicate':
    return `${refusal.key.model}: an identical index already exists`;
  // ...
}
```

Code that builds a definition with `buildMongoContractFromDefinition` and relied on the builder merging indexes calls `mergeRedundantIndexes(definition, codecLookup, dataTypes)` first and builds its `definition`.
