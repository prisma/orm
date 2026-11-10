---
changes:
  - id: mongo-validator-derivation-moves-to-mongo-contract
    summary: |
      The `FieldValueSets` type moves from `@internal/mongo-contract-psl` (`@prisma/orm-family-mongo/contract-psl`) to `@internal/mongo-contract` (`@prisma/orm-family-mongo/contract`). Extensions that author Mongo contracts through `defineContract(...)` or PSL need no change.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'import[^;]*\bFieldValueSets\b[^;]*from\s*[''"](?:@internal/mongo-contract-psl|@prisma/orm-family-mongo/contract-psl)[''"]'
  - id: mongo-derive-json-schema-replaced-by-derive-collection-validators
    summary: |
      `deriveJsonSchema` and `derivePolymorphicJsonSchema` are removed. Call `deriveCollectionValidators` from `@internal/mongo-contract` (`@prisma/orm-family-mongo/contract`) instead. It returns the validator of each collection, keyed by collection name, and it is the validator a contract emits, including embedded models and variants.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bderive(?:Polymorphic)?JsonSchema\b'
---

## `mongo-validator-derivation-moves-to-mongo-contract`

```ts
// before
import type { FieldValueSets } from '@internal/mongo-contract-psl';

// after
import type { FieldValueSets } from '@internal/mongo-contract';
```

Through the public package, import from `@prisma/orm-family-mongo/contract` instead of `@prisma/orm-family-mongo/contract-psl`.

## `mongo-derive-json-schema-replaced-by-derive-collection-validators`

`deriveJsonSchema` took the fields of one model and ignored its relations, so its validator could differ from the one a contract emits. `deriveCollectionValidators` takes the contract's models and derives the validator of every collection that stores a root model, with each variant as a `oneOf` branch.

```ts
// before
import { deriveJsonSchema } from '@internal/mongo-contract-psl';

const validator = deriveJsonSchema(
  ns.models['Account'].fields,
  { codecLookup, dataTypeLookup },
  ns.valueObjects,
  valueSets,
);

// after
import { deriveCollectionValidators } from '@internal/mongo-contract';

const validator = deriveCollectionValidators({
  models: ns.models,
  lookups: { codecLookup, dataTypeLookup },
  valueObjects: ns.valueObjects ?? {},
  valueSets,
})['accounts'];
```

`ns` is `contract.domain.namespaces[namespaceId]`, and `valueSets` is the storage namespace's `entries.valueSet`, as before. A call to `derivePolymorphicJsonSchema` becomes the same call: the validator of a root model with variants already has one `oneOf` branch per variant.
