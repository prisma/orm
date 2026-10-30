---
changes:
  - id: mongo-build-refusal-index-duplicate-removed
    summary: |
      The MongoDB contract builder's `BuildRefusal` type, exported from `@prisma/orm-family-mongo/contract-ts/contract-builder`, no longer has the kind `indexDuplicate`. The builder now merges identical and redundant indexes instead of refusing them. Remove any `case 'indexDuplicate'` and any other code that reads that kind.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bindexDuplicate\b'
  - id: mongo-index-lookup-key-moved
    summary: |
      `indexLookupKey`, `MONGO_INDEX_OPTION_KEYS`, `MongoIndexOptionKey` and `canonicalize` are no longer exported from `@prisma/orm-family-mongo/schema-ir`. Import them from `@prisma/orm-family-mongo/contract`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'import\s+(?:type\s+)?\{[^}]*\b(?:indexLookupKey|MONGO_INDEX_OPTION_KEYS|MongoIndexOptionKey|canonicalize)\b[^}]*\}\s*from\s*[\x27"]@prisma/orm-family-mongo/schema-ir[\x27"]'
---

# MongoDB index identity: one refusal gone, four names moved

## `mongo-build-refusal-index-duplicate-removed`

Code that switches over `refusal.kind` no longer compiles while it names `indexDuplicate`. Delete that case:

```typescript
switch (refusal.kind) {
  case 'indexShape':
    return describeShape(refusal);
  // remove: case 'indexDuplicate': ...
}
```

## `mongo-index-lookup-key-moved`

The contract builder, the planner and the verifier now identify an index by one function in the contract package. Move these names to the `contract` import:

```typescript
import { MongoSchemaIndex } from '@prisma/orm-family-mongo/schema-ir';
import { indexLookupKey } from '@prisma/orm-family-mongo/contract';
```
