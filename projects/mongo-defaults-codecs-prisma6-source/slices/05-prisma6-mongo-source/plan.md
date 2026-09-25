# Slice 5 plan

Spec: `spec.md`. Branch `mongo-prisma6-source` stacked on `mongo-execution-defaults`. Opus implementer and reviewer, persistent.

Standard gate: `pnpm build`, `pnpm typecheck`, `pnpm lint:deps`, `pnpm fixtures:check`, `pnpm check:upgrade-coverage --mode pr`, package tests for every touched package, `pnpm test:packages`, Mongo integration subset plus the new end-to-end test.

## Dispatches

### D1. Reader package, binding, fixtures

Outcome: `@internal/mongo-contract-prisma6` with `prisma6Contract`, the `Prisma6TargetBinding` on the Mongo target, every rule-table row implemented and covered by a fixture (`expected-contract.json` or `expected-diagnostics.json`, `UPDATE_PRISMA6_FIXTURES=1` regeneration), the at-a-glance parity test against the Prisma 8 Mongo interpreter, the unknown-top-level-block diagnostic in the Mongo PSL interpreter, publish surface entry.

Builds on: slice 3. Hands to: a loadable `ContractConfig` for Prisma 6 Mongo schemas.

### D2. Facade, end to end, docs, close-out of the superseded slice

Outcome: `defineConfig` accepts `string | ContractConfig`; `prisma6Schema` exported from `@prisma/orm-mongo/config` with tests mirroring `define-config.prisma7.test.ts`; CLI journey on `mongodb-memory-server` (emit, sign, verify zero findings against Prisma 6 shaped collections and indexes); docs updated; `projects/prisma7-contract-source/slices/02-mongo-source/` deleted and its parent spec's "Deferred gaps" entries for Mongo defaults and codecs marked filled with a pointer to this project's PRs.

Builds on: D1. Hands to: slice DoD.

## Open items

- `prisma orm init` detects a Prisma 7 schema by looking for `prisma7Schema` on the target package; for Mongo it must look for `prisma6Schema`. CLI change, separate.
