# Dispatch 1 — A `renameCollection` operation, end to end

**Slice:** [`../spec.md`](../spec.md) § How it works, § Implementation notes · **Plan:** [`../plan.md`](../plan.md) dispatch 1 · **Builds on:** slice 2 (merged on `main`)

## Outcome

A hand-written MongoDB migration can call `renameCollection('profiles', 'users')`, and running it renames the collection with its documents, indexes and validator. The planner does not use it yet. You also report how variants are stored today.

## What to build

1. **The operation through the stack**, the way `createCollection` and `dropCollection` go:
   - a `RenameCollectionCommand` and its visitor method in `packages/2-mongo-family/4-query/query-ast` (`ddl-commands.ts`, `ddl-visitors.ts`);
   - its wire command in `packages/2-mongo-family/6-transport/mongo-lowering` and lowering in `packages/3-mongo-target/2-mongo-adapter`;
   - a driver case in `packages/3-mongo-target/3-mongo-driver/src/mongo-driver.ts`;
   - serializer and deserializer in the target's operation serializer;
   - preview text in `packages/2-mongo-family/9-family/src/core/operation-preview.ts`;
   - a `renameCollection` factory in `migration-factories.ts`, a `RenameCollectionCall` in `op-factory-call.ts` that renders `renameCollection('profiles', 'users')`, and the export from `src/exports/migration.ts`.
2. **Checks.** Before: the source collection exists and the target does not (`listCollections`). After: the target exists and the source does not. A re-run after success skips through the after-check.
3. **Class:** `widening`.
4. **Variant report (TML-2447).** Plan a contract with a base model and two variants that share one collection (`@@base`, `@@discriminator`) on current `main`, and report: which collections the planner creates, what the validator holds, and whether a variant's documents can be told apart by the discriminator value in the stored documents. Do not fix anything here; the orchestrator decides from the report.

## Not in this dispatch

Planning the rename (dispatch 3). Document rewrites (dispatch 2). Removing `renameStatements`.

## Tests

- Unit: factory, call rendering, serializer round trip, preview text.
- Against mongodb-memory-server (existing target-runner tests under `test/integration/test/mongo/target-runner/` show the setup): a collection with documents, a unique index and a closed validator is renamed, and all three are kept; re-running skips; renaming onto an existing collection fails at the before-check with nothing changed.
- `render-typescript` round trip: running the rendered `migration.ts` reproduces the operation in `ops.json`.

## Halt conditions

Stop and report if the driver's rename needs admin privileges that mongodb-memory-server does not give; or if a DDL command cannot carry a second collection name without changing the shared command shape.

## Gate

The plan's gate, plus the new target-runner test file.
