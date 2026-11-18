# @internal/mongo-orm

MongoDB ORM client for Prisma 8.

## Responsibilities

- **ORM client factory**: `mongoOrm({ context, runtime })` creates a typed client with root-based collection accessors, as the SQL `orm({ context, runtime })` does. It fills generated fields through the context and refuses a written value outside a field's enum, checking it against enum accessors it builds from the context once per client with the framework's `buildNamespacedEnums`. `createMongoCollection({ context, runtime }, modelName)` creates one collection the same way
- **Typed queries**: `findMany` with equality filters (`MongoWhereFilter`) and reference includes (`MongoIncludeSpec`)
- **Row type inference**: `InferFullRow` (scalar fields + embedded documents), `InferRootRow` (discriminated union for polymorphic roots), `IncludeResultFields`
- **Polymorphic narrowing**: Discriminator field carries literal variant values, enabling TypeScript `switch`/`if` narrowing
- **Prepared reads**: `.prepared.all()`, `.prepared.first()` and `.prepared.firstOrThrow()` return a `MongoPreparable` (the plan and how each run's rows become the result) and send nothing; the client's `prepare` takes them. A prepared placeholder goes in `limit`, `offset`, a scalar value in an object-form `where`, or a comparison or `$in`/`$nin` operand on a scalar field in a filter-expression `where`, and is checked against the field's codec and nullability when the `where` is built. Any other placeholder, and a write on a collection whose `where` holds one, is refused with `ORM.ARGUMENT_INVALID`. See [ADR 318](../../../../docs/architecture%20docs/adrs/ADR%20318%20-%20MongoDB%20prepared%20statements.md)
- **Execution interface**: Runs plans through `MongoQueryExecutor`, which `@internal/mongo-query-ast/execution` declares beside `MongoQueryPlan` and the runtime satisfies

## Related Docs

- [Naming model and result types](../../../../docs/reference/model-and-result-types.md)
