# Slice 5: `prisma6Schema`, the Prisma 6 MongoDB schema as a contract source

_Parent: `projects/mongo-defaults-codecs-prisma6-source/`. Branch `mongo-prisma6-source`, stacked on slice 3. Supersedes `projects/prisma7-contract-source/slices/02-mongo-source/spec.md`. Outcome: a Mongo user points `prisma.config.ts` at their Prisma 6 `schema.prisma`, and `contract emit` and `db sign` succeed against the database Prisma 6 shaped._

## At a glance

```ts
// prisma.config.ts
import { definePrismaConfig } from 'prisma/config';
import { defineConfig as ormConfig, prisma6Schema } from '@prisma/orm-mongo/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: prisma6Schema('prisma/schema.prisma'),
    db: { connection: process.env['DATABASE_URL']! },
  }),
});
```

```prisma
// prisma/schema.prisma (Prisma 6, unchanged)
datasource db { provider = "mongodb"  url = env("DATABASE_URL") }
model Post {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  title     String
  views     BigInt
  meta      Json
  authorId  String   @db.ObjectId
  author    User     @relation(fields: [authorId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([authorId])
}
```

`prisma contract emit` writes the same `contract.json` Prisma 8 PSL would produce for the equivalent model with `Int64`, `Json`, `ObjectId`, `temporal.createdAt()`, and `temporal.updatedAt()`.

## Chosen design

- **Package** `packages/2-mongo-family/2-authoring/contract-prisma6` (`@internal/mongo-contract-prisma6`, export `./provider`), shaped like `packages/2-sql/2-authoring/contract-prisma7`: `prisma6Contract(schemaPath, { binding, output?, defaultControlPolicy? })` returns a `ContractConfig` whose `source.load` reads one file or a directory of `.prisma` files, parses with `@internal/psl-parser` `grammar: 'prisma7'` (enum member attributes; the `// use prisma-8` directive is not required), and builds the Mongo contract directly from the framework contract building blocks exported by `@internal/mongo-contract` and `@internal/mongo-contract-psl` (`buildMongoNamespace`, `MongoStorage`, `computeStorageHash`, `buildMongoExecutionSection`, `MongoIndex`), never by rewriting the file and running the Prisma 8 interpreter. Published under `@prisma/orm-family-mongo` with `subpaths: ['provider']`.
- **Binding** `Prisma6TargetBinding` from the Mongo target (`@internal/target-mongo/prisma6-binding`): accepted providers (`mongodb`), the scalar type map to codec ids, the ObjectId codec id, and the timestamp generator id. The authoring package holds no target facts.
- **Facade**: `defineConfig` in `packages/3-extensions/mongo/src/config/define-config.ts` accepts `contract: string | ContractConfig` exactly as the Postgres facade does; `prisma6Schema(path)` is exported from `@prisma/orm-mongo/config`.
- **Diagnostics** `PSL.PRISMA6_MONGO_*` via `ContractSourceDiagnostic`, hard errors only, one per construct, no partial output. Plus `PSL.PRISMA6_MONGO_SCHEMA_READ_FAILED` and `PSL.PRISMA6_MONGO_CONTRACT_INVALID` as in the Postgres reader.
- **No validators.** The emitted contract carries no `$jsonSchema` validators, because Prisma 6 databases have none and Mongo verify fails on a declared-but-missing validator. The TypeScript builder already emits none, so this is an existing contract shape. Users who want validators switch to Prisma 8 PSL after cutover.
- **Unknown top-level blocks** in the Prisma 8 Mongo PSL interpreter get `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK` at the keyword span, mirroring SQL, so a `view` is never silently dropped on either path. (Assigned to this slice by the earlier project.)

## Rule table

| Prisma 6 | Rule |
|---|---|
| `datasource` with `provider = "mongodb"` | Required; otherwise `PSL.PRISMA6_MONGO_PROVIDER_MISMATCH`. `url` ignored. |
| `generator`, `previewFeatures` | Ignored. |
| id field `String @id @default(auto()) @map("_id") @db.ObjectId` | `_id` with the ObjectId codec. `@default(auto())` accepted and dropped. |
| id field without `@db.ObjectId`, or `@@id` | `PSL.PRISMA6_MONGO_ID_NOT_OBJECTID`, `PSL.PRISMA6_MONGO_COMPOSITE_ID_UNSUPPORTED`. |
| `String @db.ObjectId` on any other field | ObjectId codec. |
| Any other `@db.*` | `PSL.PRISMA6_MONGO_NATIVE_TYPE_UNSUPPORTED`. |
| `String`, `Int`, `Float`, `Boolean`, `DateTime` | `mongo/string@1`, `mongo/int32@1`, `mongo/double@1`, `mongo/bool@1`, `mongo/date@1`. |
| `BigInt`, `Decimal`, `Bytes`, `Json` | `mongo/int64@1`, `mongo/decimal128@1`, `mongo/binary@1`, `mongo/json@1`. |
| Lists of scalars, composites, enums | `many: true`. |
| `DateTime @default(now())` | `onCreate: timestampNow` (what `temporal.createdAt()` produces). |
| `DateTime @updatedAt`, with or without `@default(now())` | `onCreate` + `onUpdate: timestampNow` (what `temporal.updatedAt()` produces). No storage default is involved on Mongo, so the ADR 252 default-plus-generator error does not apply. |
| `@updatedAt` on a non-`DateTime` field | `PSL.PRISMA6_MONGO_UPDATED_AT_TYPE_UNSUPPORTED`. |
| Generated field (`now()` or `@updatedAt`) that is optional | `PSL.PRISMA6_MONGO_OPTIONAL_GENERATED_FIELD_UNSUPPORTED` (ADR 252). |
| `@default(...)` with any other value: literals, `uuid()`, `cuid()`, `dbgenerated()`, `now()` on a non-`DateTime` | `PSL.PRISMA6_MONGO_DEFAULT_UNSUPPORTED`. Mongo has no storage defaults and registers no id generators. |
| `type` blocks | Value objects. `@map` on a composite field: `PSL.PRISMA6_MONGO_COMPOSITE_MAP_UNSUPPORTED`. |
| `enum`, member `@map("value")` | Mongo enum with the text codec; the member's storage value is the `@map` value or the member name. |
| `@relation(name, fields, references)` on a to-one field | `N:1` relation. |
| `@relation` with `onDelete`, `onUpdate`, or `map` | `PSL.PRISMA6_MONGO_REFERENTIAL_ACTION_UNSUPPORTED`. |
| List relation field carrying `fields`/`references` (scalar-list many-to-many) | `PSL.PRISMA6_MONGO_LIST_RELATION_UNSUPPORTED`. |
| Back-relation list fields | Paired as the Mongo interpreter pairs them. |
| `@unique`, `@@unique([...])`, `@@index([...])` with `sort:` | Indexes; `map:`/`name:` dropped (Mongo verify never compares index names); `length:` → `PSL.PRISMA6_MONGO_INDEX_ARGUMENT_UNSUPPORTED`. |
| `@@fulltext([...])` | `@@textIndex` shape (one per model; a second → `PSL.PRISMA6_MONGO_TEXT_INDEX_LIMIT`). |
| `@map`, `@@map` | Field and collection names. Default collection name is the model name verbatim. |
| `@ignore`, `@@ignore` | Omitted; an ignored field referenced by an index or relation → `PSL.PRISMA6_MONGO_IGNORED_FIELD_REFERENCED`. |
| `@@schema`, `view` | `PSL.PRISMA6_MONGO_SCHEMA_UNSUPPORTED`, `PSL.PRISMA6_MONGO_VIEW_UNSUPPORTED`. |
| Any other attribute or top-level block | `PSL.PRISMA6_MONGO_UNKNOWN_ATTRIBUTE`, `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK`. |

Every hard error above except `@@schema` is expected to flip to a mapping when the Mongo family gains the capability.

## Coherence rationale

One reader with one rule table, mirroring a shipped sibling. A reviewer reads the binding, the rule table, and the fixtures as evidence for each row.

## Scope

In: the package, binding, facade change, the unknown-block diagnostic in the Mongo PSL interpreter, fixtures per rule row, end-to-end emit and sign on `mongodb-memory-server` against collections and indexes shaped as Prisma 6 creates them, docs (Mongo facade README config reference, `docs/reference/error-reference.md`, `skills/prisma-8/references/contract.md` and `quickstart.md` migration note), close-out of `projects/prisma7-contract-source/slices/02-mongo-source/` (delete; this spec replaces it).

Out: `contract print` for Mongo; `prisma orm init` Prisma 6 detection (it looks for `prisma7Schema`; record as an open item); validators; referential actions; many-to-many; a Mongo `uuid`/`cuid` generator.

## Pre-investigated edge cases

- The Mongo interpreter resolves scalar names by bare name, so `String @db.ObjectId` must be handled in the reader, never by name lookup.
- Prisma 6 `db push` creates collections lazily; the end-to-end test must create the collections and indexes itself in the shape Prisma 6 produces (collection per model, indexes with Prisma 6 names, no validators) and prove verify reports zero findings including on the named indexes.
- `_id_` is filtered at introspection; text-index server defaults are stripped when the contract does not set them.

## Slice Definition of Done

Inherits `drive/calibration/dod.md`. Slice-specific:

- Every rule row and every error code has a fixture that runs through `parse()` and the reader, with `expected-contract.json` or `expected-diagnostics.json`, in the Postgres reader's fixture layout.
- End-to-end on `mongodb-memory-server`: collections and indexes shaped as Prisma 6 creates them, then `contract emit` and `db sign` succeed with zero findings through the CLI journey helpers.
- For the at-a-glance schema, the reader's contract equals the contract the Prisma 8 Mongo PSL interpreter produces for the equivalent Prisma 8 model, apart from validators (which the reader omits).
- `architecture.config.json` covers the package (the `packages/2-mongo-family/2-authoring/**` glob); `pnpm lint:deps` clean; publish surface lists the subpath; `pnpm check:upgrade-coverage` passes (additive only).

## References

- Template: `packages/2-sql/2-authoring/contract-prisma7/src/*`, `packages/3-targets/3-targets/postgres/src/core/prisma7-binding.ts`, `packages/3-extensions/postgres/src/config/{prisma7-schema,define-config}.ts`, tests under `contract-prisma7/test` and `test/integration/test/{prisma7-source,cli-journeys/prisma7-source.e2e.test.ts}`.
- Mongo building blocks: `packages/2-mongo-family/2-authoring/contract-psl/src/{interpreter,field-presets,mongo-attribute-specs}.ts`, `@internal/mongo-contract` exports.
- ADR 252, ADR 163. `projects/prisma7-contract-source/slices/02-mongo-source/spec.md` (superseded).
