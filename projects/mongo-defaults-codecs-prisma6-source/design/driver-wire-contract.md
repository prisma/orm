# Design: the Mongo driver interface owns the wire-type contract

Settled with Will on 2026-09-25. Project candidate `mongo-driver-wire-contract`; not part of the current slices. Facts checked on branch `mongo-generator-runtime-hoist`.

## The principle

A driver is replaceable by another driver that exchanges the same wire types as the codecs in use. ADR 155 states this for SQL, conditional on a fixed boundary and a conformance kit; no document states it for Mongo, and nothing in either family enforces it today.

## What is true today (the coupling points)

- The codec type contract `CodecImpl<Id, Traits, Wire, App>` (`packages/1-framework/1-core/framework-components/src/shared/codec.ts`) checks `Wire` against nothing.
- `MongoDriver.execute<Row>(wireCommand)` (`packages/2-mongo-family/6-transport/mongo-lowering/src/driver-types.ts`) types rows as the caller chooses and commands as `Document = Record<string, unknown>`; no BSON shape is stated.
- The Mongo codecs (`packages/3-mongo-target/1-mongo-target/src/core/{codecs,bson-scalar-helpers}.ts`) construct `bson` 7 objects on encode (`new ObjectId`, `Long.fromBigInt`, `Decimal128.fromString`, `new Binary`); `bson`'s serializer rejects objects from another major version. On decode they check `_bsontype` tags and then call `toBigInt()`, `toString()`, `value()`, `toHexString()`; the int64 decoder accepts `number` because the Node driver promotes small longs by default.
- `mongodb` types leak past the driver: `Db` in `mongo-lowering/src/driver-types.ts` (`MongoControlDriverInstance.db`), `CollationOptions`/`CreateCollectionOptions`/`CreateIndexesOptions`/`IndexSpecification` re-exported from `packages/2-mongo-family/1-foundation/mongo-value/src/exports/mongodb-types.ts` and used by mongo-wire, query-ast, schema-ir, contract-psl, and the family; `MongoServerError` used as a value in the adapter's inspection executor; the control adapter uses `Db` directly in `mongo-control-driver.ts`, `inspection-executor.ts`, `introspect-schema.ts`.
- There is one driver implementation (`MongoDriverImpl`; `MongoControlDriver` extends it) and no conformance test.

## The design

1. **`@internal/mongo-lowering` (the transport layer) declares the wire value vocabulary** as types: `BsonWireValue` (the structural union in `design/scalar-naming.md` § 6, `BsonValue`, minus nothing) and `BsonWireDocument`. `MongoDriver.execute` returns `AsyncIterable<BsonWireDocument>`; `AnyMongoDmlWireCommand` payloads are typed with `BsonWireValue` instead of `unknown`.
2. **Codecs declare `Wire` in that vocabulary.** `mongo/objectId@1` wire is the `ObjectId` structural member, `mongo/int64@1` wire is the `Long` member or `number` or `bigint`, and so on. Decoders keep the tag checks and call only the methods the structural members declare; encoders keep constructing `bson` objects (the one place the library is a dependency, and the target package owns it).
3. **Driver options are the driver's.** The `promoteLongs`/`useBigInt64` behaviour is part of the wire contract and is stated in the `MongoDriver` interface documentation: a driver hands a `long` back as a `number` when it fits in 53 bits, otherwise as the `Long` member. A replacement driver must match this or configure its library to.
4. **`mongodb` types stop leaking.** `MongoControlDriverInstance.db: Db` becomes an opaque handle typed by the transport layer, and the control adapter reaches `Db` through the driver package only; the four option types re-exported from `mongo-value` are re-declared as structural types in `mongo-value` (they are plain data); `MongoServerError` is replaced by a driver-mapped error the adapter reads through the transport layer.
5. **Conformance tests are deferred.** When a second driver exists, a conformance suite in `@internal/mongo-lowering` asserts the wire vocabulary per codec; until then the types are the contract.

## Definition of done for the project

- No file outside `packages/3-mongo-target/3-mongo-driver` imports from `mongodb` except test files.
- `MongoDriver` and the wire command types name every value shape they exchange.
- Every Mongo codec's `Wire` type is a member of the transport vocabulary.
- All existing Mongo package and integration tests pass unchanged.
