# Slice 2: Mongo execution defaults end to end

_Parent: `projects/mongo-defaults-codecs-prisma6-source/`. Builds on slice 1 (PR #30396) and slice 2 (framework ref rename). Outcome: a Mongo author writes `temporal.createdAt()` / `temporal.updatedAt()` and the ORM fills the timestamps on create and on non-empty update, with the same contract, runtime, and error semantics as Postgres._

## At a glance

```prisma
model Post {
  id        ObjectId               @id
  title     String
  createdAt temporal.createdAt()
  updatedAt temporal.updatedAt()
  touchedAt temporal.timestamp(onUpdate: now)
}
```

```ts
const Post = model('Post', {
  fields: {
    title: field.string(),
    createdAt: field.temporal.createdAt(),
    updatedAt: field.temporal.updatedAt(),
  },
});
```

`contract.json` gains:

```json
"execution": {
  "executionHash": "…",
  "mutations": { "defaults": [
    { "ref": { "namespace": "app", "entry": "Post", "field": "createdAt" }, "onCreate": { "kind": "generator", "id": "timestampNow" } },
    { "ref": { "namespace": "app", "entry": "Post", "field": "updatedAt" }, "onCreate": { "kind": "generator", "id": "timestampNow" }, "onUpdate": { "kind": "generator", "id": "timestampNow" } }
  ] }
}
```

`orm.post.create({ data: { title: 'x' } })` writes both timestamps, one `Date` per operation. `update` with a non-empty payload advances `updatedAt`; an empty payload writes nothing. `createdAt` and `updatedAt` are optional on the create input type.

## Chosen design

**Shared authoring primitives move to the framework.** `packages/2-sql/9-family/src/core/timestamp-now-generator.ts` imports only `@internal/framework-components`; its `TIMESTAMP_NOW_GENERATOR_ID`, `timestampNowControlDescriptor`, `temporalAuthoringPresets`, `temporalCodecPreset`, and the `onCreate`/`onUpdate` option arg specs move to `framework-components/src/shared/` (exported through the existing authoring/control export paths). SQL imports them from there; the precision variant `temporalCodecPresetWithPrecision` and the string presets stay in the SQL family. The SQL PSL helpers for preset resolution (`getAuthoringFieldPreset`, the registered-namespace exemption, unknown-preset reporting) move too where they import only framework code; the implementer prefers hoisting over copying and keeps SQL behaviour identical.

**Contract.** The Mongo arktype schema gains `execution?` with the framework ref shape `{ namespace, entry, field }` (slice 2) and the SQL generator-id rule, `'+': 'reject'`. `MongoContract<S>` stays `Contract<S>`; the `entry` is the collection name and `field` the stored field name. `executionHash` is `computeExecutionHash({ target, targetFamily, execution })` from the framework, computed by both authoring paths, sorted by namespace, entry, field. Absent section means no generators; no existing fixture changes.

**Emitter.** The framework emitter already writes `execution` and `executionHash` with the shared ref shape, so nothing changes there. Mongo ORM `CreateInput` makes a field optional when its `ref` has `onCreate`, mirroring `IsOptionalCreateField` in `sql-orm-client/src/types.ts:1265-1304`.

**Authoring registration.** The Mongo target descriptor meta contributes `authoring.field.temporal.{createdAt, updatedAt, timestamp}` built from the hoisted preset builders with `codecId: 'mongo/date@1'`, `nativeType: 'date'`, and `controlMutationDefaults.generatorDescriptors: [timestampNowControlDescriptor()]`. No precision argument exists on Mongo.

**Mongo PSL.** The interpreter resolves `field.typeConstructor` against `authoringContributions.field` before the bare-name scalar lookup, instantiates the preset, and applies its contributions: codec, `executionDefaults`. Diagnostics mirror SQL: `PSL_PRESET_NOT_OPTIONAL` (preset with `?`), `PSL_PRESET_AND_ID_CONFLICT`, `PSL_UNKNOWN_FIELD_PRESET`, `PSL_EXTENSION_NAMESPACE_NOT_COMPOSED`; a preset on a list field is an error. The `@updatedAt` hint changes to "use `temporal.updatedAt()`". The model loop collects `{ ref, onCreate?, onUpdate? }` entries and the interpreter emits `execution` when any exist.

**Mongo TS.** `field.temporal.*` is composed from the target pack's `authoring.field` the way SQL's `composed-authoring-helpers.ts` does, so the same registry entry drives PSL and TS and the two emit byte-identical contracts. The scalar field builder carries `executionDefaults`; a nullable field with `executionDefaults` throws `CONTRACT.DEFAULT_INVALID` with `reason: 'nullable-with-executionDefaults'`. `buildContractFromDefinition` assembles and hashes `execution`.

**Runtime.** `MongoStaticContributions.mutationDefaultGenerators?: () => ReadonlyArray<MongoRuntimeMutationDefaultGenerator>`; `MongoRuntimeMutationDefaultGenerator { id, generate(params?), stability: 'field' | 'row' | 'query' }` declared in `@internal/mongo-runtime` (slice 3 hoists it). `createMongoExecutionContext` collects generators (duplicate id → `RUNTIME.DUPLICATE_MUTATION_DEFAULT_GENERATOR`), asserts every generator the contract requires is present (`RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING`, same message as SQL), and exposes `applyMutationDefaults({ op, namespace, entry, values, defaultValueCache? })` with the SQL semantics: empty update payload applies nothing; explicit values win; `'row'` one value per row per call, `'query'` one per operation via the caller's cache. The `timestampNow` runtime generator (`new Date()`, `stability: 'query'`) lives in `@internal/mongo-runtime` and the adapter's runtime descriptor registers it, as the Postgres adapter registers SQL's.

**ORM.** The ORM package sits below the runtime layer, so it depends on an interface, not the runtime: a `MongoMutationDefaults` interface (in the ORM package or `mongo-contract`) that the execution context satisfies. `mongoOrm({ contract, executor, mutationDefaults })`; the facade's `mongo()` passes the context. `create`, `createAll`, `createAndCount`, and the insert half of `upsert` (`$setOnInsert`) apply `onCreate`; `update`, `updateAll`, `updateAndCount`, and the update half of `upsert` apply `onUpdate` only when the payload is non-empty. One `defaultValueCache` per ORM operation. The returned row includes the generated values.

## Coherence rationale

One feature, one PR: without the runtime the authoring is inert, without the authoring the runtime is unreachable. The framework hoist of preset builders is small and is what makes "same registry entry drives both surfaces and both families" true.

## Scope

In: everything above; docs (`docs/architecture docs/subsystems/10. MongoDB Family.md` execution section; Mongo authoring reference for `temporal.*`; `docs/reference/error-reference.md` if new codes appear); an upgrade-instructions fragment for the `mongoOrm` signature change if the public facade surface changes.

Out: hoisting the runtime registry into the framework and renaming the framework `ref` (slice 3); storage defaults on Mongo; Prisma 6 reader (slice 4); `@default` attribute on Mongo.

## Pre-investigated edge cases

- Mongo PSL and TS hash different storage projections today (`entries.collection` vs `collections`); `executionHash` must be computed from the same canonical `execution` object on both paths so PSL/TS parity holds for the new hash even though storage parity is a pre-existing gap.
- The framework requires `nativeType` on every preset (`resolveAuthoringStorageTypeTemplate` throws otherwise); Mongo uses `'date'`.
- `createAndCount` skips `#stripUndefined` today; defaults must treat an explicit `undefined` the same as absent on every create path.
- Upsert: create defaults go to `$setOnInsert` only for fields not in the update half; update defaults apply only if the update half is non-empty (SQL `upsert` at `sql-orm-client/src/collection.ts:2006-2016`).

## Slice Definition of Done

Inherits `drive/calibration/dod.md`. Slice-specific:

- Red-then-green tests: contract requires a generator no runtime provides; duplicate generator id; preset on an optional field (PSL and TS); preset with `@id`; empty update payload does not advance `updatedAt`; explicit value wins; `createAll` shares one timestamp across rows; upsert create and update halves.
- PSL and TS authoring of the same model emit byte-identical `contract.json` including `executionHash`.
- End to end on `mongodb-memory-server`: emit, apply, create without timestamps, update, read both back; create-input type has both fields optional.
- SQL tests unchanged in intent and green after the preset-builder hoist.

## References

- Project spec and design notes; slice 1 spec.
- SQL template: `packages/2-sql/5-runtime/src/sql-context.ts:586-760`, `packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts:151-408, 562-703`, `psl-field-resolution.ts:553-570, 667-680`, `packages/2-sql/2-authoring/contract-ts/src/{composed-authoring-helpers.ts,build-contract.ts:1025-1057,1169-1175,1602-1653}`, `packages/3-extensions/sql-orm-client/src/{collection.ts:148-175,1578,1724-1781,1929,2006-2016,2243,2303; types.ts:1254-1340}`.
- Framework: `framework-authoring.ts:149-166, 918-975, 1950-1983`, `control-stack.ts:185-318, 500-542`, `contract/src/hashing.ts:88-96`, `emitter/src/{emit.ts,generate-contract-dts.ts:150-153,213-230}`.
- Mongo today: `contract-schema.ts:439-474`, `contract-types.ts:68`, `interpreter.ts:964-1026, 1172-1269, 1528-1594`, `contract-builder.ts:849-893, 1010-1076, 1998-2139, 2211-2258`, `mongo-execution-stack.ts:23-157`, `orm/src/{mongo-orm.ts,collection.ts:352-615,788-856,types.ts:223-268}`, facade `static/mongo-static.ts:43-55`, `runtime/mongo.ts:119-238`.
- Test templates listed in the grounding: `packages/2-sql/5-runtime/test/{mutation-default-generators,sql-context}.test.ts`, `contract-psl/test/interpreter.defaults.preset-misuse.test.ts`, `test/integration/test/sql-orm-client/collection-mutation-defaults.test.ts`.
