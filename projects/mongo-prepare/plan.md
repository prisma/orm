# MongoDB `prepare()` — plan

Design: [spec.md](spec.md). Both design reviewers (architect, principal engineer) are satisfied: `wip/review-design/`.

## Slices

| # | Slice | Branch | Status |
|---|---|---|---|
| 1 | Runtime, query builder, client (spec D1–D8, D10–D12) | `tml-3792-mongo-prepare` | merged (#30967) |
| 2 | ORM reads `.prepared.all()` / `.prepared.first()` (spec D9) | `tml-3792-mongo-prepare-orm-reads` | building |

## Slice 1 dispatches

Every dispatch: tests first, then implementation. Follow `CLAUDE.md` golden rules and type-safety rules. No change under `packages/1-framework`. No comments unless unavoidable. Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, no AI attribution lines. Run commands through `mise exec --`. Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all` in full; run the integration test files you touch with `pnpm test <file>` inside `test/integration`.

### 1. Placeholder node, adapter, mutator

- **Outcome:** a `MongoPreparedParamRef` exists and every walker handles it as spec D1 says; `MongoParamRef` carries `nullable`; `limit`/`skip` stages accept a placeholder.
- **Scope:** `@internal/mongo-value` (class, `isMongoPreparedParamRef`, `MongoValue` union, `MongoParamRefOptions.nullable`); adapter `resolve-value.ts` (`PREPARE_BIND_ON_ADHOC` throw in `resolveValue` and `resolveDraftSlot`; `null` skip only when `nullable`); `lowering.ts` `needsLiteralWrap`; runtime `param-ref-mutator.ts` (`substituteSlot` copies `nullable`; one shared slot walk that the collector and bind function in dispatch 2 can use); `MongoLimitStage`/`MongoSkipStage` (spec D5); `MongoLoweredDraft` doc comment; walk-parity test extended.
- **Gate:** `pnpm typecheck` and `pnpm test` in each touched package; `pnpm test test/mongo/runtime/flatten-resolve-parity.test.ts test/mongo/runtime/execute-param-mutator-wiring.test.ts test/mongo/bson-scalars/bson-scalars.lists.test.ts` in `test/integration`; `pnpm lint:deps`.

### 2. `MongoRuntime.prepare` and handles

- **Outcome:** `runtime.prepare(declaration, callback)` and the two handle classes work against a `MongoRuntime`, per spec D2 (runtime part), D3, D5 run-time check, D6, D7, D8, D10.
- **Scope:** `MongoQueryExecutor` moves to `@internal/mongo-query-ast/execution` (ORM imports it from there); `MongoCodecInput` in `@internal/mongo-contract`; in `@internal/mongo-runtime`: declaration types, placeholders builder, `prepare`, `MongoPreparedStatement`, the second handle class (working name `MongoPreparedExecution`), internal bridge symbol installed by `MongoRuntimeImpl`, bind function, `prepareOperation` split so ad-hoc and prepared runs share the tail, `limit`/`skip` check after `beforeEncode` (all pipelines including sub-pipelines), new code `RUNTIME.PREPARE_RAW_PLACEHOLDER`.
- **Tests:** unit and type tests mirroring the SQL prepare tests (research file section 1.10), covering the Tests section of the spec that applies to the runtime.
- **Gate:** typecheck and tests in touched packages; `pnpm lint:deps`; new integration test file(s) under `test/integration/test/mongo/` run with `pnpm test <file>`.

### 3. Query builder and client

- **Outcome:** query-builder operators and `limit`/`skip` accept placeholders (spec D5); `db.prepare` on `mongo()` (spec D2 client part); public exports (spec D11).
- **Scope:** MongoDB query builder signatures; facade `mongo.ts`; `@prisma/orm-mongo` exports; type tests (`mongoStatic()` has no `prepare`, client is not a target, runtime is); integration tests through `mongo()` against an in-memory replica set.
- **Gate:** typecheck and tests in touched packages; touched integration files; `pnpm lint:deps`; `pnpm fixtures:check`.

### 4. Documents

- **Outcome:** spec D12: ADR 318 (check open PRs for the number first), ADR 210 update note, `ADR-INDEX.md`, MongoDB family and runtime subsystem docs, error reference (`pnpm check:error-reference`), facade and `@prisma/orm-mongo` READMEs, `skills/prisma-8/references/queries.md` and `queries-mongo.md`, release-note fragment.
- **Gate:** `pnpm lint:agent` (or the repo's doc lints), `pnpm check:error-reference`, `pnpm lint:ratchets`, `check:upgrade-coverage --mode pr`.

## Slice 2 dispatches

Same rules as slice 1. Spec D9 is the design. Postgres is the pattern to copy: the SQL ORM's `.prepared` reads, SQL's `Preparable`, and the client's `prepareQuery` in the Postgres facade.

### 5. ORM prepared reads

- **Outcome:** a MongoDB collection has `.prepared.all()` and `.prepared.first()`, returning a `MongoPreparable<Row, Result>`. A placeholder works as a top-level field value in an object-form `where`, in a filter-expression `where` on a scalar field (including a scalar inside a value object, such as `address.city`), and in `limit` and `offset`.
- **Scope:** `MongoPreparable` in `@internal/mongo-query-ast/execution`. In the ORM: the pass-through in `#compileWhereObject` and `#encodeFieldFilter` only; `MongoCollectionState.limit`/`offset` widen; `first()` sets `limit` to 1; types require the placeholder's codec to be the field's codec (the element codec on a list field, not nullable there; nullable only on a nullable field).
- **Decided:** a placeholder in a filter-expression `where` on a field that is not a scalar (a whole value object, or a path the contract does not know) is refused with `ORM.ARGUMENT_INVALID` when the `where` is built, through `ormParam`. A declaration names a scalar codec, so it cannot stand for a value object.
- **Gate:** typecheck and tests (with `--coverage`) in touched packages; `pnpm lint:deps`.

### 6. Client and documents

- **Outcome:** `db.prepare(declaration, (p) => db.orm.users.where(...).prepared.all())` works, and the handle's `query(runtime, params)` returns the consumer's result: a row stream for `all`, `Row | null` for `first`.
- **Scope:** facade `mongo.ts` accepts a plan or a `MongoPreparable`; integration tests through `mongo()` against an in-memory replica set; ADR 318 section for ORM reads; `skills/prisma-8/references/queries-mongo.md` (drop "ORM reads cannot be prepared yet"); READMEs; release-note fragment; upgrade instructions if a public type changes.
- **Gate:** typecheck, tests with coverage, touched integration files, `pnpm lint:deps`, `pnpm fixtures:check`, `pnpm check:error-reference`, `pnpm lint:docs`, `pnpm lint:ratchets`, `check:upgrade-coverage --mode pr`.

## Open items

- Follow-ups in [deferred.md](deferred.md).
