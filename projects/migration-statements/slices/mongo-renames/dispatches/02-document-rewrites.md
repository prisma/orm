# Dispatch 2 — `renameField` and `unsetField` rewrites, end to end

**Slice:** [`../spec.md`](../spec.md) § How it works, § Decisions 3 and 5 · **Plan:** [`../plan.md`](../plan.md) dispatch 2 · **Builds on:** dispatch 1

## Outcome

A hand-written MongoDB migration can call `renameField(...)` and `unsetField(...)`. Each runs one `updateMany` that skips validation, carries the class of its effect, and runs under `db update`'s classes. The planner does not use them yet.

## What to build

1. **Skipping validation.** The raw update command (`RawUpdateManyCommand`, `packages/2-mongo-family/4-query/query-ast/src/raw-commands.ts`) gains `bypassDocumentValidation`, through its wire form and the driver (`mongo-driver.ts` passes only `upsert` today).
2. **Two factories and calls.**
   - `renameField(collection, from, to, { filter? })`: `$rename` on documents that hold `from` and match `filter`. Before: no matching document holds `to`. After: no matching document holds `from`. Class `widening`.
   - `unsetField(collection, field, { filter? })`: `$unset` on documents that hold `field` and match `filter`. After: no matching document holds `field`. Class `destructive`.
   - `filter` carries a variant's discriminator condition (`{ type: 'bug' }`); dispatch 3 supplies it.
   - Calls render as `renameField('users', 'name', 'fullName')` and `unsetField(...)`, exported from the target's migration module, so a re-run of `migration.ts` reproduces `ops.json`.
3. **Telling rewrites from DDL by shape.** The runner (`mongo-runner.ts`) and the operation serializer recognise these by their shape (`run` against `execute`), not by `operationClass === 'data'`. `data` stays the class of user-written and scaffolded transforms. A `db update`-style policy without `data` accepts these two and still refuses a `data` transform.
4. **Storage name.** The family helper that names an operation's storage (`mongoStorageNameOf`, `packages/2-mongo-family/9-family/src/core/operation-storage-name.ts`) handles the new shape: `<collection>.<field>`.

## Not in this dispatch

Planning them (dispatch 3). Value object fields (slice 4b).

## Tests

Against mongodb-memory-server: a collection with a closed validator that requires `name` and a unique index on `name`. Drop the index, `renameField` to `fullName`, create the index on `fullName`: every document moved, the unique index builds, nothing failed validation. `renameField` when a document already holds `fullName` fails at the before-check with nothing changed. A re-run after success skips. `unsetField` removes the field from every matching document. A `filter` limits both to matching documents. Under a policy of `additive`, `widening`, `destructive`, both run and a `data` transform is refused. Unit: factories, rendering, serializer round trip, storage names.

## Halt conditions

Stop and report if skipping validation needs a server privilege mongodb-memory-server lacks; or if the serializer cannot tell the shapes apart without a new discriminating field in `ops.json` (that changes the file format and needs a decision).

## Gate

The plan's gate, plus the target-runner test files you add or change.
