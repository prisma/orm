# Slice plan — 4p, TypeScript MongoDB contracts get the PSL validator

**Spec:** [`spec.md`](./spec.md) (approved by Will, 2026-10-15) · **Grounding:** [`investigation.md`](./investigation.md) · **Linear:** [TML-3553](https://linear.app/prisma-company/issue/TML-3553) · **Branch:** `tml-3553-ts-mongo-validator`

Two pull requests. One implementer and one reviewer, both on Opus, resumed across every dispatch. Briefs are in `dispatches/`.

## Gate for every dispatch

- `pnpm typecheck`; `pnpm --filter <touched package> lint`; `pnpm --filter <touched package> test`.
- `pnpm lint:deps`, `pnpm fixtures:check`, `pnpm check:error-reference`, `pnpm lint:throws`, `pnpm lint:casts`, `pnpm check:upgrade-coverage`.
- Integration and e2e: only named files or folders, run as `pnpm test <path>`. Never `pnpm test:integration`, `test:e2e` or `test:all`.
- Before a PR is queued: every integration and e2e test file that mentions MongoDB, not only `test/integration/test/mongo/`, plus the MongoDB CLI journeys. PR runs skip integration tests, so this is the only check before the merge queue. List the files with `git grep -il mongo -- 'test/*.test.ts' 'test/**/*.test.ts'` inside `test/integration` (about 140 files, including `test/ports/**`, `value-objects/` and the `cli.*` e2e files directly in `test/`). The first pattern matters: `test/**/*.test.ts` alone skips files directly in `test/`, such as `cli.control-policy.mongo.e2e.test.ts`. Pass each file as its own argument. Run the files outside `test/cli-journeys/` by name with `pnpm test <file> ...` in groups of about 20, saving each group's output to a file. Run the journeys from that list by name with `pnpm test:journeys <file> ...`. Skip only `init-journey.e2e.test.ts`, which runs nightly.
- The reviewer runs code against mongodb-memory-server, not only reads it.

## Dispatches

| # | PR | Outcome | Builds on |
| --- | --- | --- | --- |
| 1 | 1 | The validator derivation, as one function `deriveCollectionValidators`, and the enum listability check live in `@internal/mongo-contract`; PSL calls them there; every emitted fixture and hash is unchanged | 4a, 3a merged |
| 2 | 2 | The TypeScript builder derives validators with the full lookups (target and extension packs); refuses models without an `ObjectId` `_id`, enums a validator cannot list, and fields whose codec has no MongoDB data type; fixtures re-emitted | 1 merged |
| 3 | 2 | 4a's temporary refusal is removed; the side-by-side test stops stripping `validator` and `storageHash`; a field rename and removal on a TypeScript contract plan and apply; docs, skill and the app upgrade fragment (re-emit, find failing documents, apply), followed as printed | 2 |

**Hand-offs**
- 1 → 2: one function, in `@internal/mongo-contract`, that both authoring surfaces call.
- 2 → 3: TypeScript and PSL contracts for the same schema emit the same `contract.json`.
