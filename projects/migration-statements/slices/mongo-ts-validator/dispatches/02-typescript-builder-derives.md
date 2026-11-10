# Dispatch 2 — the TypeScript builder derives validators

**Slice:** [`../spec.md`](../spec.md) (approved by Will, 2026-10-15) · **Plan:** [`../plan.md`](../plan.md) · **Grounding:** [`../investigation.md`](../investigation.md) · **Branch:** `tml-3553-ts-validator-pr2` · **PR:** 2 of 2

PR 1 (prisma/orm#30733, merged) moved the derivation into `@internal/mongo-contract`. Its public entry is `deriveCollectionValidators` (`packages/2-mongo-family/1-foundation/mongo-contract/src/derive-collection-validators.ts`). PSL calls it from `packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts`. This dispatch makes the TypeScript builder (`packages/2-mongo-family/2-authoring/contract-ts/src/contract-builder.ts`, `defineContract`) call it too.

## Outcome

A TypeScript MongoDB contract emits the same collection validators, and so the same storage hash, as the PSL contract for the same schema.

## What to build

1. **Lookups.** The builder builds its codec lookup from the target only (`extractCodecLookup([definition.target])`). Build the codec lookup and the data type lookup from the target and every extension pack the contract lists, as PSL gets them from the control stack (`contract-psl/src/provider.ts`). Find how the definition names its extension packs; do not add a new input if one exists.
2. **Derive.** Call `deriveCollectionValidators` with the built models, value objects, value sets and lookups, and set each collection's `validator` before the storage hash is computed.
3. **Refusals, raised when the contract is built**, each with a test that is red first:
   - A root model without an `_id` stored as BSON `objectId`: use `documentIdRefusalOf` and lead with the model, as in `Model "User" has no _id field ...`. Its `unknownCodec` reason covers an `_id` whose codec has no MongoDB data type.
   - An enum a validator cannot list: use `validatorEnumRefusalOf` / `validatorEnumMemberRefusalOf`.
   - A field whose codec has no MongoDB data type: refuse it, naming the model, field and codec. Do not drop the field silently. Run this before the `_id` check, so an unknown `_id` codec reports the codec.
   - Use the builder's existing error type and style for contract errors. If `pnpm check:error-reference` requires an entry, add it.
4. **Two root models in one collection without a discriminator** (spec decision 5): refuse, naming both models and the collection. Today the second model's validator silently replaces the first. Put the check where both surfaces get it (`deriveCollectionValidators` or the storage validation it relies on) only if PSL cannot already reach the case or already refuses it; check PSL first and say which. If PSL already refuses it, the TypeScript refusal uses the same wording.
5. **An embedded model with variants** (spec decision 5). First find out whether the ORM writes and reads an embedded model's variant fields (`packages/3-extensions/mongo` or the Mongo ORM package; write a quick test against mongodb-memory-server if needed, and delete it after).
   - If it does: describe the embedded model as a `oneOf` with one branch per variant, as a root model with variants is, and add an edge from a base model to each of its variants in `recursiveGroupsOf`, so a variant that embeds its base stops at the group rule. Exact `toEqual` tests for both.
   - If it does not: refuse an embed relation to a model with variants when the contract is built, with a test.
   - Write which case held, and why, into spec decision 4 or 5 in one or two sentences.
6. **An embed relation to a model with no owner** (spec decision 5): no change in this PR. The validator already handles it. Whether such a contract is valid belongs to contract validation. Say in your report whether any existing fixture or test uses it, so the orchestrator can file a ticket.
7. **Tests the change breaks.** Fix them by giving them real lookups or real models, not by loosening assertions. The grounding lists likely ones: `contract-ts/test/contract-builder.storage-hash-pin.test.ts` (the pinned hash changes; update it and say so), `contract-builder.dsl.test.ts`, tests with fake target packs that have no codecs or data types, and TypeScript unit-test models without an `_id`.
8. **Fixtures.** Re-emit the committed TypeScript MongoDB fixtures with `pnpm fixtures:check` / the emit scripts: `examples/bundle-size/src/mongo/generated/`, `test/integration/test/mongo/fixtures/generated/`, and any others the check reports. Commit the regenerated files.

Out of this dispatch (dispatch 3): removing 4a's temporary refusal (`packages/3-mongo-target/1-mongo-target/src/core/migrations/same-hash-field-changes.ts` and its journey `test/integration/test/cli-journeys/same-hash-field-changes.mongo.e2e.test.ts`), removing the side-by-side strip, docs, the skill line and the app upgrade note. If the change makes the 4a refusal's journey fail, say so and leave it for dispatch 3.

## Done when

- The side-by-side MongoDB fixture (`test/integration/test/authoring/side-by-side/mongo/`) emits the same `validator` and `storageHash` from both surfaces. Check by temporarily removing the strip in `side-by-side-contracts.test.ts` lines 280–330 and running it; restore the strip afterwards (dispatch 3 removes it for good).
- Every refusal above has a test that failed before the change, asserting the exact message.
- Checks, all passing:
  - `pnpm build`, `pnpm typecheck`, `pnpm lint:deps`, `pnpm fixtures:check`, `pnpm check:error-reference`, `pnpm lint:throws`, `pnpm lint:casts`, `pnpm check:upgrade-coverage`.
  - Lint and `pnpm test --coverage` in every touched package.
  - Every integration and e2e file under `test/integration` that mentions MongoDB, run by name in groups of about 20 (`git grep -il mongo -- 'test/**/*.test.ts'` inside `test/integration`), and the MongoDB CLI journeys by name. Expect TypeScript-fixture tests to change (`cli-journeys/mongo-migration.e2e.test.ts`, `mongo-db-update-consent.e2e.test.ts`, `cli.control-policy.mongo.e2e.test.ts`, `enum-members.mongo-ts.test.ts`, `mongo-runtime/query-builder.test.ts`). Update an assertion only where the new behaviour is the intended one, and list each in your report.
