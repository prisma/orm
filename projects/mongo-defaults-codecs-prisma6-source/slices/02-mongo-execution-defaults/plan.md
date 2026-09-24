# Slice 2 plan

Spec: `spec.md`. Branch `mongo-execution-defaults` stacked on `mongo-target-owns-codecs` (PR #30396). Opus for implementer and reviewer; persistent subagents continue from slice 1.

Standard gate: `pnpm build`, `pnpm typecheck`, `pnpm lint:deps`, `pnpm fixtures:check`, `pnpm check:upgrade-coverage --mode pr`, package tests for every touched package (SQL packages included when the hoist touches them), Mongo + SQL mutation-default integration tests.

## Dispatches

### D1. Framework hoist of temporal preset primitives; Mongo contract accepts `execution`

Outcome: `TIMESTAMP_NOW_GENERATOR_ID`, `timestampNowControlDescriptor`, `temporalAuthoringPresets`, `temporalCodecPreset`, the on-create/on-update arg specs, and the reusable PSL preset-resolution helpers live in `framework-components`; SQL imports them, SQL tests green and unchanged in intent. The Mongo contract schema accepts an optional `execution` section with `{ namespace, model, field }` refs; `MongoContract` types it; `computeExecutionHash` is wired for Mongo in the serializer path; existing fixtures unchanged (`fixtures:check` clean).

Builds on: slice 1. Hands to: primitives both Mongo authoring surfaces can import, and a contract that can carry the section.

### D2. Mongo authoring: PSL and TS `temporal.*`

Outcome: the Mongo target registers `authoring.field.temporal.{createdAt, updatedAt, timestamp}` and the `timestampNow` control descriptor; Mongo PSL resolves field presets with the SQL diagnostics; Mongo TS composes `field.temporal.*` from the pack, carries `executionDefaults`, refuses nullable + generator; both paths emit `execution` with `executionHash` and a PSL/TS parity test proves byte identity; emitted `contract.d.ts` types `execution` with Mongo refs and typechecks.

Builds on: D1. Hands to: contracts that require `timestampNow`.

### D3. Mongo runtime, ORM, facade, create-input types, end to end

Outcome: generator registry and checks in `createMongoExecutionContext`; `timestampNow` runtime generator registered by the adapter; `applyMutationDefaults` with SQL semantics; ORM create/update/upsert paths apply defaults through the `MongoMutationDefaults` interface; facade passes the context; `CreateInput` marks generated fields optional; end-to-end test on mongodb-memory-server; docs and any upgrade fragment.

Builds on: D2. Hands to: slice DoD.
