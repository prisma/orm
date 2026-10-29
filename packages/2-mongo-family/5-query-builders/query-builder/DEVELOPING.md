# Developing @internal/mongo-query-builder

Internal architecture notes for contributors.

## Module structure

| File | Responsibility |
|------|---------------|
| `query.ts` | Entry point (`mongoQuery({ context })`) — reads the contract from the execution context, creates initial builder |
| `builder.ts` | `PipelineBuilder` class — immutable; each stage method returns a new instance with the appended stage |
| `types.ts` | Core type machinery: `DocField`, `DocShape`, `ModelToDocShape`, `ResolveRow`, shape transformers (`ProjectedShape`, `GroupedDocShape`, `UnwoundShape`, etc.) |
| `field-proxy.ts` | `Proxy`-based `FieldProxy<Shape>` — intercepts property access to produce `TypedAggExpr` nodes |
| `filter-proxy.ts` | `Proxy`-based `FilterProxy<Shape>` — intercepts property access to produce `FilterHandle` objects |
| `expression-helpers.ts` | `fn` object — typed wrappers around `MongoAggOperator` / `MongoAggCond` / `MongoAggLiteral`. Internal factory functions (`numericExpr`, `booleanExpr`, `namedArgsExpr`, etc.) construct `TypedAggExpr<F>` for each return-type category. |
| `accumulator-helpers.ts` | `acc` object — typed wrappers around `MongoAggAccumulator`. Named-arg accumulators use `MongoAggAccumulator.of(op, recordArgs)`. |

## Key design decisions

### Immutable builder

Every stage method clones state and returns a new `PipelineBuilder`. This allows branching pipelines from a shared prefix without mutation.

### Phantom `_field` on expressions

`TypedAggExpr<F>` and `TypedAccumulatorExpr<F>` carry a phantom `_field: F` property that exists only at the type level (`undefined as never` at runtime). The generic `F` propagates through the type system to track the resulting shape. Nothing reads `_field` at runtime.

### Proxy mechanics

`FieldProxy` and `FilterProxy` use ES `Proxy` with a `get` trap that converts property names to AST nodes. Both guard against symbol access (e.g. `Symbol.toPrimitive`) by returning `undefined` for symbol properties.

### Named-argument operators

Some MongoDB operators (e.g. `$dateToString`, `$trim`, `$topN`) take named arguments instead of positional arrays. The AST supports this via `Readonly<Record<string, MongoAggExpr>>` on both `MongoAggOperator.args` and `MongoAggAccumulator.arg`. In the pipeline builder, callers pass a record of `TypedAggExpr<DocField>` values; the helper maps each to its `.node` before constructing the AST node.

### Field type aliases

`types.ts` exports specific field type aliases used by expression and accumulator return types:

| Type | Codec | Use |
|------|-------|-----|
| `NumericField` | `mongo/double@1` | Arithmetic, date-part extraction, comparison |
| `NullableNumericField` | `mongo/double@1` (nullable) | `avg`, `stdDevPop`, `stdDevSamp` |
| `StringField` | `mongo/string@1` | String operators, `$type`, `$toString` |
| `BooleanField` | `mongo/bool@1` | Comparison, set predicates, `$toBool` |
| `DateField` | `mongo/date@1` | Date operators, `$toDate` |
| `ArrayField` | `mongo/array@1` | Array/set operators, N-variant accumulators |
| `DocField` | (generic) | Base type; used when output type is unknown |

## Package dependencies

- `@internal/mongo-contract` — contract types (`MongoContract`, `MongoContractWithTypeMaps`)
- `@internal/mongo-query-ast` — AST node constructors (`AggregateCommand`, stage classes, expression classes)
- `@internal/mongo-value` — `MongoValue` type for filter comparisons
- `@internal/contract` — `PlanMeta` type

## Running tests

```bash
pnpm test        # unit + type tests via vitest
pnpm typecheck   # tsc --noEmit
```

Integration tests live in `packages/2-mongo-family/7-runtime/test/query-builder.test.ts` and require `mongodb-memory-server`.
