# @internal/mongo-contract-prisma6

Reads a Prisma 6 MongoDB `schema.prisma` as a Prisma 8 contract source. During the side-by-side period Prisma 6 keeps owning the database; this package lets `prisma contract emit` and `prisma db sign` read that schema directly, so no second schema file is needed until cutover.

## Responsibilities

- `prisma6Contract(path, options)` returns a `ContractConfig` (format `prisma6`) whose `source.load` reads the input and parses every `.prisma` file with `@internal/psl-parser` (the `prisma7` grammar, which reads Prisma 6 schemas; no `// use prisma-8` directive is needed). A file input reads that file; a directory input reads every regular `.prisma` file under it, nested directories and symbolic links included, sorted by path. The default `output` is `contract.json` beside the input; `options.output` overrides it.
- The reader builds the Mongo contract directly from shared building blocks (`buildMongoStorage`, `encodeMongoValueSets` and `MongoIndex` from `@internal/mongo-contract`, `pairMongoBackRelations` from `@internal/mongo-contract-psl`, and `buildExecutionSection` from `@internal/contract/hashing`) and checks it as `contract emit` does. It never rewrites the schema into Prisma 8 PSL. Every construct it does not support is a diagnostic with a span; nothing is changed silently, and a schema with any diagnostic gives no contract.
- The contract carries no `$jsonSchema` validators: Prisma 6 databases have none, and verify reports a declared validator that the database lacks.
- `Prisma6TargetBinding` (`src/target-binding.ts`) declares the target facts: the datasource providers, the codec for each Prisma 6 scalar, the ObjectId codec, and the timestamp generator. The Mongo target's binding is `prisma6MongoBinding` in `@internal/target-mongo/prisma6-binding`.

## Rule table, in short

| Prisma 6 | Contract |
|---|---|
| `datasource` with `provider = "mongodb"` | Required (`PSL.PRISMA6_MONGO_PROVIDER_MISMATCH`); `generator` and `previewFeatures` are ignored. |
| `id String @id @default(auto()) @map("_id") @db.ObjectId` | `_id` with the ObjectId codec; `auto()` is dropped. Any other id: `PSL.PRISMA6_MONGO_ID_NOT_OBJECTID`; `@@id`: `PSL.PRISMA6_MONGO_COMPOSITE_ID_UNSUPPORTED`. |
| Scalars, `String @db.ObjectId`, lists, composite types, enums | The codecs the binding names; `many: true` for lists; value objects; enums with the text codec and the member `@map` value. Other `@db.*`: `PSL.PRISMA6_MONGO_NATIVE_TYPE_UNSUPPORTED`. |
| `DateTime @default(now())`, `DateTime @updatedAt` | `onCreate`, or `onCreate` and `onUpdate`, with the timestamp generator. Other defaults, optional generated fields, and `@updatedAt` on other types are hard errors. |
| `@relation(fields, references)` on a to-one field, back-relations | `N:1`, paired as the Prisma 8 Mongo interpreter pairs them. Referential actions and list relations with keys are hard errors. |
| `@unique`, `@@unique`, `@@index`, `@@fulltext` | Indexes, with `sort:`; names are dropped; `length:` and a second `@@fulltext` are hard errors. |
| `@map`, `@@map`, `@ignore`, `@@ignore` | Stored names; ignored fields and models are omitted. |
| `@@schema`, `view`, unknown attributes and blocks | Hard errors. |

The fixtures in `test/fixtures/` hold one case per rule row and per error code.
