---
changes:
  - id: mongo-contract-input
    summary: |
      The MongoDB type for the object you pass to `defineContract`, `ContractDefinition`, is renamed `ContractInput`. It is the same type under SQL's name for it. `ContractDefinition` now names the plain-data definition every MongoDB contract source builds from, which takes no type parameters, so the detection flags an import from `@prisma/orm-family-mongo/contract-ts` only where the file writes `ContractDefinition<...>`. Import `ContractInput` from `@prisma/orm-mongo/contract-builder` or `@prisma/orm-family-mongo/contract-ts/contract-builder` where you imported `ContractDefinition`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:import|export)\s+(?:type\s+)?\{[^}]*\bContractDefinition\b[^}]*\}\s*from\s*[\x27"]@prisma/orm-mongo/contract-builder[\x27"]'
        - '(?:import|export)\s+(?:type\s+)?\{[^}]*\bContractDefinition\b[^}]*\}\s*from\s*[\x27"]@prisma/orm-family-mongo/contract-ts(?:/contract-builder)?[\x27"][\s\S]*\bContractDefinition<'
  - id: mongo-model-definition-removed
    summary: |
      `MongoModelDefinition` is removed. It was another name for `ContractModel<MongoModelStorage>`. Write `ContractModel<MongoModelStorage>` instead, with `ContractModel` from `@prisma/orm-framework/contract/types` and `MongoModelStorage` from `@prisma/orm-family-mongo/contract`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])MongoModelDefinition(?![\w$])'
---

# MongoDB contract types take SQL's names

Two MongoDB type names change so that they match SQL's. The types themselves do not change.

## `mongo-contract-input`

The type of the object you pass to `defineContract` is now `ContractInput`, as it is in SQL. Rename the import and each use:

```typescript
import type { ContractInput } from '@prisma/orm-family-mongo/contract-ts/contract-builder';
```

## `mongo-model-definition-removed`

`MongoModelDefinition` was an alias for a model of a built contract. SQL has no such alias. Write the type it stood for:

```typescript
import type { ContractModel } from '@prisma/orm-framework/contract/types';
import type { MongoModelStorage } from '@prisma/orm-family-mongo/contract';

function collectionOf(model: ContractModel<MongoModelStorage>): string | undefined {
  return model.storage.collection;
}
```
