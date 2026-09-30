# Slice 1: Mongo target owns its codecs; Int64, Decimal128, Binary, Json

_Parent: `projects/mongo-defaults-codecs-prisma6-source/`. Outcome: the Mongo target and adapter packages are layered like Postgres (adapter depends on target, never the reverse), every Mongo codec lives in the target package, and four new scalar types are usable from PSL and TS._

## At a glance

```prisma
model Post {
  id        ObjectId    @id
  views     Int64
  price     Decimal128
  thumbnail Binary
  meta      Json
}
```

```ts
const Post = model('Post', {
  fields: { views: field.int64(), price: field.decimal128(), thumbnail: field.binary(), meta: field.json() },
});
```

Application types: `Int64` is `bigint`, `Decimal128` is canonical decimal text (`string`), `Binary` is `Uint8Array`, `Json` is `JsonValue`. JSON forms mirror the Postgres `int8`, `numeric`, `bytea`, and `json` codecs: decimal text, canonical decimal text, unwrapped base64, identity.

## Chosen design

**Layering fix first.** ADR 198 states that a target-layer module must not import adapter or driver code, and that the runner receives its dependencies through abstract interfaces. Today `packages/3-mongo-target/1-mongo-target` imports `@internal/adapter-mongo` in `core/control-target.ts`, `core/mongo-runner.ts`, and `core/descriptor-meta.ts`. The fix follows the Postgres runner, which reaches every wire operation through `this.family.*` and never names the adapter package:

- `MongoRunnerDependencies` and `MarkerOperations` move into the family's control-adapter SPI (`packages/2-mongo-family/9-family/src/core/control-adapter.ts`). They already depend only on family-layer types (`@internal/mongo-query-ast`, `@internal/mongo-lowering`, `@internal/contract/types`).
- The `MongoControlAdapter` SPI gains the operation the runner needs to obtain those dependencies for a control driver. The adapter package implements it in `MongoControlAdapterImpl`; the old free function `createMongoRunnerDeps` is deleted.
- The target's `createRunner(family)` obtains the dependencies through the family instance (which resolves the adapter from the control stack), so `1-mongo-target` has no `@internal/adapter-mongo` import and no dependency on it in `package.json`.
- Docs: `docs/architecture docs/subsystems/10. MongoDB Family.md` § Control-plane layering is corrected to describe the shipped shape.

**Codecs move to the target.** `codec-ids.ts`, `codecs.ts` (codecs, `descriptorFor`, descriptors, `mongoDescriptorById`, `buildStandardCodecRegistry`), `data-types.ts`, and the `CodecTypes` map move from `packages/3-mongo-target/2-mongo-adapter/src` into `packages/3-mongo-target/1-mongo-target/src/core`, exported as `./codecs`, `./codec-ids`, `./data-types`, `./codec-types` from the target. The target's existing hand-written `codec-types` is replaced by the single moved map. The adapter imports them, keeps `mongoScalarAuthoringTypes` (Postgres keeps its PSL scalar map in the adapter too), and its descriptor's `types.codecTypes.import` points at `@internal/target-mongo/codec-types`. `bson` becomes a dependency of the target. The adapter's codec subpath exports are removed; the published shell export maps (`packages/0-shared/publish-surface/src/shells.ts`) and `knownInternalNamesInDist` follow. Every emitted `contract.d.ts` fixture and example that imports `@internal/adapter-mongo/codec-types` or `@prisma/orm-mongo/adapter/codec-types` is regenerated through the emitter, never hand-edited. Codec-id literals duplicated in `contract-ts`, `query-builder`, and `marker-ledger-collection.ts` stay as they are; consolidating them is not this slice.

**`architecture.config.json`.** Register the Mongo target's `src/core/**` as shared and `src/exports/control.ts` as migration per `docs/onboarding/Repo-Map-and-Layering.md` § When adding a new target package, so the new layering is enforced rather than merely true.

**Four new codecs**, defined in the target like the existing ones, each with a data type, descriptor, `CodecTypes` entry, PSL name via `mongoScalarAuthoringTypes`, TS builder, and `targetTypes[0]` equal to the BSON type name so `$jsonSchema` validators derive correctly:

| Codec id | Wire (bson) | App type | JSON form | targetTypes | Traits |
|---|---|---|---|---|---|
| `mongo/int64@1` | `Long` | `bigint` | decimal text (`"123"`); safe-integer `number` accepted on the way in, as `pg/int8@1` | `long` | equality, order, numeric |
| `mongo/decimal128@1` | `Decimal128` | `string` (canonical decimal text) | same string | `decimal` | equality, order, numeric |
| `mongo/binary@1` | `Binary` | `Uint8Array` | unwrapped base64 | `binData` | equality |
| `mongo/json@1` | any BSON value | `JsonValue` | identity | none; the validator gives the field the empty schema `{}` (see edge cases) | none |

PSL names: `Int64`, `Decimal128`, `Binary`, `Json`. TS: `field.int64()`, `field.decimal128()`, `field.binary()`, `field.json()`. `renderValueLiteral` for `int64` renders `123n`. Decode of a wrong wire type throws `RUNTIME.DECODE_FAILED` with the target's error factory, so the codecs no longer depend on the adapter's `mongoAdapterError`.

## Coherence rationale

One rule applied to two packages: the target owns what describes its value space, the adapter implements SPIs against it. The reviewer reads the flip, the move, and the additions as one story; each is meaningless without the others in this repo's layering.

## Scope

In: everything above; `docs/reference/codec-authoring-guide.md` gains a Mongo section listing the target-owned codecs; the Mongo PSL and TS authoring references list the four types.

Out: generators, `execution` section, `temporal.*` (slice 2); consolidating duplicated codec-id literals; `mongo/document@1` and `mongo/array@1` as registered codecs; changing `MongoParamRef` or the ORM.

## Pre-investigated edge cases

- `test/integration/test/mongo/interpreter.enum.test.ts` and `packages/3-extensions/mongo/src/config/define-config.ts` import codec ids from the adapter; they move to the target import.
- `packages/2-mongo-family/3-tooling/emitter/test/import-roots.test.ts:60` asserts the published import root `@prisma/orm-target-mongo/adapter/codec-types`; it becomes the target root.
- Amended during D3: the collection validator is closed (`additionalProperties: false`), so a field left out of `properties` rejects every write. A codec the lookup knows that declares no BSON type therefore gets the empty schema `{}` (array of `{}` for lists), which admits any value, and Mongo canonicalisation keeps that empty object under `properties` and as `items`. An unknown codec id is still left out. No existing contract had such a schema, so no hash moves.
- Decimal128 canonical text: `Decimal128.toString()` may print exponents for some values; the JSON form must match the Postgres numeric convention (no exponent) so a PSL default literal compares equal after a round trip. Test both `1E+3` style inputs and plain decimals.

## Slice Definition of Done

Inherits `drive/calibration/dod.md`. Slice-specific:

- `grep -r "@internal/adapter-mongo" packages/3-mongo-target/1-mongo-target/src` returns nothing, enforced by `packages/3-mongo-target/1-mongo-target/test/layering.test.ts`. `pnpm lint:deps` cannot enforce it today because `architecture.config.json` maps target packages to the `extensions` domain, which may import `targets`; see the project plan's open items.
- Upgrade-instructions fragments exist under `upgrade-instructions/pending/` for the removed `adapter/codec*` and `adapter/data-types` import paths and the removed `createMongoRunnerDeps`, and `pnpm check:upgrade-coverage --mode pr` passes.
- Every new codec has wire and JSON round-trip tests, a PSL interpreter test, a TS builder test, and an end-to-end write-then-read test on `mongodb-memory-server`.

## References

- ADR 198; `docs/architecture docs/subsystems/5. Adapters & Targets.md`; `docs/architecture docs/subsystems/10. MongoDB Family.md` § Control-plane layering.
- Postgres template: `packages/3-targets/3-targets/postgres/src/core/{codecs,codec-descriptor,codec-helpers,codec-type-map}.ts`, `packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts`, `packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts`.
- `docs/reference/codec-authoring-guide.md`.
