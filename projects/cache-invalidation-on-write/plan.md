# Cache invalidation on write — plan

**Spec:** [`spec.md`](spec.md)

## Summary

Two slices, one PR each, in order. Slice 2 is blocked by slice 1: the write annotation cannot be correct without a stage that fires once the write's transaction has ended.

## Slice 1: `afterTransaction` stage (TML-3399)

Adds `afterTransaction(plan, result, ctx)` and `AfterTransactionResult` to `RuntimeMiddleware`, and a runner for it in `run-with-middleware.ts`. The SQL runtime fires the stage right after the after-hook outside a transaction, and from `wrapTransaction` for each plan when a transaction ends. Mongo fires it right after the after-hook.

Done when:

- the runner, SQL runtime lifecycle, Postgres integration and type tests in the spec pass, including exactly one call per plan after a rejected commit followed by a rollback, and `commit()` resolving only after the hooks have run;
- the stage's ADR is merged with the slice, and the runtime subsystem doc and the runtime skill reference describe it.

## Slice 2: `invalidateAnnotation` (TML-3400)

Adds `invalidateAnnotation<TMeta>({ keys, meta })` with `applicableTo: ['write']`. The cache middleware implements `afterTransaction` and calls `invalidate` for an annotated plan unless the outcome is `rolled-back`.

Done when:

- the type, middleware and integration tests in the spec pass, and `cache-query-only.test.ts` checks that `afterTransaction` is the middleware's only hook for writes;
- the package README documents the annotation, when it runs and its known limits, and ADR 259's paragraph on invalidation that comes with a write, and its consequence about the runtime hook, describe the shipped annotation.

## Close-out

Move anything long-lived into `docs/`, remove references to this folder, and delete `projects/cache-invalidation-on-write/` in the last PR.
