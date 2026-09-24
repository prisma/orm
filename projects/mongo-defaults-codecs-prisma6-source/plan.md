# Project plan — mongo-defaults-codecs-prisma6-source

**Spec:** `spec.md`. Linear Project: not yet created (no tracker access in the shaping session). Working branch: `worktree/prisma-mongo-defaults-codecs-439e71`.

## Slices

### 1. Mongo codecs in the target, plus Int64, Decimal128, Binary, Json

Outcome: all Mongo codecs, data types, ids, and descriptors live in `packages/3-mongo-target/1-mongo-target`; the adapter imports and registers them. Four new codecs with PSL scalar names (`Int64`, `Decimal128`, `Binary`, `Json`) and TS builders (`field.int64()`, `field.decimal128()`, `field.binary()`, `field.json()`). Round-trip tests for wire and JSON forms.

Builds on: nothing. Hands to: a single codec home for slice 2's date preset to reference, and the scalar names slice 4 maps `BigInt`, `Decimal`, `Bytes`, `Json` onto.

### 2. Mongo execution defaults end to end

Outcome: Mongo contract accepts an optional `execution` section with `executionHash`; Mongo runtime holds a generator registry with the missing-generator and duplicate-id checks; `timestampNow` generator registered by the Mongo target; `temporal.*` presets in Mongo PSL and TS via the framework preset machinery; ORM create and update paths apply defaults with `'row'` and `'query'` stability and the empty-payload rule; emitter marks generated fields optional on create input and writes `executionHash`. End-to-end test on `mongodb-memory-server`.

Builds on: slice 1 (codec home). Hands to: a working Mongo generator runtime for slice 3 to hoist, and `temporal.*` for slice 4 to map `@updatedAt` and `@default(now())` onto.

### 3. Hoist the generator runtime into the framework

Outcome: registry, checks, and apply loop live once in `framework-components/src/execution/` with neutral names (`{ namespace, model, field }` or equivalent); `ExecutionMutationDefault.ref` in the framework contract renamed; SQL runtime, SQL authoring, validators, emitter, and fixtures migrated; Mongo runtime imports the framework code and its local copy is deleted; Postgres, SQLite, and Mongo register generators through the framework type. SQL and Mongo tests unchanged in intent and green. ADR drafted.

Builds on: slice 2. Hands to: close-out.

### 4. `prisma6Schema` contract source for Mongo

Outcome: package `packages/2-mongo-family/2-authoring/contract-prisma6`; `defineConfig` in the Mongo facade accepts `contract: string | ContractConfig`; rule table from `projects/prisma7-contract-source/slices/02-mongo-source/spec.md` with `Json`/`Bytes`/`Decimal`/`BigInt` mapped to the slice 1 codecs and `@default(now())`/`@updatedAt` mapped to the slice 2 presets under the ADR 252 hard-error rules; unknown-top-level-block diagnostic in the Mongo PSL interpreter; end-to-end emit and sign against Prisma 6 shaped collections.

Builds on: slices 1 and 2. Hands to: close-out.

## Sequence

Stack: 1 → 2. Then parallel: 3 and 4 (independent of each other; 4 does not touch the runtime, 3 does not touch authoring or the reader).

## Dependencies

- `prisma contract print` (Mongo printer) is separate work; slice 4 documents cutover without it if it has not landed.

## Close-out (required)

- [ ] Verify every project DoD item in `spec.md`.
- [ ] Write the ADR for the framework-owned mutation-default runtime.
- [ ] Update `docs/reference/codec-authoring-guide.md`, the Mongo authoring reference, and the Mongo facade config reference.
- [ ] Delete or update `projects/prisma7-contract-source/slices/02-mongo-source/` and the filled "Deferred gaps" entries.
- [ ] Strip repo-wide references to `projects/mongo-defaults-codecs-prisma6-source/**`.
- [ ] Delete `projects/mongo-defaults-codecs-prisma6-source/`.
