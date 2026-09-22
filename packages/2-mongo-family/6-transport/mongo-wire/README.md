# @internal/mongo-wire

Wire-level command and result types for MongoDB operations.

## Responsibilities

- **Wire commands**: Typed, frozen command classes for all MongoDB write and aggregation operations — `InsertOneWireCommand`, `InsertManyWireCommand`, `UpdateOneWireCommand`, `UpdateManyWireCommand`, `DeleteOneWireCommand`, `DeleteManyWireCommand`, `FindOneAndUpdateWireCommand`, `FindOneAndDeleteWireCommand`, `AggregateWireCommand`
- **Command union**: `AnyMongoWireCommand` discriminated union (discriminant: `kind`) for dispatch in drivers
- **Result types**: `InsertOneResult`, `InsertManyResult`, `UpdateOneResult`, `UpdateManyResult`, `DeleteOneResult`, `DeleteManyResult` — the shapes returned by drivers after command execution
