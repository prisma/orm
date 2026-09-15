# Slice 2: Prisma 6 contract source for Mongo

_Parent project: `projects/prisma7-contract-source/`. Linear: to be created. Outcome: a Mongo user points `prisma.config.ts` at their Prisma 6 `schema.prisma` and `contract emit` and `db sign` succeed against the database Prisma 6 shaped._

> **Corrected 2026-09-14 from the public docs.** Prisma 7 has no MongoDB connector; the [MongoDB upgrade guide](https://www.prisma.io/docs/guides/upgrade-prisma-orm/mongodb) is a Prisma 6 to 8 port with no side-by-side phase. This slice therefore reads the Prisma 6 MongoDB schema dialect (the same `schema.prisma` grammar, `datasource` with `provider = "mongodb"`, `@db.ObjectId`, `@default(auto())`, composite `type` blocks, `@@fulltext`). The factory keeps the `prisma7Schema` name for a single documented entry point across both families unless the plan finds that confusing, in which case a `prisma6Schema` alias is exported for Mongo and the decision is recorded here.

## At a glance

```ts
import { defineConfig, prisma7Schema } from '@prisma/orm-mongo/config';
export default defineConfig({ contract: prisma7Schema('prisma/schema.prisma') });
```

## Chosen design

- **Package** `packages/2-mongo-family/2-authoring/contract-prisma7`, shaped like the Mongo `contract-psl`. Same `prisma7Schema` factory shape and `source.load` contract as slice 1; the parser additions from slice 1 are reused.
- **Config**: `defineConfig` in `packages/3-extensions/mongo/src/config/define-config.ts` accepts `contract: string | ContractConfig`.
- **Provider check**: `provider` must be `mongodb`, else `PRISMA7_PROVIDER_MISMATCH`.
- **Unknown top-level blocks in the Mongo PSL interpreter.** Found in slice 1 dispatch 3 review: `packages/2-mongo-family/2-authoring/contract-psl` keeps only `enum` blocks and silently drops every other generic block, including `view`. This slice adds a diagnostic for unknown top-level block keywords in the Mongo PSL interpreter, mirroring SQL's `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK`, so a Prisma 7 `view` is never silently lost on either path.

## Rule table

| Prisma 7 | Rule |
|---|---|
| id field `String @id @default(auto()) @map("_id") @db.ObjectId` | `_id` with the ObjectId codec. `@default(auto())` on this field is accepted and dropped, since Mongo assigns `_id`. |
| id field without `@db.ObjectId` | `PRISMA7_MONGO_ID_NOT_OBJECTID` (Prisma 8 requires ObjectId ids, `interpreter.ts:1319-1338`). |
| `@db.ObjectId` on any other field | ObjectId codec. |
| `String`, `Int`, `Boolean`, `DateTime`, `Float`, lists, composite `type` blocks | Map directly. |
| `Json`, `Bytes`, `Decimal`, `BigInt` | `PRISMA7_MONGO_TYPE_UNSUPPORTED`. |
| `@default(...)` on any non-id field, `@updatedAt` | `PRISMA7_MONGO_DEFAULT_UNSUPPORTED`. |
| `@relation(name, fields, references)` | Map directly. |
| `@relation(onDelete, onUpdate, map)` | `PRISMA7_MONGO_REFERENTIAL_ACTION_UNSUPPORTED`. |
| `@unique`, `@@unique`, `@@index` | Map directly. Verification item 5 decides whether Prisma 7's index names are set. |
| `@@fulltext` | `@@textIndex`. |
| `@map` on a composite-type field | `PRISMA7_MONGO_COMPOSITE_MAP_UNSUPPORTED` (Prisma 8 ignores it silently, `interpreter.ts:1378`). |
| `enum` | Mongo enum with the text codec. Member `@map` is the storage value. |
| `@@map`, `@map` | Map directly. Collection name is `@@map` or the model name verbatim. |
| `@@schema`, `view`, `@@id` | Errors: `PRISMA7_MONGO_SCHEMA_UNSUPPORTED`, `PRISMA7_VIEW_UNSUPPORTED`, `PRISMA7_MONGO_COMPOSITE_ID_UNSUPPORTED`. |
| `@ignore`, `@@ignore` | Omitted, as in slice 1. |

## Slice Definition of Done

Inherits `drive/calibration/dod.md`. Slice-specific:

- [ ] Every rule row and every error code has a fixture that runs through `parse()` and the interpreter.
- [ ] Verification item 5 has a test committed before the index rule.
- [ ] End-to-end proof on `mongodb-memory-server`: collections and indexes shaped as Prisma 7 creates them, then `contract emit` and `db sign` succeed.
- [ ] `architecture.config.json` lists the new package; `pnpm lint:deps` clean.
- [ ] `packages/3-extensions/mongo` config reference documents `prisma7Schema`.
