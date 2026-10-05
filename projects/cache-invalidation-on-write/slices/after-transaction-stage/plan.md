# Slice 1 — `afterTransaction` stage: dispatch plan

Spec: [`../../spec.md`](../../spec.md) § Slice 1. Design: [ADR 260](../../../../docs/architecture%20docs/adrs/ADR%20260%20-%20Every%20query%20has%20an%20afterTransaction%20stage%20that%20fires%20when%20its%20enclosing%20transaction%20ends.md).

Branch `feat/after-transaction-stage`, based on `docs/cache-middleware-design` (PR #30600). One PR to `main`.

## D1 — framework surface and runner

Outcome: `RuntimeMiddleware` declares `afterTransaction?(plan, result: AfterTransactionResult, ctx)`; `run-with-middleware.ts` exports `runAfterTransaction(plan, middleware, result, ctx)` which calls each middleware's hook in registration order, logs a thrown error through `ctx.log.error` and continues. Exported from `exports/runtime.ts`. Tests: runner order, swallowing with logging, `CrossFamilyMiddleware` with the hook assignable to `SqlMiddleware[]` and `MongoMiddleware[]` (type test).

Builds on: nothing. Hands to: D2, D3 (the runner and the type).

## D2 — SQL runtime fires the stage

Outcome: outside a transaction the SQL runtime fires the stage when the query ends, `committed` right after the after-hook when it completed and `unknown` when it did not; `wrapTransaction` remembers each plan with its context once the query's encoded plan exists and before it runs and, when `commit()` or `rollback()` resolves or rejects, fires once per plan in execution order with `committed` / `rolled-back` / `unknown` per the spec table, before `commit()`/`rollback()` resolve, with nothing more after a rollback that follows a rejected commit. Tests: the lifecycle cases listed in the spec, plus a Postgres integration test that an ORM single-row `update()` fires `committed` once.

Builds on: D1. Hands to: D3 (nothing structural; D3 mirrors the outside-transaction firing).

## D3 — Mongo runtime, docs, ADR

Outcome: the Mongo runtime fires the stage as a query outside a transaction on both paths; the ADR draft moves to `docs/architecture docs/adrs/ADR 260 - …` with Status Accepted and an ADR-INDEX row; the runtime subsystem doc and the runtime skill reference describe the stage; `spec.md`/`plan.md` in the project folder point at the ADR instead of the draft.

Builds on: D1, D2.

## Review

`/drive-code-review` after D3, walkthrough omitted; rework dispatches as needed; then PR text per `pr.md`.
