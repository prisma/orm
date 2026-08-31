# @internal/mongo-lowering

Adapter and driver interface contracts for the MongoDB transport layer.

## Responsibilities

- **Adapter interface**: `MongoAdapter` — defines `lower(plan: MongoQueryPlan): Promise<AnyMongoWireCommand>` (one-shot `resolveParams(structuralLower(plan))`), plus the two-phase split `structuralLower` / `resolveParams` used by `@internal/mongo-runtime` so `beforeExecute` middleware can mutate `MongoParamRef` leaves before codec resolution. Those phase methods are public on this SPI (unlike SQL's private `lowerToDraft` / `encodeDraftParams` on the SQL runtime) because lowering is target-owned through the adapter on the execution stack. Rationale and SQL contrast: [ADR 215 — Mongo family: lifecycle parity and intentional placement asymmetries](../../../../docs/architecture%20docs/adrs/ADR%20215%20-%20Runtime%20middleware%20lifecycle%20beforeExecute%20before%20encodeParams.md#mongo-family-lifecycle-parity-and-intentional-placement-asymmetries).
- **Driver interface**: `MongoDriver` — defines `execute<Row>(wireCommand): AsyncIterable<Row>` and `close()`, the contract for sending wire commands to a MongoDB instance
