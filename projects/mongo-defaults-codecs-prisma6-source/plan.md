# Project plan — mongo-defaults-codecs-prisma6-source

**Spec:** `spec.md`. Linear: intentionally not used for this project. Working branch: `worktree/prisma-mongo-defaults-codecs-439e71`.

## Slices

### 1. Mongo codecs in the target, plus Int64, Decimal128, Binary, Json

Outcome: all Mongo codecs, data types, ids, and descriptors live in `packages/3-mongo-target/1-mongo-target`; the adapter imports and registers them. Four new codecs with PSL scalar names (`Int64`, `Decimal128`, `Binary`, `Json`) and TS builders (`field.int64()`, `field.decimal128()`, `field.binary()`, `field.json()`). Round-trip tests for wire and JSON forms.

Builds on: nothing. Hands to: a single codec home for slice 2's date preset to reference, and the scalar names slice 4 maps `BigInt`, `Decimal`, `Bytes`, `Json` onto.

### 2. Framework execution refs get neutral names

Outcome: `ExecutionMutationDefault.ref` in the framework contract is `{ namespace, entry, field }` (the storage vocabulary the framework already uses: namespaces hold `entries`); SQL authoring, validators, runtime, ORM client, emitter, and every fixture carrying an `execution` section are migrated; SQL behaviour and tests unchanged in intent. Mongo can then use the framework `Contract` type unchanged.

Builds on: nothing (branch off `main`). Hands to: a contract type both families share for execution refs.

### 3. Mongo execution defaults end to end

Outcome: Mongo contract accepts an optional `execution` section with `executionHash`; Mongo runtime holds a generator registry with the missing-generator and duplicate-id checks; `timestampNow` generator registered by the Mongo target; `temporal.*` presets in Mongo PSL and TS via the framework preset machinery; ORM create and update paths apply defaults with `'row'` and `'query'` stability and the empty-payload rule; emitter marks generated fields optional on create input and writes `executionHash`. End-to-end test on `mongodb-memory-server`.

Builds on: slices 1 and 2. Hands to: a working Mongo generator runtime for slice 4 to hoist, and `temporal.*` for slice 5 to map `@updatedAt` and `@default(now())` onto.

### 4. Hoist the generator runtime into the framework

Outcome: registry, checks, and apply loop live once in `framework-components/src/execution/` using the slice 2 ref names; SQL runtime migrated; Mongo runtime imports the framework code and its local copy is deleted; Postgres, SQLite, and Mongo register generators through the framework type. SQL and Mongo tests unchanged in intent and green. ADR drafted.

Builds on: slice 3. Hands to: close-out.

### 5. `prisma6Schema` contract source for Mongo

Outcome: package `packages/2-mongo-family/2-authoring/contract-prisma6`; `defineConfig` in the Mongo facade accepts `contract: string | ContractConfig`; rule table from `projects/prisma7-contract-source/slices/02-mongo-source/spec.md` with `Json`/`Bytes`/`Decimal`/`BigInt` mapped to the slice 1 codecs and `@default(now())`/`@updatedAt` mapped to the slice 3 presets under the ADR 252 hard-error rules; unknown-top-level-block diagnostic in the Mongo PSL interpreter; end-to-end emit and sign against Prisma 6 shaped collections.

Builds on: slices 1 and 3. Hands to: close-out.

## Sequence

Parallel: 1 and 2 are independent (2 branches off `main`). Stack: 3 after both. Then parallel: 4 and 5 (4 does not touch authoring or the reader, 5 does not touch the runtime). Five slices: the rename was split out of slice 4 during slice 3's first dispatch to keep the Mongo diff reviewable.

## Dependencies

- `prisma contract print` (Mongo printer) is separate work; slice 4 documents cutover without it if it has not landed.

## Close-out (required)

- [ ] Verify every project DoD item in `spec.md`.
- [ ] Write the ADR for the framework-owned mutation-default runtime.
- [ ] Update `docs/reference/codec-authoring-guide.md`, the Mongo authoring reference, and the Mongo facade config reference.
- [ ] Delete or update `projects/prisma7-contract-source/slices/02-mongo-source/` and the filled "Deferred gaps" entries.
- [ ] Strip repo-wide references to `projects/mongo-defaults-codecs-prisma6-source/**`.
- [ ] Delete `projects/mongo-defaults-codecs-prisma6-source/`.

## Open items

- ADR 198 describes a `MongoCommandExecutor` DDL visitor and a `MarkerOperations` without a `space` parameter; neither matches the code, and the drift predates this project. Slice 1 corrected only the composition-site example. Rewriting the DDL dispatch text is its own change; do it at close-out or as a separate direct change.
- `architecture.config.json` maps the Postgres, SQLite, and Mongo target packages to the `extensions` domain, which may import from `targets` (the adapters). So `lint:deps` accepts a target importing its adapter, the direction ADR 198 forbids. Correcting the domain mapping touches all three targets and is its own change.
- `mongo/binary@1` round-trips every BSON Binary subtype as subtype 0. Slice 4 must decide how Prisma 6 `Bytes` (subtype 0) and any other subtype found in existing collections are handled.
- A field whose codec id the lookup does not know is left out of the closed `$jsonSchema` validator, so every write carrying that field is rejected. Pre-existing; decide whether unknown ids should be an authoring error instead.
- `mongo/decimal128@1` prints extreme exponents (down to `1E-6176`) as plain digit strings of up to about 6,100 characters. Accepted in slice 1 because the JSON form must carry no exponent; revisit only if it shows up in practice.
