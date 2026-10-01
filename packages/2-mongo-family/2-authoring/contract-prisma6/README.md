# @internal/mongo-contract-prisma6

Reads a Prisma 6 MongoDB `schema.prisma` as a Prisma 8 contract source. During the side-by-side period Prisma 6 keeps owning the database; this package lets `prisma contract emit` and `prisma db sign` read that schema directly, so no second schema file is needed until cutover.

## Responsibilities

- `prisma6Contract(path, options)` returns a `ContractConfig` (format `psl`, because a Prisma 6 schema is PSL text) whose `source.load` reads the input and parses every `.prisma` file with `@internal/psl-parser` (no `// use prisma-8` directive is needed). The source declares `parserOptions: { grammar: 'prisma-7' }` (Prisma 6 schemas use the Prisma 7 grammar), so the parser reads a `view` body as model fields and the reader can refuse the view by name. A file input reads that file; a directory input reads every regular `.prisma` file under it, nested directories and symbolic links included, sorted by path. The default `output` is `contract.json` beside the input; `options.output` overrides it.
- The reader builds the Mongo contract directly from shared building blocks (`buildMongoStorage`, `encodeMongoValueSets` and `MongoIndex` from `@internal/mongo-contract`, `pairMongoBackRelations` from `@internal/mongo-contract-psl`, and `buildExecutionSection` from `@internal/contract/hashing`) and checks it as `contract emit` does. It never rewrites the schema into Prisma 8 PSL. Every construct it does not support is a diagnostic with a span; nothing is changed silently, and a schema with any diagnostic gives no contract. Diagnostics are listed in source order (files in the order they are read, then by position). A schema whose datasource is not MongoDB gets only `PSL.PRISMA6_MONGO_PROVIDER_MISMATCH` (and any parse errors); its models are not read.
- The contract carries no `$jsonSchema` validators: Prisma 6 databases have none, and verify reports a declared validator that the database lacks.
- `Prisma6TargetBinding` (`src/target-binding.ts`) declares the target facts: the datasource providers, the codec for each Prisma 6 scalar, the ObjectId codec, and the timestamp generator. The Mongo target's binding is `prisma6MongoBinding` in `@internal/target-mongo/prisma6-binding`.

## Rule table, in short

| Prisma 6 | Contract |
|---|---|
| `datasource` with `provider = "mongodb"` | Required (`PSL.PRISMA6_MONGO_PROVIDER_MISMATCH`); `generator` and `previewFeatures` are ignored. A dotted path in a `datasource` or `generator` value (`url = env.DATABASE_URL`) is `PSL_INVALID_EXTENSION_BLOCK_MEMBER`, because Prisma 6 accepts none there. |
| `id String @id @default(auto()) @map("_id") @db.ObjectId` | `_id` with the ObjectId codec; `auto()` is dropped. Any other id: `PSL.PRISMA6_MONGO_ID_NOT_OBJECTID`; `@@id`: `PSL.PRISMA6_MONGO_COMPOSITE_ID_UNSUPPORTED`. |
| Scalars, native types, lists, composite types, enums | The codecs the binding names, each the codec for the BSON type Prisma 6 stores with the application type the Prisma 6 client presents: a plain `Int` and `Int @db.Long` are a BSON long read as a `number`, so the Mongo binding maps them to `mongo/int64Number@1`; `@db.Int` maps to `mongo/int32@1`, and `BigInt` to `mongo/int64@1` (a `bigint`). Every native type Prisma 6.19 accepts on MongoDB has a row in the binding's native-type table (`@db.String`, `@db.ObjectId` on `String` and `Bytes`, `@db.Bool`, `@db.Int`, `@db.Long` on `Int` and `BigInt`, `@db.Double`, `@db.Date`, `@db.BinData`, `@db.Json`) except `DateTime @db.Timestamp`, whose BSON timestamp no Prisma 8 codec reads; it and any native type Prisma 6 rejects are `PSL.PRISMA6_MONGO_NATIVE_TYPE_UNSUPPORTED`. `many: true` for lists; value objects; enums with the text codec and the member `@map` value. |
| `DateTime @default(now())`, `DateTime @updatedAt` | `onCreate`, or `onCreate` and `onUpdate`, with the timestamp generator. Other defaults, optional generated fields, and `@updatedAt` on other types are hard errors. |
| `@relation(fields, references)` on a to-one field, back-relations | `N:1`, paired as the Prisma 8 Mongo interpreter pairs them. Referential actions and list relations with keys are hard errors. |
| `@unique`, `@@unique`, `@@index`, `@@fulltext` | Indexes, with `sort:`; names are dropped; `length:` and a second `@@fulltext` are hard errors. |
| Index path into a composite type, `@@index([address.city])` or `@@index([address.city(sort: Asc)])` | `PSL.PRISMA6_MONGO_COMPOSITE_INDEX_PATH_UNSUPPORTED`. A dotted path whose first segment is not a composite-type field (`@@index([title.first])`) is `PSL.PRISMA6_MONGO_INDEX_ARGUMENT_UNSUPPORTED`, as Prisma 6 refuses it too. |
| `@map`, `@@map`, `@ignore`, `@@ignore` | Stored names; ignored fields and models are omitted. |
| `@@schema`, `view`, unknown attributes and blocks | Hard errors. |

The fixtures in `test/fixtures/` hold one case per rule row and per error code.

## Using the source in a Prisma 6 project

Users reach this source through `prisma6Schema` in `@prisma/orm-mongo/config`; its [README](../../../3-extensions/mongo/README.md#prisma6schemapath-adopt-a-prisma-6-mongodb-schema-during-the-transition) has the full setup. In short:

- **Two CLIs, one package name.** Both are published as `prisma`. Prisma 8 keeps the name (`prisma.config.ts` imports `prisma/config`), and Prisma 6 is installed under an npm alias (`"prisma6": "npm:prisma@6.19.3"`) and run through a `prisma6` script (`node node_modules/prisma6/build/index.js --config prisma6.config.ts`), because the alias installs no binary of its own and the Prisma 6 CLI would otherwise read Prisma 8's `prisma.config.ts`. Both config files import `dotenv/config`, since neither CLI loads `.env` when it has a config file. `prisma orm init` prints these steps when it finds a Prisma 6 MongoDB schema.
- **Prisma 6 owns the database.** After each schema change: Prisma 6's `db push`, then `prisma contract emit` and `prisma db sign`. When `db verify` or `db sign` finds the database behind the contract, apply the change with Prisma 6's `db push` rather than the `prisma db update` the CLI suggests, then sign again.
- **`db sign` writes into the project.** It sets the `db` ref in `migrations/app/refs/db.json` and writes a contract snapshot under `migrations/snapshots/<hash>/` (`contract.json`, `contract.d.ts`). `--no-advance-ref` signs without writing either.
- **What changes for Prisma 6 application code.** The id is `_id`; models are reached by collection name (`db.orm.users`); enum values are the stored `@map` values (`'admin'`, not `'ADMIN'`); optional fields are typed `T | null`, and a document Prisma 6 wrote without the field reads with it absent, so test with `== null`; `Bytes` is a `Uint8Array`, `BigInt` a `bigint` and `Int` a `number`, as in Prisma 6; `Bytes @db.ObjectId` is a hex string, read and written as one (convert bytes with `Buffer.from(hex, 'hex')` and `bytes.toString('hex')`); `Decimal` is a `string` (Prisma 6 refuses `Decimal` on MongoDB); `Json` holds JSON values only.
