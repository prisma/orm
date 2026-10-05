# Cache invalidation on write — plan

**Spec:** [`spec.md`](spec.md)

## Summary

Two slices, one PR each, in order. Slice 2 is blocked by slice 1: the write annotation cannot be correct without a hook that fires after the transaction commits.

## Slice 1: `afterTransaction` hook (TML-3399)

Adds `afterTransaction`, `AfterTransactionResult`, `TransactionMiddlewareContext`, `RuntimeMiddlewareContext.transactionId`, and `runAfterTransaction`; fires the hook from the SQL runtime's `wrapTransaction`.

Done when:

- the framework and SQL runtime tests in the spec pass, including exactly one call after a rejected commit followed by a rollback, and the ORM single-row `update()` integration test;
- `transactionId` is the same on every operation of one transaction and on its `afterTransaction`, and absent outside a transaction;
- the runtime subsystem doc describes the hook, and the hook's ADR is merged with the slice.

## Slice 2: `invalidateAnnotation` (TML-3400)

Adds `invalidateAnnotation<TMeta>({ keys, meta })` with `applicableTo: ['write']`, read by the cache middleware in `afterQuery` and `afterExecute`; runtime scope invalidates at once, transaction scope queues under `transactionId` and runs on `committed` or `unknown`.

Done when:

- the type, middleware and integration tests in the spec pass, including a rolled-back transaction leaving the entry in place;
- the package README documents the annotation, its timing and its known limits, and ADR 259's write-driven invalidation entry describes the shipped annotation instead of a planned one.

## Close-out

Move anything long-lived into `docs/`, remove references to this folder, and delete `projects/cache-invalidation-on-write/` in the last PR.
