# Slice 1 plan

Spec: `spec.md`. Every dispatch runs on Opus, both implementer and reviewer. Persistent implementer and reviewer across dispatches.

Standard validation gate (every dispatch): `pnpm build` on touched packages, `pnpm typecheck`, package tests for every touched package, `pnpm lint:deps`. Dispatch 2 and 3 add `pnpm fixtures:check` and `pnpm test:integration` (Mongo tests).

## Dispatches

### D1. Target stops importing the adapter

Outcome: `packages/3-mongo-target/1-mongo-target` has no `@internal/adapter-mongo` import or dependency, except the codec imports in `descriptor-meta.ts` that D2 removes; the runner obtains `MongoRunnerDependencies` through the family instance and the `MongoControlAdapter` SPI; the Mongo family doc's layering section matches the code.

Builds on: nothing. Hands to: a target package whose only remaining adapter import is codec metadata.

Focus: ADR 198 wording; Postgres `runner.ts` as the pattern; move `MongoRunnerDependencies` and `MarkerOperations` into the family SPI; adapter implements; write the failing test first (a dependency-direction test or `lint:deps` registration) so the fix is red then green.

### D2. Codecs move to the target; fixtures regenerated

Outcome: codec ids, codecs, descriptors, data types, and `CodecTypes` live in the target and are exported from it; the adapter imports them and points `types.codecTypes.import` at the target; adapter codec subpaths and shell export map entries removed; `bson` is a target dependency; `architecture.config.json` registers the target's `src/core/**` and `exports/control.ts`; every emitted `contract.d.ts` (fixtures and examples) is regenerated and imports the target's codec types; `pnpm fixtures:check` clean.

Builds on: D1. Hands to: a single codec home in the target.

### D3. Int64, Decimal128, Binary, Json

Outcome: the four codecs exist in the target with data types, descriptors, `CodecTypes` entries, PSL names, TS builders, and JSON forms per the spec table; tests at every level including end to end on `mongodb-memory-server`; `docs/reference/codec-authoring-guide.md` and the Mongo authoring references updated.

Builds on: D2. Hands to: slice DoD.

## Open items

- Slice 4 will map Prisma 6 `BigInt`, `Decimal`, `Bytes`, `Json` to these codec ids.
