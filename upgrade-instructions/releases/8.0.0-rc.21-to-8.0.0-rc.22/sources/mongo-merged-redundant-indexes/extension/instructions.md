---
changes:
  - id: mongo-index-lookup-key-moved
    summary: |
      `indexLookupKey`, `MONGO_INDEX_OPTION_KEYS`, `MongoIndexOptionKey` and `canonicalize` are no longer exported from `@prisma/orm-family-mongo/schema-ir`. Import them from `@prisma/orm-family-mongo/contract`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'import\s+(?:type\s+)?\{[^}]*\b(?:indexLookupKey|MONGO_INDEX_OPTION_KEYS|MongoIndexOptionKey|canonicalize)\b[^}]*\}\s*from\s*[\x27"]@prisma/orm-family-mongo/schema-ir[\x27"]'
---

# MongoDB index identity: four names moved

## `mongo-index-lookup-key-moved`

The contract builder, the planner and the verifier now identify an index by one function in the contract package. Move these names to the `contract` import:

```typescript
import { MongoSchemaIndex } from '@prisma/orm-family-mongo/schema-ir';
import { indexLookupKey } from '@prisma/orm-family-mongo/contract';
```
