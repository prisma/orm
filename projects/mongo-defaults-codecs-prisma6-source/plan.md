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

### 6. `Json` means JSON; `Bson` means any BSON value

Outcome: `mongo/json@1` validates and enforces the JSON-representable subset; new `mongo/bson@1` with `Bson` PSL name, `field.bson()`, structural `BsonValue`, Extended JSON canonical form, unconstrained validator; validator derivation reads the whole `targetTypes` list; `docs/reference/scalar-types.md` written for Mongo; upgrade fragments. Specification: `design/scalar-naming.md` § 5, § 6, § 8, § 9.

Builds on: slice 4 (branch order) and slice 1 (validator mechanism). Hands to: close-out.

### 5. `prisma6Schema` contract source for Mongo

Outcome: package `packages/2-mongo-family/2-authoring/contract-prisma6`; `defineConfig` in the Mongo facade accepts `contract: string | ContractConfig`; rule table from `projects/prisma7-contract-source/slices/02-mongo-source/spec.md` with `Json`/`Bytes`/`Decimal`/`BigInt` mapped to the slice 1 codecs and `@default(now())`/`@updatedAt` mapped to the slice 3 presets under the ADR 252 hard-error rules; unknown-top-level-block diagnostic in the Mongo PSL interpreter; end-to-end emit and sign against Prisma 6 shaped collections.

Builds on: slices 1 and 3. Hands to: close-out.

## Sequence

Parallel: 1 and 2 are independent (2 branches off `main`). Stack: 3 after both. 4 and 5 are independent of each other but share one worktree and one implementer, so they run sequentially: 5 first (the user-facing reader), then 4 (the runtime hoist, cleanup). Five slices: the rename was split out of slice 4 during slice 3's first dispatch to keep the Mongo diff reviewable.

## Delivery state

| Slice | Branch | PR |
|---|---|---|
| 1 | `mongo-target-owns-codecs` | #30396, merged 2026-09-25 |
| 2 | `execution-ref-neutral-names` | #30399, merged 2026-09-25 |
| 3 | `mongo-execution-defaults` | #30403, stacked on 1 |
| 5 | `mongo-prisma6-source` | #30405, stacked on 3 |
| 4 | `mongo-generator-runtime-hoist` | #30406, stacked on 5 |
| 6 | | not started; stacked on 4 |

## Dependencies

- `prisma contract print` (Mongo printer) is separate work; slice 4 documents cutover without it if it has not landed.

## Close-out (required)

- [x] Verify every project DoD item in `spec.md` (verification block in `wip/closeout-dod.md`, to be copied into the close-out PR).
- [x] Write the ADR for the framework-owned mutation-default runtime (ADR 255, in #30406).
- [x] Update `docs/reference/codec-authoring-guide.md` (#30396), the Mongo authoring references (#30403), and the Mongo facade config reference (#30405).
- [x] Delete `projects/prisma7-contract-source/slices/02-mongo-source/` and update the filled "Deferred gaps" entries (#30405).
- [ ] Strip repo-wide references to `projects/mongo-defaults-codecs-prisma6-source/**`.
- [ ] Delete `projects/mongo-defaults-codecs-prisma6-source/`.

## Open items

- `architecture.config.json` maps the Postgres, SQLite, and Mongo target packages to the `extensions` domain, which may import from `targets` (the adapters). So `lint:deps` accepts a target importing its adapter, the direction ADR 198 forbids. Correcting the domain mapping touches all three targets and is its own change.
- `mongo/binary@1` round-trips every BSON Binary subtype as subtype 0. Slice 4 must decide how Prisma 6 `Bytes` (subtype 0) and any other subtype found in existing collections are handled.
- A field whose codec id the lookup does not know is left out of the closed `$jsonSchema` validator, so every write carrying that field is rejected. Pre-existing; decide whether unknown ids should be an authoring error instead.
- `mongo/decimal128@1` prints extreme exponents (down to `1E-6176`) as plain digit strings of up to about 6,100 characters. Accepted in slice 1 because the JSON form must carry no exponent; revisit only if it shows up in practice.
- Slice 2 left a stale `executionHash` in five regenerated example migration snapshots and told upgrade users to do the same, because the snapshot loader re-hashes storage only. If snapshot loading ever verifies the execution hash, revisit that and the fragment's step 2.
- The 46 prisma-8-demo migration-graph fixture snapshots still fail to load (no `namespace` in their refs); slice 2 renamed their keys for consistency only. The `gotchas.md` entry stands.
- Mongo PSL and TS hash different storage projections and derive collection validators differently, so a PSL-authored and a TS-authored Mongo contract never share a `storageHash`. Fixing it re-hashes every TS-authored Mongo contract. Its own change.
- SQL sorts execution defaults by entry then field; Mongo sorts by namespace, entry, field (the spec's order). Aligning SQL re-hashes multi-namespace SQL contracts. Decide at the slice 4 hoist.
- Mongo TS `field.temporal.timestamp(undefined, 'now')`: TypeScript infers both option arguments as optional, so the create-input type keeps such a field required even though the runtime fills it. `timestamp()` and `timestamp('now', 'now')` resolve exactly. Consider named-object arguments for the TS form; check what SQL's TS `temporal.timestamp` signature does.
- Mongo update defaults treat every top-level field the update document touches (`$set`, `$unset`, `$inc`, `$push`) as explicit, and an operator-only update as non-empty. Document this beside SQL's `$set`-only rule when the runtime machinery is hoisted (slice 4).
- The Mongo TypeScript contract builder keeps its own enum encoding and storage hashing; slice 5 unified the PSL interpreter and the Prisma 6 reader on `buildMongoStorage` in `@internal/mongo-contract` but did not move the TS builder onto it. It is part of the pre-existing PSL/TS storage-hash gap above.

## Follow-on projects specified in `design/`

- `target-named-scalars-sql`: Postgres and SQLite PSL and TS helper names follow the token rule (`design/scalar-naming.md` § 4, § 7, § 8, § 9). Before general availability.
- `mongo-driver-wire-contract`: the transport layer names the BSON wire vocabulary and `mongodb` types stop leaking past the driver (`design/driver-wire-contract.md`).

## Amendment to slice 1 (PR #30396)

The Mongo PSL renames `Int`→`Int32`, `Float`→`Double`, `Boolean`→`Bool`, `DateTime`→`Date` and their diagnostic and `app` fragment (`design/scalar-naming.md` § 3), plus the two other review findings (ADR 198 made self-consistent; codec errors carry collection and field), land in #30396 before merge.
- From the local review of #30396 (architect pass), left for later: a dependency-cruiser rule for target → adapter to replace `packages/3-mongo-target/1-mongo-target/test/layering.test.ts` (needs the target packages moved out of the `extensions` domain); moving the Mongo runner to the Postgres shape so `MongoRunnerDependencies` and `createRunnerDependencies` retire; deriving `CodecTypes` from the codecs and moving the Mongo TS field helpers into the target; trimming `extractDb`, `mongoStandardCodecs`, and `mongoDescriptorById` from the published exports; renaming `test/integration/test/mongo/target-runner/`.
- `localeCompare` still orders other emitted or hashed output: `contract-psl/src/interpreter.ts` (~560), `contract-ts/src/contract-builder.ts` (~113), `packages/2-mongo-family/3-tooling/emitter/src/index.ts` (~65, ~78), `mongo-schema-ir/src/schema-ir.ts` (~17), `schema-verify/canonicalize-introspection.ts` (~141), and the framework `mergeCapabilityMatrices` key sort feeding `capabilities`. Each is host-locale dependent in the same way the execution sort was; sweep them in one change with the code-unit comparator.
- The shared PSL parser reads only `a` or `a.b(` in index-field position, so a Prisma 6 `@@index([address.city])` fails with `PSL_INVALID_MODEL_MEMBER` before the Prisma 6 reader can report its own diagnostic; only the call form gets `PSL.PRISMA6_MONGO_COMPOSITE_INDEX_PATH_UNSUPPORTED`. Teaching the parser dotted references touches every grammar, the formatter, and the language server.
- Language-server completions now carry the deprecated Mongo scalar aliases last with the Deprecated tag; when the aliases are removed (a later release), delete the alias entries and the `deprecated` field consumers together.
