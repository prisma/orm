# @internal/mongo-contract-psl

PSL-to-Mongo contract interpreter for Prisma Next. Transforms Prisma Schema Language (`.prisma`) files into Mongo `Contract`, enabling contract-first development with MongoDB.

## Responsibilities

- **PSL interpretation**: `interpretPslDocumentToMongoContract()` maps a parsed PSL document to a Mongo `Contract` — scalar types, collection/field naming, `@id`/`@map`/`@@map` attributes, and N:1/1:N reference relations with backrelation disambiguation
- **Attribute registry**: `mongoAttributeSpecs` registers every Mongo built-in (`@@map`, `@@discriminator`, `@@base`, `@@index`, `@@unique`, `@@textIndex`, `@id`, `@unique`, `@map`, `@relation`) as spec factories over the uniform `AttributeSpecContext`; the family descriptor contributes it under `authoring.attributeSpecs`, and the interpreter sources every spec from it
- **Scalar type mapping**: `createMongoScalarTypeDescriptors()` provides the default PSL-type → Mongo codec ID mapping (e.g. `String` → `mongo/string@1`, `ObjectId` → `mongo/objectId@1`)
- **Contract provider**: `mongoContract()` (exported from `./provider`) integrates with the CLI's `prisma contract emit` command, reading a `.prisma` schema file and producing a `ContractConfig`
- **Diagnostics**: Emits structured diagnostics for unsupported field types (`PSL_UNSUPPORTED_FIELD_TYPE`), missing `@id` fields (`PSL_MISSING_ID_FIELD`), orphaned backrelations (`PSL_ORPHANED_BACKRELATION`), ambiguous backrelations (`PSL_AMBIGUOUS_BACKRELATION`), and attribute names outside the registered namespace (`PSL_UNSUPPORTED_MODEL_ATTRIBUTE`, `PSL_UNSUPPORTED_FIELD_ATTRIBUTE`)

## Known limitations

- **Per-index `collation`**: PSL authoring does not support the `collation` index option. Users requiring per-index collation must use the TypeScript contract builder (`@internal/mongo-contract-ts`).
- **`partialFilterExpression` / `wildcardProjection`**: These object-valued index options are not supported in PSL and require the TypeScript contract builder.
