# Slice 4 plan

Spec: `spec.md`. Branch `mongo-generator-runtime-hoist` stacked on `mongo-prisma6-source`. Opus implementer and reviewer, persistent.

Standard gate: `pnpm build`, `pnpm typecheck`, `pnpm lint:deps`, `pnpm lint:framework-vocabulary`, per-package `pnpm lint` for every touched package, `pnpm fixtures:check`, `pnpm check:upgrade-coverage --mode pr`, `pnpm check:error-reference`, package tests for every touched package, `pnpm test:packages`, the SQL mutation-default integration subset and the Mongo integration subset.

## Dispatches

### D1. Framework module; SQL migrates

Outcome: `framework-components/src/execution/mutation-defaults.ts` with the types and three functions, SQL-verbatim semantics, unit tests moved from `packages/2-sql/5-runtime/test` where they test the hoisted code; `sql-context.ts` and `query-lane-context.ts` use it with `table`→`entry` and `column`→`field`; every SQL caller and stub follows; SQL generator files and adapters import the framework type; `buildExecutionSection` in `@internal/contract` used by SQL with the namespace-first sort and the two fixtures re-hashed; SQL upgrade fragment. SQL tests green with only import and key-name changes.

Builds on: slice 5 head. Hands to: a framework runtime module with one consumer.

### D2. Mongo migrates; ADR and docs

Outcome: the Mongo copy deleted, `MongoExecutionContext extends MutationDefaults`, the Mongo ORM on the framework interface (or a reported layering decision), Mongo generator file and adapter on the framework type, `mongo-contract/src/mutation-defaults.ts` and `build-execution-section.ts` deleted in favour of the framework, Mongo `undefined` tests moved to the ORM level, Mongo upgrade fragment; the ADR, subsystem 4 and 10 sections, the sql-runtime README fix.

Builds on: D1. Hands to: slice DoD and project close-out.
