# Slice 2: Prisma 6 contract source for Mongo

_Parent project: `projects/prisma7-contract-source/`. Linear: to be created. Outcome: a Mongo user points `prisma.config.ts` at their Prisma 6 `schema.prisma` and `contract emit` and `db sign` succeed against the database Prisma 6 shaped._

Prisma 7 has no MongoDB connector; the [MongoDB upgrade guide](https://www.prisma.io/docs/guides/upgrade-prisma-orm/mongodb) is a Prisma 6 to 8 port with no side-by-side phase. This slice therefore reads the Prisma 6 MongoDB schema dialect (the same `schema.prisma` grammar, `datasource` with `provider = "mongodb"`, `@db.ObjectId`, `@default(auto())`, composite `type` blocks, `@@fulltext`).

The Mongo facade's function is `prisma6Schema`, because the dialect it reads is Prisma 6. There is no `prisma7Schema` alias on the Mongo facade: one function gets one name, and the name says which Prisma version's schema it accepts. [ADR 252](<../../../../docs/architecture docs/adrs/ADR 252 - An earlier Prisma version's schema is a contract source.md>) records the naming decision for both facades. Its codes follow the same ADR: dotted, in the `PSL` namespace, and named after the dialect they belong to, so the Mongo codes are `PSL.PRISMA6_MONGO_*`.

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

## Chosen design

- **Package** `packages/2-mongo-family/2-authoring/contract-prisma6`, shaped like the Mongo `contract-psl`. Same factory shape and `source.load` contract as slice 1's `prisma7Contract`, under the name `prisma6Contract`; the parser additions from slice 1 are reused.
- **Config**: `defineConfig` in `packages/3-extensions/mongo/src/config/define-config.ts` accepts `contract: string | ContractConfig`.
- **Provider check**: `provider` must be `mongodb`, else `PSL.PRISMA6_MONGO_PROVIDER_MISMATCH`.
- **Unknown top-level blocks in the Mongo PSL interpreter.** `packages/2-mongo-family/2-authoring/contract-psl` keeps only `enum` blocks and silently drops every other generic block, including `view`. This slice adds a diagnostic for unknown top-level block keywords in the Mongo PSL interpreter, mirroring SQL's `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK`, so a Prisma 6 `view` is never silently lost on either path.

## Rule table

| Prisma 6 | Rule |
|---|---|
| id field `String @id @default(auto()) @map("_id") @db.ObjectId` | `_id` with the ObjectId codec. `@default(auto())` on this field is accepted and dropped, since Mongo assigns `_id`. |
| id field without `@db.ObjectId` | `PSL.PRISMA6_MONGO_ID_NOT_OBJECTID` (Prisma 8 requires ObjectId ids, `interpreter.ts:1319-1338`). |
| `@db.ObjectId` on any other field | ObjectId codec. |
| `String`, `Int`, `Boolean`, `DateTime`, `Float`, lists, composite `type` blocks | Map directly. |
| `Json`, `Bytes`, `Decimal`, `BigInt` | `PSL.PRISMA6_MONGO_TYPE_UNSUPPORTED`. |
| `@default(...)` on any non-id field, `@updatedAt` | `PSL.PRISMA6_MONGO_DEFAULT_UNSUPPORTED`. |
| `@relation(name, fields, references)` | Map directly. |
| `@relation(onDelete, onUpdate, map)` | `PSL.PRISMA6_MONGO_REFERENTIAL_ACTION_UNSUPPORTED`. |
| `@unique`, `@@unique`, `@@index` | Map directly. Verification item 5 decides whether Prisma 6's index names are set. |
| `@@fulltext` | `@@textIndex`. |
| `@map` on a composite-type field | `PSL.PRISMA6_MONGO_COMPOSITE_MAP_UNSUPPORTED` (Prisma 8 ignores it silently, `interpreter.ts:1378`). |
| `enum` | Mongo enum with the text codec. Member `@map` is the storage value. |
| `@@map`, `@map` | Map directly. Collection name is `@@map` or the model name verbatim. |
| `@@schema`, `view`, `@@id` | Errors: `PSL.PRISMA6_MONGO_SCHEMA_UNSUPPORTED`, `PSL.PRISMA6_MONGO_VIEW_UNSUPPORTED`, `PSL.PRISMA6_MONGO_COMPOSITE_ID_UNSUPPORTED`. |
| `@ignore`, `@@ignore` | Omitted, as in slice 1. |

## Slice Definition of Done

Inherits `drive/calibration/dod.md`. Slice-specific:

- [ ] Every rule row and every error code has a fixture that runs through `parse()` and the interpreter.
- [ ] Verification item 5 has a test committed before the index rule.
- [ ] End-to-end proof on `mongodb-memory-server`: collections and indexes shaped as Prisma 6 creates them, then `contract emit` and `db sign` succeed.
- [ ] `architecture.config.json` lists the new package; `pnpm lint:deps` clean.
- [ ] `packages/3-extensions/mongo` config reference documents `prisma6Schema`.
