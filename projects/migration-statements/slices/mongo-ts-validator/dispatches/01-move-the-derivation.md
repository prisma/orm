# Dispatch 1 — move the validator derivation into `@internal/mongo-contract`

Work only in `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/tml-3474-handover-fb4cb3/wip/wt-4p`, branch `tml-3553-ts-mongo-validator`.

Read first: `projects/migration-statements/slices/mongo-ts-validator/spec.md`, `investigation.md` (§ 2 and § 4) and `plan.md` beside it.

## Outcome

PR 1 of 2. No output changes.

- `deriveJsonSchema` and `derivePolymorphicJsonSchema` (`packages/2-mongo-family/2-authoring/contract-psl/src/derive-json-schema.ts`) move to `@internal/mongo-contract` (`packages/2-mongo-family/1-foundation/mongo-contract`).
- The per-collection loop in the PSL interpreter (`interpreter.ts`, the part that picks base models, builds variant entries and chooses plain or polymorphic) moves there too, as one function that takes resolved domain models and lookups and returns each collection's validator. The PSL interpreter calls it.
- The enum listability check (`VALIDATOR_LISTABLE_BSON_TYPES` and `enumRefusalOf` use in `packages/2-mongo-family/9-family/src/core/authoring-entity-types.ts`) moves to `@internal/mongo-contract` as a function that returns a refusal reason, so both authoring surfaces can use it. PSL keeps its diagnostics and wording.
- Remove `@internal/mongo-contract-psl`'s export of the derivation; update its callers (`packages/3-extensions/mongo/test/mongo.enum.e2e.test.ts`).
- Tests move with the code. Add a test in `@internal/mongo-contract` for the per-collection function (plain, polymorphic, value objects, enums).

## Done when

- `pnpm fixtures:check` shows no diff: every PSL MongoDB contract and storage hash is byte for byte the same.
- `pnpm lint:deps` passes: nothing in the foundation layer imports authoring or family code.
- Every integration and e2e test file that mentions MongoDB passes, run by name in groups, and so do the MongoDB CLI journeys. Find them as `plan.md` says, under "Gate for every dispatch": `git grep -il mongo -- 'test/**/*.test.ts'` inside `test/integration`.

## Rules

- Tests first where behaviour is new (the per-collection function's test). Commit each step: `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, subject `TML-3553: <sentence>`. Never amend, rebase or force-push. No Co-Authored-By or AI attribution lines. Do not push.
- Gate: see `plan.md`. Save output under `wip/` and read the files.
- Never run `pnpm test:integration`, `test:e2e`, `test:all` or `test:packages` in full. Run node and pnpm through `mise exec --`. Never write to `/tmp`. Stop every server you start, by process ID.

## Report

Reply in a few lines: what moved where, commits, gate results with any failure's exact output.
