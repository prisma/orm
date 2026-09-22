# @internal/mongo-value

Primitive value types and parameter references for the MongoDB family.

## Responsibilities

- **Value types**: `MongoValue`, `LiteralValue`, `MongoDocument`, `MongoArray`, `MongoExpr`, `MongoUpdateDocument`, `RawPipeline`, and `Document` — the shared vocabulary for all MongoDB expression and document types
- **Parameter references**: `MongoParamRef` — an immutable tagged reference carrying a runtime value, optional name, and codec ID for parameter binding during query lowering
