# Slice 2 grounding survey (read-only, 2026-09-15)

Written by a codebase survey agent before planning; every claim cites a file and line. Treat as of the `prisma7-contract-convert` tip `727a509cfc`.

I have what I need. Writing up.

## 0. Specs and the public guide

Both spec files read. The public guide **was fetchable**: https://www.prisma.io/docs/guides/upgrade-prisma-orm/mongodb confirms the spec's 2026-09-14 correction verbatim — "Prisma ORM 7 has no MongoDB connector, so Prisma ORM 8 is the successor path"; it is a 6→8 port. It covers `@db.ObjectId` → `ObjectId @id @map("_id")`, composite `type` blocks surviving nearly unchanged, index authoring moving from `db push` sync to migration-driven, and `@@discriminator`/`@@base` polymorphism. It does **not** discuss `@@fulltext` or defaults — so the slice's rule rows for those have no public-doc backing and are ours to decide.

---

## 1. The Mongo family's contract shape

**Core contract types** — `packages/2-mongo-family/1-foundation/mongo-contract/src/`:

| Concern | Where |
|---|---|
| Field schema (`type`/`nullable`/`many`/`dict`/`valueSet`, `'+': 'reject'`) | `contract-schema.ts:50-61` |
| Field type: scalar \| valueObject \| union | `contract-schema.ts:20-28` |
| Model definition (`fields`, `storage`, `relations?`, `discriminator?`, `variants?`, `base?`) | `contract-schema.ts:247-256` |
| Relations (`to`, `cardinality` `1:1`/`N:1`/`1:N`, `nullable?`, `on.localFields`/`on.targetFields`) | `contract-schema.ts:220-240` |
| Storage index (`keys[{field,direction}]`, `unique?`, `sparse?`, `expireAfterSeconds?`, `partialFilterExpression?`, `wildcardProjection?`, `collation?`, `weights?`, `default_language?`, `language_override?`) — **no `name`** | `contract-schema.ts:296-310` |
| Collection validator (`jsonSchema`, `validationLevel`, `validationAction`) | `contract-schema.ts:313-319` |
| Namespaces: only `collection` and `valueSet` entity kinds | `entity-kinds.ts:10-20`, `composeMongoEntityKinds` at `:30-46` |
| Namespace id is always `UNBOUND_NAMESPACE_ID` | `default-namespace.ts`, used at `interpreter.ts:274-276` |
| Embedded documents = `valueObjects` (`ContractValueObject`) | `contract-schema.ts:461-463`; built at `interpreter.ts:1364-1381` |
| IR classes (`MongoIndex`, `MongoCollection`, `MongoStorage`, `MongoValueSet`, …) | `src/ir/` |

**Crucially: the Mongo field schema is `'+': 'reject'` and carries no `default`, no `execution`, no `generator` key** (`contract-schema.ts:50-61`). There is no spelling for a storage default or an ORM-side generator on Mongo at all. (The project spec's `contract-schema.ts:444-472` citation has drifted; the rejection is now structural — the key simply does not exist in `RawFieldSchema`.)

**The Mongo PSL interpreter** lives at `packages/2-mongo-family/2-authoring/contract-psl/` (`@internal/mongo-contract-psl`):

- `src/provider.ts:41-108` — `mongoContract(schemaPath, options)`. Single file only (`readFile` at `:67`); no directory/multi-file support, unlike the SQL prisma7 provider.
- `src/interpreter.ts` (1613 lines) — `interpretPslDocumentToMongoContract`.
- `src/mongo-attribute-specs.ts` — the declarative attribute surface it accepts:
  - **model**: `@@map(name)` `:143`, `@@discriminator(field)` `:158`, `@@base(base, value)` `:161`, `@@index(...)` / `@@unique(...)` `:198-218`, `@@textIndex(...)` `:220-231`.
  - **field**: `@id` `:145`, `@unique` `:146`, `@map(name)` `:144`, `@relation(name?, fields?, references?)` `:148-155`. **No `onDelete`/`onUpdate`/`map` on `@relation`.**
  - Anything else on a model or field is `PSL_UNSUPPORTED_MODEL_ATTRIBUTE` / `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` (`interpreter.ts:140-171`), with a bespoke hint for `@updatedAt` at `:123-128`.
- **Types accepted**: whatever the target's authoring type namespace registers. That is exactly six scalars — `packages/3-mongo-target/2-mongo-adapter/src/exports/control.ts:25-35`: `String`, `Int`, `Boolean`, `DateTime`, `ObjectId`, `Float` (codec ids in `.../core/codec-ids.ts`; a `Vector` codec exists but is not in the base namespace). Unknown type → `PSL_UNSUPPORTED_FIELD_TYPE` (`interpreter.ts:1032-1038`).
- `@id` rule: the emitted document must carry `_id` with the ObjectId codec, asserted on the mapped-name-keyed record, not the spelling — `interpreter.ts:1319-1338` (`PSL_MONGO_ID_REQUIRED`). Missing `@id` → `PSL_MISSING_ID_FIELD` `:1313-1318`.
- `namespace` blocks are always rejected — `interpreter.ts:107-121` (`PSL_UNSUPPORTED_NAMESPACE_BLOCK`).
- Composite types: `interpreter.ts:1364-1381`. Note `:1378` uses `fields[field.name]`, not the mapped name — **a `@map` on a composite-type field is parsed, stored in no mapping, and silently ignored**, exactly as the slice spec says.
- Enums: `processEnumDeclarations` `:1048-1099` → the family enum factory at `packages/2-mongo-family/9-family/src/core/authoring-entity-types.ts:14+`. Prisma 8 spells members bare or `NAME = "value"`; Prisma 6 spells `NAME @map("value")`.

**The provider/`ContractConfig` factory `defineConfig` uses**: `packages/3-extensions/mongo/src/config/define-config.ts:38-46` — `contract` is typed `readonly contract: string` (`:15`) and is dispatched on extension: `.ts` → `typescriptContractFromPath`, otherwise `mongoContract(...)`. **It cannot accept a `ContractConfig` today.** The Postgres sibling that already can is `packages/3-extensions/postgres/src/config/define-config.ts:17` (`string | ContractConfig`) with `resolveContractConfig` at `:48-63` — that function is the exact change Mongo needs, including the output-derivation fallback from `source.inputs[0]`.

---

## 2. Unknown top-level blocks — confirmed

**Mongo silently drops them.** `packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts:1150-1152`:

```ts
const topLevelEnumBlocks = Object.values(topLevel.blocks)
  .filter((b) => b.keyword === 'enum')
  .map((b) => b.block);
```

That is the only read of `topLevel.blocks`. `datasource`, `generator`, `view`, and any other generic block are dropped with no diagnostic. The symbol table does not report them either — `packages/1-framework/2-authoring/psl-parser/src/symbol-table.ts:236-252` (`buildBlock`) records every generic block unconditionally. `topLevel.namedTypes` (a `types` block) is likewise never read by the Mongo interpreter.

**SQL reports them, two ways:**
- The Prisma 8 SQL PSL interpreter and the parser: `parseUnsupportedTopLevel` in `packages/1-framework/2-authoring/psl-parser/src/parse.ts:660-670` emits `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK` — but only for declarations the *parser* rejects, not for a well-formed `view { … }`, which `parseGenericBlock` (`:597-621`) accepts.
- The SQL **Prisma 7** interpreter is the parity model: `packages/2-sql/2-authoring/contract-prisma7/src/interpreter.ts:213-255`. A `switch (block.keyword)` keeps `datasource`/`generator`/`enum`, gives `view` its own `PRISMA7_VIEW_UNSUPPORTED` (`:233-242`), and routes everything else — plus `namespaces`, `compositeTypes`, `namedTypes` — through `unsupported()` → `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK` (`:213-220`, `:247-255`).

So the slice-2 diagnostic in the Mongo *Prisma 8* PSL interpreter needs the same `switch` shape, with the twist that Mongo's `type` blocks are legal (composite types) while SQL's are not.

---

## 3. What `db verify` / `db sign` compare for Mongo — **verification item 5 resolved**

**Mongo verify does not compare index names. It cannot: the Mongo contract has no index-name field, and introspection never reads one.**

Evidence chain:

1. `packages/2-mongo-family/3-tooling/mongo-schema-ir/src/schema-index.ts:20-48` — `MongoSchemaIndex` has no `name`. Its `id` is derived from keys: `options.keys.map(k => \`${k.field}:${k.direction}\`).join(',')` (`:36`).
2. `packages/3-mongo-target/2-mongo-adapter/src/core/introspect-schema.ts:35-53` — `parseIndex(doc)` reads `key`, `unique`, `sparse`, `expireAfterSeconds`, `partialFilterExpression`, `wildcardProjection`, `collation`, `weights`, `default_language`, `language_override`. **`doc['name']` is never read.**
3. `packages/2-mongo-family/9-family/src/core/schema-diff.ts:121-138` — `buildIndexLookupKey` matches by keys **plus** every option (unique, sparse, ttl, partial filter, wildcard projection, collation, weights, languages). `:143-186` `diffIndexes` sets `expected` and `live` lookups and reports set differences. `formatIndexName` (`:139-141`) synthesises a display name from keys.
4. `packages/2-mongo-family/1-foundation/mongo-contract/src/contract-schema.ts:296-310` — `MongoStorageIndexSchema` has no `name` key and `'+': 'reject'`, so a name cannot even be authored. (`MongoIndexOptions` in `src/ir/mongo-index-options.ts:13,44,64` *does* carry a `name`, but that is the migration-operation shape, not the contract storage shape, and it never reaches the verifier.)

**Consequence for the slice**: the rule-table row "Verification item 5 decides whether Prisma 7's index names are set" resolves to *no work* — index names are structurally invisible to Mongo verify, so the Prisma 6 source does not need to reproduce Prisma 6's index-naming scheme. This is the opposite of Postgres, where indexes verify by name.

**What Mongo verify *does* compare** (`schema-diff.ts:67-116` `diffMongoSchemas`, entered from `verify-mongo-schema.ts:29-73`):

| Subject | Expected missing from live | Live-only extra |
|---|---|---|
| Collection (by name) `:79-107` | **fail** (both modes) | `strict ? fail : warn` |
| Indexes (by keys+options) `:143-186` | **fail** (both modes) | `strict ? fail : warn` |
| Validator `:188-250` | **fail** (both modes) | `strict ? fail : warn`; mismatch → **fail** |
| Collection options `:252-293` | mismatch → **fail** | `strict ? fail : warn` |

Grading passes through `emitMongoIssueUnderControlPolicy` (`:49-65`) and `verifierDisposition` (`schema-verify/verifier-disposition.ts:29-34`), which classifies by path depth.

Before diffing, `schema-verify/canonicalize-introspection.ts` strips server defaults: text-index `_fts`/`_ftsx` projection back to contract keys (`:230-264`), uniform `weights` (`:277-287`), `'english'`/`'language'` defaults (`:175-182`), collation/timeseries/clusteredIndex sub-fields the contract did not author (`:382-399`), and symmetric `changeStreamPreAndPostImages: {enabled:false}`.

**Introspection reads** (`introspect-schema.ts:102-133`): `db.listCollections()`, skipping `_prisma_migrations` (`:13`, `:111`), `system.*` (`:112`), and `type === 'view'` (`:113`); then `listIndexes()` per collection, dropping the default `_id_` index (`:28-33`, `:116`); then the `$jsonSchema` validator and collection options. **No documents are sampled — field types are never introspected on Mongo.**

**`db sign` runs schema verify in lenient mode**: `packages/1-framework/3-tooling/cli/src/orm/db/sign.ts:330` passes `strict: false`. Family `sign` itself (`packages/2-mongo-family/9-family/src/core/control-instance.ts:281+`) only writes the marker; `verifySchema` is `:266-280`.

### The real slice-2 blocker this uncovers

A Prisma 6 MongoDB database has **no `$jsonSchema` validators** — Prisma 6 `db push` creates indexes and nothing else. But the Mongo PSL interpreter unconditionally derives a validator for every non-variant collection (`interpreter.ts:1504-1534`, via `deriveJsonSchema`), and `diffValidator` grades "expected validator, live has none" as **`fail` in both strict and lenient mode** (`schema-diff.ts:193-206`). So the slice's end-to-end DoD ("`db sign` succeeds against the database Prisma 6 shaped") will fail on the validator, not on anything the rule table covers.

Second, smaller: a Prisma 6 model with no indexes has no collection until first write, and a missing collection is also `fail` in both modes (`schema-diff.ts:83-92`).

Neither has an authoring escape hatch today: `mongoAttributeSpecs.model` has no `@@control` spec, and `mongoContract(...)` never sets `defaultControlPolicy`.

---

## 4. Prisma 6 Mongo constructs → Prisma 8 Mongo

| Prisma 6 | Prisma 8 Mongo equivalent | Evidence |
|---|---|---|
| `@db.ObjectId` | `ObjectId` scalar, codec `mongo/objectId@1`, native `objectId` | `adapter-mongo/src/exports/control.ts:30-33`; `codec-ids.ts:1` |
| `@map("_id")` | `@map` on a field, mapped name keys the emitted record | `interpreter.ts:207-233`, `:1290-1291` |
| `String @id @default(auto()) @map("_id") @db.ObjectId` | `id ObjectId @id @map("_id")`; the `@default(auto())` has no counterpart and must be dropped | id assertion `interpreter.ts:1325-1338` |
| `@id` | field `@id` spec (arg-less) | `mongo-attribute-specs.ts:145` |
| Composite `type` blocks (embedded documents) | `valueObjects` / `ContractValueObject` | `interpreter.ts:999-1005`, `:1364-1381` |
| `Json` | **none** — no codec, no scalar | not in `mongoScalarAuthoringTypes` |
| `Bytes` | **none** | ditto; deferred gap "BSON binary" |
| `Decimal` | **none** | ditto; deferred gap "Decimal128" |
| `BigInt` | **none** | ditto; deferred gap "Int64" |
| `DateTime` | `DateTime`, codec `mongo/date@1`, native `date` | `control.ts:29` |
| `@updatedAt` | **none** — explicit hint text already written for it | `interpreter.ts:123-128` |
| `@default(now())`, `@default(uuid())`, `@default(cuid())`, any `@default` | **none** — no `default` or `execution` key on the Mongo field schema, and no `default` field-attribute spec | `contract-schema.ts:50-57`; `mongo-attribute-specs.ts:256-261` |
| Scalar lists (`String[]`) | `many: true` | `interpreter.ts:1004`, `:1022`, `:1045` |
| `enum` | Mongo enum, codec from `@@type` or `enumInferenceCodecs` | `interpreter.ts:1048-1099`; `authoring-entity-types.ts:14+`; text/int defaults wired at `define-config.ts:45` |
| enum member `@map("x")` | Prisma 8 spells `NAME = "x"`; the parser now reads Prisma 6 entry attributes (commit `ba73d4878a`, `parse.ts:703-704`) so the value is reachable, but the Mongo enum factory reads `block.parameters`, not attributes — the prisma6 interpreter must read `block.node.entries()`/`entry.attributes()` itself, as SQL does at `contract-prisma7/src/interpreter.ts:581-601` |
| `@@index([...])` | `@@index` → `MongoIndex` | `mongo-attribute-specs.ts:198-218`; `interpreter.ts:917-972` |
| `@unique` / `@@unique` | unique `MongoIndex` | `interpreter.ts:894-915` (field), `:953-966` (model) |
| `@@fulltext([...])` | `@@textIndex([...])` | `mongo-attribute-specs.ts:220-231`; `buildTextIndex` `interpreter.ts:841-875` |
| `@relation(fields, references)` | `ContractReferenceRelation` with `on.localFields`/`on.targetFields` | `interpreter.ts:1234-1274`; back-relations `:1394-1448` |
| `@relation(onDelete:/onUpdate:/map:)` | **none** — the relation spec has only `name`/`fields`/`references`; extra named args fail the spec | `mongo-attribute-specs.ts:148-155` |
| `relationMode` | no Mongo handling exists; the SQL prisma7 source rejects `relationMode = "prisma"` at `contract-prisma7/src/interpreter.ts:430-439` — Mongo needs an equivalent datasource read, which the Mongo interpreter has none of today |
| `@ignore` / `@@ignore` | **none** in Mongo PSL (both become `PSL_UNSUPPORTED_*_ATTRIBUTE`); the omit-semantics to copy are `contract-prisma7/src/interpreter.ts:489` (model) and `:694-697` (field) |
| `@@id([...])` composite | **none** — Mongo requires `_id` ObjectId | `interpreter.ts:1325-1338` |
| `@@schema` | **none** — namespace blocks rejected outright | `interpreter.ts:107-121` |
| `view` | **none** — silently dropped today (§2); introspection also skips views (`introspect-schema.ts:113`) |
| `@@map` / `@map` | direct; collection name is `@@map` or `lowerFirst(modelName)` | `resolveCollectionName` `interpreter.ts:235-255` |

Note the collection-name default: Prisma 8 Mongo uses `lowerFirst(model.name)` (`interpreter.ts:254`), **Prisma 6 uses the model name verbatim**. The slice spec already calls this out; it means a Prisma 6 model with no `@@map` needs the verbatim name, not the family default.

---

## 5. Mongo test infrastructure

- **Rule**: `.agents/rules/mongodb-memory-server-setup.mdc` — MMS pinned via `pnpm-workspace.yaml` `catalog:` (never a `^` range, because version drift corrupts the shared `~/.cache/mongodb-binaries/`); every consuming package's `vitest.config.ts` must set `testTimeout`/`hookTimeout` to `timeouts.spinUpMongoMemoryServer` and `fileParallelism: false`; four-step checklist for a new package at the end.
- **Consumers today** (`grep mongodb-memory-server` over `package.json`): `test/integration`, `packages/3-mongo-target/{1,2,3}`, `packages/3-extensions/mongo`, `packages/2-mongo-family/{5-query-builders/orm,7-runtime}`, and four examples. A new `packages/2-mongo-family/2-authoring/contract-prisma7` would be the first *authoring* package to need it, if it wants an in-package integration test — the SQL sibling keeps integration out of the package (`contract-prisma7/test/` is all fixture-driven unit tests).
- **Generic harness**: `test/integration/test/_harness/mongo.ts` — starts `MongoMemoryReplSet` (wiredTiger, single node), builds a control stack from the real descriptors (`:66-75`), `pushContract()` runs the real plan→apply path with `allowedOperationClasses: ['additive']` (`:77-125`), then yields `{ db, client, mongoDb, contract }` and drops the database.
- **Lighter harness**: `test/integration/test/mongo/setup.ts` — `withMongod()` (`:15-46`) and `describeWithMongoDB()` (`:56+`), runtime-only, no control stack.
- **Verify/sign integration**: `test/integration/test/mongo/db-verify-sign.test.ts`; CLI e2e: `test/integration/test/cli.mongo-db-sign.e2e.test.ts` (hand-built `MongoContract` literal at `:19-58`, contract.json written to disk at `:60-66`, db-ref pointer read at `:68-72`), plus `cli.mongo-db-verify.e2e.test.ts`, `cli.mongo-db-schema.e2e.test.ts`, `cli.control-policy.mongo.e2e.test.ts`.
- **Mongo CLI journey**: `test/integration/test/cli-journeys/mongo-migration.e2e.test.ts` — the only Mongo journey, migration-authoring focused. The journey to mirror in shape is `test/integration/test/cli-journeys/prisma7-source.e2e.test.ts` (writes a `prisma.config.ts`, runs `runContractEmit`/`runDbSign`/`runDbVerify` from `../utils/journey-test-helpers`, asserts exit 0 and zero findings, plus a negative `view` case that writes nothing).
- **Existing Prisma 6 Mongo fixture: none.** `grep -rl 'provider = "mongodb"' --include='*.prisma'` returns nothing outside `node_modules`. The Postgres precedent to copy is `test/integration/test/fixtures/prisma7-source/{reference,supported,supported-verify,relations}/`, each with a `schema.prisma`, a `README.md`, and a `migration.sql` generated by real `prisma@7.10.0`. **The Mongo analogue has no `migration.sql` equivalent** — Prisma 6 Mongo has no migration files, so the fixture must instead record the `createIndex` calls `db push` issues, or be built by actually running Prisma 6 `db push` against MMS.

---

## 6. `prisma7Schema` structure: family-neutral vs SQL-specific

`packages/2-sql/2-authoring/contract-prisma7/src/`:

| File | Lines | Verdict |
|---|---|---|
| `provider.ts` | 164 | **Mostly neutral.** `listSchemaFiles` (`:75-87`, recursive `.prisma` directory read), `mapParseDiagnostics` (`:50-61`), the per-file read/parse loop (`:114-137`), and `PRISMA7_SCHEMA_READ_FAILED` are all family-free. SQL-specific: the `Prisma7SchemaOptions` payload (`:17-44`: `target`, `createNamespace`, `nativeEnum`, `typeMap`, `updatedAt`) and `applySqlSpecifierControlPolicy` (`:154-158`). |
| `interpreter.ts` | 917 | Mixed. Neutral in *shape*: the top-level block `switch` (`:213-255`), cross-file `claimName` duplicate detection (`:184-197`), `stringArgument`/`requireStringArgument` (`:147-154`, `:534-550`), `readEnumDeclaration`'s member + `@map` reading (`:552-605`), `@ignore`/`@@ignore` omission (`:489`, `:694-697`), the per-attribute dispatch skeleton (`:706-734`). SQL-specific: everything from `:759` on (native types, `resolveFieldTypeDescriptor`, `buildSqlContractFromDefinition`, namespaces/schemas, junction tables). |
| `defaults.ts` | 275 | **Entirely SQL-specific** and entirely dead weight for Mongo — Mongo rejects all defaults. |
| `indexes.ts` | 143 | SQL-specific (`INDEX_TYPES` btree/hash/gin/…, `IndexNode` from `sql-contract-ts`), but `parseIndexAttribute`'s argument walk (`:26-`) is the model for Mongo's `@@index`/`@@unique`/`@@fulltext` parsing. |
| `relations.ts` | 582 | SQL-specific (foreign keys, implicit m2m junctions). Mongo needs relation *pairing* logic but no FK/junction machinery; the Mongo PSL interpreter already has its own back-relation matcher at `interpreter.ts:1383-1448` with shared helpers `fkRelationPairKey`/`consumeInvalidFkPairing`/`requiredOneToOneBackrelationDiagnostic` imported from `@internal/psl-parser/interpret`. |
| `diagnostics.ts` | 28 | **Neutral mechanism, SQL-specific code list.** `prisma7Diagnostic(code, message, sourceId, span)` is family-free; the `Prisma7DiagnosticCode` union (`:4-19`) mixes shared codes (`PROVIDER_MISMATCH`, `VIEW_UNSUPPORTED`, `SCHEMA_READ_FAILED`, `UNKNOWN_ATTRIBUTE`, `UNSUPPORTED_TYPE`) with SQL-only ones (`NATIVE_TYPE_UNSUPPORTED`, `JUNCTION_ID_UNSUPPORTED`, `TABLE_COLLISION`, `ENUM_NAMESPACE_MISMATCH`). |

**Already shared, already family-neutral, already in `packages/1-framework`**: the parser additions from slice 1 — `view` bodies parsed with the model grammar and enum-member `@` attributes (`packages/1-framework/2-authoring/psl-parser/src/parse.ts:697-705`, commits `ba73d4878a`, `2f78c8f692`). Mongo gets these for free with no new framework changes.

**Candidate for sharing without family vocabulary**: a small `@internal/psl-parser/interpret`-adjacent helper module (that package already hosts `fkRelationPairKey`, `consumeInvalidFkPairing`, `requiredOneToOneBackrelationDiagnostic`, `withSeedDiagnostics`) carrying: multi-file listing + read + parse + seed diagnostics, `claimName`, `stringArgument`/`requireStringArgument`, the `PRISMA7_` diagnostic constructor, and the enum-block/member reader. None of those name a table, column, collection, or codec. The `options`-bag-parameterised factory pattern (`prisma7Schema(path, options)` in the family package, a thin per-target facade in the extension — `packages/3-extensions/postgres/src/config/prisma7-schema.ts`) is the layering to copy exactly.

---

## 7. Mongo target descriptor: `printPslContract` / `inferPslContract`

**Neither exists for Mongo. There is no scaffolding of any kind.**

- `packages/2-mongo-family/9-family/src/core/control-target-descriptor.ts` is 26 lines total and declares exactly two SPI properties: `contractSerializer` and `schemaVerifier` (`:24-25`). No PSL hooks, no mention of PSL.
- `packages/2-mongo-family/9-family/src/core/control-instance.ts` (392 lines) contains no `Psl`/`psl` token at all — no `inferPslContract`, no `printPslContract`, no throw path for their absence.
- The SQL side has both, on the descriptor as optional hooks: `packages/2-sql/9-family/src/core/control-target-descriptor.ts:61-64` (`inferPslContract`, whose doc comment explicitly says *"targets without `contract infer` (Mongo) omit it"*) and `:72` (`printPslContract`, added this branch for slice 3). The family instance surfaces them at `packages/2-sql/9-family/src/core/control-instance.ts:284-286`, reads them at `:587-592`, and throws `CONTRACT.CONVERT_UNSUPPORTED` / an infer-unsupported error at `:1012-1035`.
- The framework capability probes are family-neutral and already exist: `packages/1-framework/1-core/framework-components/src/control/control-capabilities.ts:44` and `:61`. The CLI delegates through `packages/1-framework/3-tooling/cli/src/control-api/client.ts:584-597`, returning `undefined` when the family instance lacks the method — so `contract convert` on a Mongo project today takes the "family instance does not implement it" path, not a Mongo-specific error.

So `contract convert` for Mongo (slice 3's scope, but its Mongo half) is entirely greenfield: the descriptor interface, the family-instance method + throw path, and the printer itself.

---

## Prisma 6 Mongo constructs with **no** Prisma 8 Mongo spelling or codec — candidate hard errors

1. `Json` — no codec, no scalar type. (`PRISMA7_MONGO_TYPE_UNSUPPORTED`)
2. `Bytes` — no BSON-binary codec. Deferred gap.
3. `Decimal` — no Decimal128 codec. Deferred gap.
4. `BigInt` — no Int64 codec. Deferred gap.
5. **Every `@default(...)`** on every field, including `now()`, `uuid()`, `cuid()`, `dbgenerated()`, and literals — no `default` key on the Mongo field schema, no `default` field-attribute spec. (`PRISMA7_MONGO_DEFAULT_UNSUPPORTED`)
6. `@default(auto())` on the id — same, but the slice correctly wants it *accepted and dropped*, since Mongo assigns `_id` itself.
7. `@updatedAt` — no generator machinery on Mongo at all (the runtime generator stack lives only in `packages/2-sql/5-runtime/src/sql-context.ts`).
8. `@relation(onDelete:)` / `onUpdate:` / `map:` — the Mongo relation spec has three args and no referential actions. (`PRISMA7_MONGO_REFERENTIAL_ACTION_UNSUPPORTED`)
9. `@@id([...])` composite — Mongo requires an ObjectId `_id`. (`PRISMA7_MONGO_COMPOSITE_ID_UNSUPPORTED`)
10. `@@schema` / any namespace — rejected outright. (`PRISMA7_MONGO_SCHEMA_UNSUPPORTED`)
11. `view` — no node, dropped by introspection. (`PRISMA7_VIEW_UNSUPPORTED`)
12. `@map` on a composite-type field — parsed, then silently discarded. (`PRISMA7_MONGO_COMPOSITE_MAP_UNSUPPORTED`)
13. `@ignore` / `@@ignore` — no Mongo attribute spec; the slice wants omit semantics, which means new interpreter code, not a passthrough.
14. `relationMode = "prisma"` — no Mongo handling; note that for Mongo, `relationMode = "prisma"` is the *only* legal value in Prisma 6, so a blanket rejection (as SQL does) would reject every Mongo schema. **This row needs inverting relative to the SQL source.**
15. **`Unsupported(...)`** — not in the slice spec at all, but legal in Prisma 6 Mongo schemas and has no Mongo codec.

## Open design questions the slice spec does not settle

1. **The validator gap (the biggest one).** The interpreter derives a `$jsonSchema` validator for every collection (`interpreter.ts:1504-1534`); a Prisma 6 database has none; `diffValidator` fails in lenient mode too (`schema-diff.ts:193-206`). The slice DoD — "`contract emit` and `db sign` succeed against the database Prisma 6 shaped" — cannot be met without one of: suppressing validator derivation for prisma6-sourced contracts, softening "expected validator, live absent" to a lenient warning, or adding a per-collection/default control policy the Prisma 6 source sets. The spec does not mention validators at all.
2. **Empty collections.** A Prisma 6 model with no indexes has no collection until first write; missing collection is `fail` in both modes (`schema-diff.ts:83-92`). Same three-way choice.
3. **`relationMode`.** Prisma 6 Mongo *always* uses `relationMode = "prisma"` (there are no database FKs). The SQL source rejects that value; Mongo must accept it (and probably must accept a *missing* datasource `relationMode` too). Unstated.
4. **Collection-name default.** Prisma 8 Mongo defaults to `lowerFirst(modelName)`; Prisma 6 uses the model name verbatim. The spec's rule row says "the model name verbatim", which means the prisma6 interpreter must *not* reuse `resolveCollectionName`. Worth stating that the resulting contract therefore differs from what the same PSL would produce through the Prisma 8 path — and what that means for the round-trip hash-equality requirement in slice 3.
5. **Factory naming.** The spec leaves `prisma7Schema` vs a `prisma6Schema` alias explicitly open, "unless the plan finds that confusing". Reading a Prisma 6 schema through a function named `prisma7Schema`, from a guide that says Prisma 7 has no Mongo connector, is confusing; a decision is owed.
6. **Multi-file.** The project's cross-cutting requirement 6 (a directory reads every `.prisma` file) is inherited, but `mongoContract` is single-file (`provider.ts:59-67`), so the Mongo prisma6 provider needs `listSchemaFiles` and the cross-file `claimName` duplicate detection lifted from SQL. The slice spec says "shaped like the Mongo `contract-psl`", which would silently drop this.
7. **Enum member `@map`.** The parser reads the attribute, but the Mongo enum factory reads `block.parameters` only. Does the prisma6 interpreter build its own enum declarations (SQL's approach, `contract-prisma7/src/interpreter.ts:552-605`) and bypass `mongoFamilyEnumEntityDescriptor`, or does it synthesise a `PslExtensionBlock` with `@map` values folded into `parameters` (SQL's `lowerNativeEnums`, `:645-659`)? Unstated, and it determines whether the enum codec-id inference path is reachable.
8. **Where the shared prisma6/7 machinery lives.** Requirement 4 forbids family vocabulary in `packages/1-framework`, but the neutral half of §6 is real and duplicating ~300 lines is the alternative. The spec does not name a home.
9. **`@@fulltext` weights/language.** Prisma 6's `@@fulltext` takes no weights; Prisma 8's `@@textIndex` accepts `weights`/`language`/`languageOverride`, and `canonicalize-introspection.ts:171-182` strips server defaults only when the contract authored nothing. Mapping `@@fulltext` to a bare `@@textIndex` is almost certainly right, but it is untested and unstated.
10. **Where slice 2's end-to-end fixture comes from.** Postgres got a real `migration.sql` from `prisma@7.10.0`. Mongo has no migration artefact — the fixture is either a recorded list of `createIndex` calls or a live Prisma 6 `db push` against MMS, and requirement "No Prisma 7 packages in the product" would have to be read as permitting `prisma@6` as a *test* devDependency (as slice 4's example app does for Prisma 7).