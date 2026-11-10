# Grounding: `$jsonSchema` validators for TypeScript-authored MongoDB contracts

Read-only investigation. Paths are repo-relative. No tests were run.

## 1. The gap is real

- PSL: the interpreter sets `coll['validator']` for every non-variant model's collection (`packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts:1703-1733`), then passes it into `buildMongoStorage`, which computes the storage hash (`interpreter.ts:1737-1751`).
- TypeScript: `buildCollections` writes only `indexes`, `options` and `control` (`packages/2-mongo-family/2-authoring/contract-ts/src/contract-builder.ts:2395-2416`). `defineContract` hashes that body (`contract-builder.ts:2553-2606`). There is no validator anywhere in `contract-ts/src`.
- Committed emitted output confirms it:
  - TS-authored `test/integration/test/mongo/fixtures/generated/contract.json`: `tasks` has only `kind`; `users` has `indexes`, `kind`, `options`.
  - TS-authored `examples/bundle-size/src/mongo/generated/contract.json`: `notes` has only `kind`.
  - PSL-authored `test/integration/test/mongo/temporal-presets/_fixture/generated/contract.json`: every collection has `kind` and `validator`.
- Side-by-side fixture `test/integration/test/authoring/side-by-side/mongo/` builds the same schema both ways. The test strips `validator` and `storageHash` before comparing (`test/integration/test/authoring/side-by-side-contracts.test.ts:273-292`, `306-327`). Everything else is equal, so the validator is the only storage difference. The stripping exists since commit `3d9d8bf1e9` (2026-04-10).
- The consequence for renames: a self-edge (`from === to`) migration is refused unless it runs a data transform (`packages/1-framework/3-tooling/migration/src/errors.ts:218-226`); `migration new` reports `MIGRATION.NO_CHANGES` (`packages/1-framework/3-tooling/cli/src/control-api/operations/migration-new.ts:189-190`).

## 2. How PSL derives the validator

- Code: `packages/2-mongo-family/2-authoring/contract-psl/src/derive-json-schema.ts` (196 lines). Two exports: `deriveJsonSchema` and `derivePolymorphicJsonSchema`.
- Inputs are all contract-level, not PSL-level:
  - domain fields (`ContractField` from `@internal/contract/types`), including `nullable`, `many` (with `elementNullable`), scalar `codecId`, `valueSet`, and value-object references;
  - `MongoTypeLookups` = codec lookup (`descriptorFor`) + data type lookup (`get`), defined in `packages/2-mongo-family/1-foundation/mongo-contract/src/mongo-data-type.ts:38-55`. `bsonTypesOfCodec` reads `bsonTypes` from the codec's data type;
  - value objects (`ContractValueObject`), recursed into as nested closed objects;
  - storage value sets (for the `enum` keyword);
  - for polymorphism: base fields, discriminator field name, and per-variant `{ discriminatorValue, fields }`, producing `oneOf` branches.
- Behaviour: every object level is closed (`additionalProperties: false`); non-nullable fields go in `required`; an empty `bsonTypes` list (`Bson`) means "any value"; a codec with no Mongo data type returns `undefined` and the field is left out of `properties`. Level and action are fixed: `strict` / `error` (`derive-json-schema.ts:128-132`, `191-195`).
- Imports: only `@internal/contract/types` and `@internal/mongo-contract`. No PSL AST, no diagnostics.
- The per-collection loop (pick base models, build variant entries, choose plain or polymorphic) lives in the PSL interpreter (`interpreter.ts:1703-1733`). It reads only the resolved domain models (`base`, `discriminator`, `variants`, `fields`, `storage.collection`). It is also surface-neutral.
- Current callers: the PSL interpreter, its tests, and `packages/3-extensions/mongo/test/mongo.enum.e2e.test.ts:10` (through the `@internal/mongo-contract-psl` export).
- Where it can live:
  - `@internal/mongo-contract` (`packages/2-mongo-family/1-foundation/mongo-contract`) is layer `foundation`, plane `shared` (`architecture.config.json:676-680`). It already owns `MongoValidator`, `bsonTypesOfCodec` and `buildMongoStorage`. Both authoring packages already depend on it. This is the right home.
  - `9-family` is not possible: authoring (`shared` plane, lower layer) cannot import it.
  - `contract-ts` is possible (`contract-psl` already depends on `@internal/mongo-contract-ts`), but it would make the TS builder the owner of a rule both surfaces share.

## 3. Is the omission deliberate?

- No ADR, doc or commit gives a reason. The original plan (`9d07bdb93f`, `projects/mongo-schema-migrations/plan.md`) said "Emitter: auto-derive `$jsonSchema` from model fields". The work landed as "PSL authoring + emitter" (`92d9841fef`, `9e1f160aeb`), and the TS builder was never wired. Closing the validators (`48f2f73a5e`, TML-2730) again touched only PSL.
- The gap is known and has been documented as behaviour since then:
  - `skills/prisma-8/references/contract.md:313`: "A TypeScript Mongo contract has no collection validator and accepts these enums."
  - Shipped upgrade instructions tell users to use a TS contract as a workaround: `upgrade-instructions/releases/8.0.0-rc.16-to-8.0.0-rc.17/sources/enum-members-hold-read-values/app/instructions.md:19` and `:78` ("author the enum ... in a TypeScript contract, which carries no collection validator"). Same wording in `skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.16-to-8.0.0-rc.17/instructions.md`.
  - `upgrade-instructions/releases/8.0.0-rc.12-to-8.0.0-rc.13/sources/mongo-json-and-bson/app/instructions.md:39` and `:46` describe the TS case as having no validator.
  - `test/integration/test/cli-journeys/delete-statements-migration.mongo.e2e.test.ts:84` switched to a PSL project because TS fixtures emit no validator (also `wip/beowulf-40-handbacks.txt:2117`).
- The Prisma 6 reader omits validators on purpose: `packages/2-mongo-family/2-authoring/contract-prisma6/README.md:9` ("Prisma 6 databases have none"). Its parity test strips them (`contract-prisma6/test/parity.test.ts:24-60`).
- No opt-out exists on either surface. Level and action are hard-coded. `validationLevel: 'off'` is not in the type (`mongo-contract/src/ir/mongo-validator.ts:3-4`).

## 4. Blast radius

TS-authored MongoDB contracts whose `contract.json` and storage hash would change:

- Committed emitted fixtures (checked by `pnpm fixtures:check` / `emit:check`):
  - `examples/bundle-size/src/mongo/generated/contract.{json,d.ts}`
  - `test/integration/test/mongo/fixtures/generated/contract.{json,d.ts}` (emitted with `|| true` in `test/integration/package.json:7`)
- TS contracts emitted at test time (no committed JSON, but assertions may change):
  - `test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/mongo-cli-journeys/contract-*.ts` (used by `cli-journeys/mongo-migration.e2e.test.ts`, `mongo-db-update-consent.e2e.test.ts`, `delete-statements-migration.mongo.e2e.test.ts`). `mongo-migration.e2e.test.ts:235-238` asserts every op is `additive`; the first plan will now also create each collection with its validator.
  - `test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/control-policy/mongo/contract.ts` (used by `cli.control-policy.mongo.e2e.test.ts`). `tolerated`, `external` and `observed` collections gain an expected validator, so verify outcomes may change.
  - `test/integration/test/fixtures/cli/cli-integration-test-app/fixtures/emit-command/contract.mongo.ts` (`cli.emit-command.test.ts`).
  - `test/integration/test/contract-space-fixture-mongo/contract.ts`, `test/integration/test/mongo-runtime/query-builder.test.ts`, `test/integration/test/enum-members/enum-members.mongo-ts.test.ts`, `test/integration/test/authoring/mongo-pack-composition.test.ts`, `test/integration/test/ports/engines/queries/data_types/enum_type/enum_type.test.ts`, `packages/1-framework/3-tooling/cli/test/control-api/contract-space-seed-phase.mongo.test.ts`.
- Unit tests in `packages/2-mongo-family/2-authoring/contract-ts/test/`:
  - `contract-builder.storage-hash-pin.test.ts` pins a hash; it changes.
  - `contract-builder.dsl.test.ts:90-91, 307` assert collections equal `{ kind: 'mongo-collection' }`.
  - Many tests use fake target packs with no codecs or data types (for example `storage-hash-pin.test.ts:13-20`). With today's derivation every field would be dropped and the validator would be a closed empty object.
- Side-by-side test: the validator strip can be removed, which is the parity check we want (`side-by-side-contracts.test.ts:273-327`).
- Prisma 6 reader: produces no validator by design and stays that way; its parity test keeps stripping.
- `contract infer`: Postgres only (`packages/3-targets/3-targets/postgres/src/core/psl-infer/`). No MongoDB infer exists.
- Examples: `mongo-demo`, `mongo-blog-leaderboard`, `retail-store` are PSL; they do not change.

Three behaviours the TS builder would need that PSL already has:

- **`_id` requirement.** PSL refuses a model without an `objectId` `_id` (`PSL_MONGO_ID_REQUIRED`, `interpreter.ts:1563-1580`). The TS builder has no such rule. A closed validator for a model without `_id` rejects every insert, because MongoDB adds `_id`. Several TS unit-test models have no `_id`.
- **Enums the validator cannot list.** PSL refuses enums whose codec stores a BSON type JSON cannot represent, or non-finite doubles (`packages/2-mongo-family/9-family/src/core/authoring-entity-types.ts:113, 151`). That check is in `9-family`, which the TS builder cannot import. Without it, a TS enum over `mongo/int64@1` would get a validator that refuses every write, which is exactly the bug rc.17 fixed for PSL.
- **Complete lookups.** The TS builder builds its codec lookup from the target only (`contract-builder.ts:2563`). PSL gets codec and data type lookups from the full control stack (`contract-psl/src/provider.ts:45-46`). The target pack carries both codecs and `dataTypes` (`packages/3-mongo-target/1-mongo-target/src/core/descriptor-meta-runtime.ts:22-27`); the adapter and family contribute none. Extension packs must be included, or an extension-typed field is dropped and then rejected by `additionalProperties: false`.

## 5. What changes for an existing user of a TS contract

- After upgrading and re-emitting, the storage hash changes. The runtime marker check warns once per runtime (`verifyMarker: 'onFirstUse'`).
- `db verify` fails: a validator the contract declares but the database lacks is a `fail` issue (`packages/2-mongo-family/9-family/src/core/schema-diff.ts:198-212`), subject to the collection's control policy.
- `migration plan` / `db update` plan one `collMod` per existing collection, id `validator.<coll>.add`, class `widening` (`packages/3-mongo-target/1-mongo-target/src/core/migrations/mongo-planner.ts:439-460`; ADR 195 note dated 2026-10-07). `db init` refuses when a collection holds data and needs a validator, and points at `db update` (`test/integration/test/cli-journeys/mongo-db-update-consent.e2e.test.ts:178-204`).
- Existing documents: MongoDB does not check existing documents when `collMod` sets a validator. With `validationLevel: 'strict'` and `validationAction: 'error'`, every later insert, and every update to any document, must produce a valid document. A stored document that does not match (a missing required field, a wrong BSON type, or any extra field, because the schema is closed) can no longer be updated unless the update makes it valid. Writes from other applications that add fields outside the contract start failing. This is the main user risk, and it is larger for TS users, who have run with an open schema until now.
- Precedent for upgrade instructions:
  - `skills/upgrade/prisma-next-upgrade/upgrades/0.11-to-0.12/instructions.md`, change `re-emit-closed-mongo-contracts`: re-emit, then apply the validator migration with `db update`.
  - ADR 258 (`docs/architecture docs/adrs/ADR 258 - List cardinality has independent container and element nullability.md:104`): re-emit, then apply a new validator migration; runtime deployment alone does not change stored validators.
  - Current location for new instructions: `upgrade-instructions/pending/<change>/app/instructions.md` (see `upgrade-instructions/pending/`).

## 6. Size

One PR is possible but heavy. It would contain: moving the derivation and the per-collection loop to `@internal/mongo-contract`; moving the enum-listability check down from `9-family`; adding an `_id` rule to the TS builder; building full lookups in the TS builder; regenerating two committed fixtures; updating TS unit tests and several e2e assertions; removing the side-by-side strip; upgrade instructions; and correcting `skills/prisma-8/references/contract.md:313` plus the advice in shipped rc.17 instructions (a new pending note, since shipped notes do not change). The e2e changes (control policy, mongo migration journeys) are the least predictable part.

A clean split is two PRs:

1. Move `derive-json-schema.ts`, the per-collection loop and the enum-listability check to `@internal/mongo-contract`. PSL calls them. No output change, so no fixture change.
2. The TS builder calls them, adds the `_id` rule, builds lookups from target plus extensions, regenerates fixtures, updates tests, and adds upgrade instructions.

## Design questions and recommendations

1. **Where does the derivation live?** Recommend `@internal/mongo-contract`, as one function taking domain models, value objects, value sets and `MongoTypeLookups`, returning validators per collection. Both surfaces call it.
2. **Should the TS builder require an `objectId` `_id`?** Recommend yes, with the same rule as PSL, raised as a contract error. The alternative (always allow `_id` in the schema) would make the two surfaces differ again.
3. **What happens when a field's codec has no Mongo data type?** Today the field is silently dropped, then rejected by the closed schema. Recommend making it an error in the shared function. This also forces TS unit tests with fake packs to use the real target pack, or a pack with data types.
4. **Enums the validator cannot list.** Recommend moving the check to the shared package and applying it on both surfaces. Write a pending upgrade note that withdraws the rc.17 "use a TypeScript contract" workaround.
5. **Opt-out (`validator: false` or `validationLevel: 'moderate'`)?** Recommend no opt-out in this change. Neither surface has one. Adding one to TS only would recreate the asymmetry. If users need it, add it to both surfaces later.
6. **Prisma 6 reader?** Recommend leaving it without validators. Its README states the reason, and it describes an existing Prisma 6 database.
7. **One PR or two?** Recommend two: a no-output-change move first, then the TS behaviour change with fixtures and upgrade instructions.
