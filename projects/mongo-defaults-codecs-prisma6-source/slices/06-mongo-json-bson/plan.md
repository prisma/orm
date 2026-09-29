# Slice 6 plan

Spec: `spec.md` and `../../design/scalar-naming.md` § 5, § 6, § 8, § 9. Branch `mongo-json-bson` stacked on `mongo-generator-runtime-hoist`. Opus implementer and reviewer, persistent.

Gate: build, typecheck, lint:deps, lint:framework-vocabulary, per-package `pnpm lint`, fixtures:check with the `contract.json` diff reported, `check:upgrade-coverage --mode pr --prev $(git rev-parse mongo-generator-runtime-hoist) --head HEAD`, check:error-reference, package tests for touched packages, test:packages, Mongo integration subset plus `test/mongo/bson-scalars` and `test/mongo/temporal-presets`.

## Dispatches

### D1. `Json` tightened; validator derivation reads the list

Outcome: design § 5 in full (targetTypes list, derivation, encode and decode rules and messages, tests); `derive-json-schema` list form with no change to any existing fixture's validator except `Json` fields; upgrade fragment change `mongo-json-field-semantics` per § 8.

Builds on: slice 4 head. Hands to: a validator derivation that accepts lists, and a `Json` that means JSON.

### D2. `Bson`; docs; fragments

Outcome: design § 6 in full (codec, data type, descriptor, PSL name, TS helper, `BsonValue`, EJSON form, validator, tests incl. end to end); `docs/reference/scalar-types.md` per § 9 for Mongo with the cross-target concept table; codec authoring guide and subsystem 10 updates; extension fragment change `mongo-bson-codec-added` per § 8.

Builds on: D1. Hands to: slice DoD and project close-out.
