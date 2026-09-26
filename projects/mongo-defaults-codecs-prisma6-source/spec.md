# Mongo execution defaults, missing codecs, and the Prisma 6 Mongo source

> Shaped 2026-09-24 with Will. Every claim below was checked against `main` at `7cbd1433a0`. Rule tables and file-level detail live in the slice specs under `slices/`.

## Purpose

Prisma 8's MongoDB family cannot fill `createdAt` and `updatedAt` automatically on create and update, and has no codecs for 64-bit integers, Decimal128, binary data, or a free-form `Json` value. Every Mongo schema of any size needs those, so every Prisma 8 Mongo author is blocked today, not only people migrating from Prisma 6. The SQL family already solved both problems. This project gives Mongo the same capability, built so that Mongo support is recognizably the same as Postgres support, and then reads a Prisma 6 Mongo `schema.prisma` as a contract source on top of it.

## At a glance

```prisma
// contract.prisma (Prisma 8, Mongo)
model Post {
  id        ObjectId             @id
  title     String
  views     Int64
  price     Decimal128
  thumbnail Binary
  meta      Json
  createdAt temporal.createdAt()
  updatedAt temporal.updatedAt()
}
```

```ts
// schema.ts
const Post = model('Post', {
  fields: {
    title: field.string(),
    views: field.int64(),
    price: field.decimal128(),
    thumbnail: field.binary(),
    meta: field.json(),
    createdAt: field.temporal.createdAt(),
    updatedAt: field.temporal.updatedAt(),
  },
});
```

`orm.post.create({ data: { title: 'x', ... } })` fills both timestamps. `update` with a non-empty payload advances `updatedAt`; an empty payload does not.

Migrating from Prisma 6:

```ts
// prisma.config.ts
import { defineConfig as ormConfig, prisma6Schema } from '@prisma/orm-mongo/config';
export default definePrismaConfig({
  orm: ormConfig({ contract: prisma6Schema('prisma/schema.prisma'), db: { connection: process.env['DATABASE_URL']! } }),
});
```

## Non-goals

- Reopening any design decision the SQL family already made: generator identity, the `onCreate`/`onUpdate` phase model, `'row'` versus `'query'` stability, the runtime-provides-what-the-contract-requires check, and the hard errors for an optional generated field and for a storage default combined with an update generator (ADR 252).
- Adding Prisma 6 grammar (`@default(now())`, `@updatedAt`) to Prisma 8 Mongo authoring. Prisma 8 Mongo uses the same `temporal.*` presets as Postgres.
- Referential-action emulation, views, composite ids (`@@id`), `@map` on composite-type fields, and `@@schema` on Mongo. The Prisma 6 reader reports each as a hard error. The expectation is that the reader is extended later, row by row, as the Mongo family gains each capability; `@@schema` has no Mongo meaning and is expected to stay an error.
- Storage-side defaults on Mongo. MongoDB has no column defaults; only execution (write-time) defaults exist in this project.
- Changing the SQL runtime's behaviour. Slice 3 moves code; SQL tests stay green and unchanged in intent.

## Place in the larger world

- The SQL template. Contract `execution` section: `packages/1-framework/0-foundation/contract/src/contract-types.ts:21-26`. Runtime registry, missing-generator check, duplicate refusal, and apply loop: `packages/2-sql/5-runtime/src/sql-context.ts:586-756`. Generator: `packages/2-sql/9-family/src/core/timestamp-now-runtime-generator.ts`. Presets: `packages/2-sql/9-family/src/core/timestamp-now-generator.ts`, registered per target in `packages/3-targets/3-targets/postgres/src/core/authoring.ts:921-970`. Framework preset instantiation: `packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts:1950-1977`.
- The Mongo side today. Contract schema rejects `execution` (`packages/2-mongo-family/1-foundation/mongo-contract/src/contract-schema.ts:439-474`, `'+': 'reject'`). No `executionHash`. Runtime context holds only contract, codecs, and stack (`packages/2-mongo-family/7-runtime/src/mongo-execution-stack.ts:107-157`). ORM write path builds documents with no default step (`packages/2-mongo-family/5-query-builders/orm/src/collection.ts:352-492, 788-857`). PSL resolves scalar types by bare name and has no field presets or namespaced type constructors (`packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts:963-1024`); `@updatedAt` is a hard error (`interpreter.ts:130-135`). TS has `field.date()` with no options.
- Codecs. Postgres keeps codecs, data types, and ids in the target package (`packages/3-targets/3-targets/postgres/src/core/codecs.ts`) and the adapter registers them. Mongo keeps them in the adapter (`packages/3-mongo-target/2-mongo-adapter/src/core/codecs.ts`, ids in `codec-ids.ts`). That is an earlier mistake; this project moves them to `packages/3-mongo-target/1-mongo-target`. `mongo/document@1` and `mongo/array@1` are type-level ids only, not registered codecs.
- The Prisma 6 reader was specified as `projects/prisma7-contract-source/slices/02-mongo-source/spec.md` and never built, because its rule table hard-errors on defaults, `@updatedAt`, and the four scalar types. That project's "Deferred gaps" list records the two capability gaps this project fills. Its verification item 5 is resolved: Mongo verify and the planner match indexes by key shape and options, never by name (`packages/2-mongo-family/9-family/src/core/schema-diff.ts:122-142`).
- Contract sources are `ContractConfig` objects whose `source.load` returns a contract or diagnostics (ADR 163, ADR 252).

## Cross-cutting requirements

1. **Mongo mirrors Postgres and reuses framework primitives.** Authors write `temporal.createdAt()`, `temporal.updatedAt()`, and `temporal.timestamp(onCreate: now, onUpdate: now)` in PSL, and `field.temporal.*` in TS, through the framework's `fieldPreset` descriptors and `instantiateAuthoringFieldPreset`. There is no precision argument: Mongo dates have none. Codec layout follows Postgres: codecs, data types, ids, and descriptors in the target package; the adapter only registers them.
2. **No SQL vocabulary enters the framework or the Mongo family.** The framework's `ExecutionMutationDefault.ref` is renamed to `{ namespace, entry, field }` in its own slice before any Mongo execution work, and SQL is migrated onto it; Mongo then uses the framework contract type unchanged. When the runtime machinery is hoisted, it carries no SQL vocabulary.
3. **Optional section, unchanged hashes.** `execution` is optional in the Mongo contract schema. Absent means no generators. Storage and profile hashes take no input from it. Mongo gains an `executionHash` computed like SQL's (`packages/1-framework/0-foundation/contract/src/hashing.ts:88-96`) and the emitter writes it as the same separate artifact field. Existing emitted Mongo contracts load, hash, and verify unchanged.
4. **Runtime enforces the contract.** The Mongo runtime refuses to build an execution context when the contract requires a generator no component provides, and refuses duplicate generator ids. Same error codes as SQL where they already exist in the framework.
5. **Write semantics identical to SQL.** `onCreate` runs on `create`, `createAll`, `createAndCount`, and the insert half of `upsert`. `onUpdate` runs on `update`, `updateAll`, `updateAndCount`, and the update half of `upsert`. An empty update payload skips all defaults. An explicitly provided value is never overwritten. `'query'` stability yields one value per ORM operation.
6. **Emitted types.** `contract.d.ts` marks generated fields optional on create input, as SQL does.
7. **Hard errors, never warnings.** Every codec, preset, and reader rule either works or is rejected with a diagnostic that names the construct and its span. Diagnostics for the reader use codes `PSL.PRISMA6_MONGO_*`.
8. **Layering.** Family rules in `packages/2-mongo-family`, target facts in `packages/3-mongo-target`, facade wiring in `packages/3-extensions/mongo`. `pnpm lint:deps` clean at every slice.

## Transitional-shape constraints

Slice 3 lands Mongo-local generator machinery in `packages/2-mongo-family/7-runtime`. That duplication of the SQL runtime is deliberate and short-lived: slice 4 hoists it into the framework and deletes both copies. Nothing outside the two runtimes may import the Mongo-local machinery, so the hoist is a package-internal move.

## Contract impact

- Mongo contract: new optional `execution` section `{ executionHash, mutations: { defaults: [{ ref: { namespace, model, field }, onCreate?, onUpdate? }] } }`; value shape `{ kind: 'generator', id, params? }` reused from the framework. New codec ids `mongo/int64@1`, `mongo/decimal128@1`, `mongo/binary@1`, `mongo/json@1` with data types under the Mongo target. Emitter gains `executionHash` for Mongo.
- Framework contract (slice 2): `ExecutionMutationDefault.ref` renamed to `{ namespace, entry, field }`; SQL authoring, validators, runtime, ORM client, emitter, and the 123 fixtures with an execution section regenerated.

## Adapter impact

Mongo target and adapter (codec move, generator registration). Postgres and SQLite adapters change only in slice 3, where their generator registration imports the framework type instead of `@internal/sql-runtime`.

## ADR pointer

ADR 252 and ADR 163 cover the contract source. The codec conventions are ADR 184 and ADR 254. Slice 4 introduces a durable decision, the framework-owned mutation-default runtime with neutral naming, and writes an ADR at close-out.

## Project Definition of Done

Inherits `drive/calibration/dod.md`. Project-specific:

- Every new codec has encode/decode and JSON round-trip tests, a PSL authoring test, and a TS authoring test. The existing Mongo codecs live in the target package and the adapter imports them.
- Red-then-green tests exist for: contract requires a generator no runtime provides; duplicate generator id; optional field with a preset; preset combined with a storage default; empty update payload does not advance `updatedAt`.
- End-to-end on `mongodb-memory-server`: create without `createdAt`, update, read both back with correct values; Prisma 6 shaped collections and indexes, then `contract emit` and `db sign` succeed.
- `pnpm test:packages`, `pnpm test:integration`, `pnpm fixtures:check`, `pnpm lint:deps` green. `architecture.config.json` lists `contract-prisma6`.
- SQL runtime tests unchanged in intent and green after the hoist; `sql-context.ts` no longer contains a generator registry.
- Mongo facade config reference documents `prisma6Schema`; `docs/reference/codec-authoring-guide.md` gains the Mongo codecs; the Mongo authoring reference documents `temporal.*`.
- Close-out: `projects/prisma7-contract-source/slices/02-mongo-source/` and the two "Deferred gaps" entries this project fills are deleted or updated; the ADR for slice 3 is written.

## References

- `design-notes.md`, `plan.md`, `slices/*/spec.md`.
- `projects/prisma7-contract-source/{spec.md,design-notes.md,slices/02-mongo-source/spec.md}`.
- `projects/created-updated-at-authoring/spec.md` for the SQL preset design this project mirrors.
- ADR 163, ADR 252, ADR 184, ADR 254. `docs/reference/codec-authoring-guide.md`.
- [MongoDB upgrade guide](https://www.prisma.io/docs/guides/upgrade-prisma-orm/mongodb).
