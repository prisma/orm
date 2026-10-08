# @internal/mongo-orm

MongoDB ORM client for Prisma 8.

## Responsibilities

- **ORM client factory**: `mongoOrm()` creates a typed client with root-based collection accessors; it takes the contract's enum accessors (`enums`, from `buildMongoEnums(contract, context.codecs)` in `@internal/mongo-runtime`) and refuses a written value outside a field's enum
- **Typed queries**: `findMany` with equality filters (`MongoWhereFilter`) and reference includes (`MongoIncludeSpec`)
- **Row type inference**: `InferFullRow` (scalar fields + embedded documents), `InferRootRow` (discriminated union for polymorphic roots), `IncludeResultFields`
- **Polymorphic narrowing**: Discriminator field carries literal variant values, enabling TypeScript `switch`/`if` narrowing
- **Execution interface**: Declares `MongoQueryExecutor` interface structurally satisfied by the runtime layer

## Related Docs

- [Naming model and result types](../../../../docs/reference/model-and-result-types.md)
