# @internal/mongo-contract

Contract types and validation for the MongoDB family.

## Responsibilities

- **Contract types**: `MongoContract`, `MongoContractWithTypeMaps`, `MongoTypeMaps`, `MongoStorageShape` (raw-JSON storage shape) — the typed contract representation for MongoDB targets
- **Storage IR**: `MongoStorage` — the in-memory storage class instantiated by the per-target contract serializer; structurally satisfies `MongoStorageShape` and additionally carries the `namespaces` map
- **Type-level extraction**: `ExtractMongoTypeMaps`, `ExtractMongoCodecTypes`, `InferModelRow` — utility types for deriving codec types and row shapes from a contract
- **Index identity**: `MONGO_INDEX_OPTION_KEYS` lists every index option; the compiler rejects the list when an option of `MongoIndexInput` is missing. `indexLookupKey()` turns an index into a string from its keys and those options, with an option set to `false` counting as unset; `canonicalize()` writes option values with sorted keys. Two indexes are the same when their lookup keys are equal. The contract builder merges indexes, and the planner and the verifier match indexes, by this one function.
- **Structural schema + storage validation primitives**: `MongoContractSchema` (arktype envelope) and `validateMongoStorage()` — consumed by the family `ContractSerializerBase` to validate Mongo contracts at the deserializer seam. No freestanding `validateMongoContract` wrapper is exported; callers cross the seam via `familyInstance.deserializeContract(...)`.
