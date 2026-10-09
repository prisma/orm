# Slice plan — 4a, renames and deletes on MongoDB

**Spec:** [`spec.md`](./spec.md) · **Linear:** [TML-3478](https://linear.app/prisma-company/issue/TML-3478) · **Branch:** `tml-3478-mongo-renames`

One implementer and one reviewer, both on Opus, resumed across every dispatch. Briefs are in `dispatches/`.

## Gate for every dispatch

- `pnpm typecheck`; `pnpm --filter <touched package> lint`; `pnpm --filter <touched package> test`.
- `pnpm lint:deps` when imports change; `pnpm fixtures:check` when rendering or classes change; `pnpm check:error-reference` when error codes change; `pnpm lint:framework-vocabulary` when `packages/1-framework` changes; `pnpm lint:throws` and `pnpm lint:casts`.
- Integration and e2e: only named files, run as `pnpm test <file>`. Never `pnpm test:integration`, `test:e2e` or `test:all`.
- The reviewer runs code against mongodb-memory-server, not only reads it (F34), and follows every printed advice (F46).

## Dispatches

| # | Outcome | Builds on |
| --- | --- | --- |
| 1 | A `renameCollection` operation exists end to end: factory, call, serializer, runner, preview text, with before and after checks. Also reports how variants are stored today (TML-2447) | slice 2 |
| 2 | `renameField` and `unsetField` rewrites exist end to end, skip validation, carry `widening` and `destructive`, and the runner and serializer tell them from DDL by shape | 1 |
| 3 | The planner carries out statements: collection rename on the working schema, field rename (filtered by discriminator for a variant), field removal as data loss, the operation order, the refusals. `renameStatements` and `keepDataByHand` are deleted | 2 |
| 4 | Journeys for the slice's done conditions through both commands; docs; app and extension upgrade fragments; every printed advice followed | 3 |

**Hand-offs**
- 1 → 3: `renameCollection` can be planned and rendered.
- 2 → 3: `renameField` and `unsetField` can be planned and rendered, and run under `db update`'s classes.
- 3 → 4: both commands rename and delete on MongoDB.

## Coordination with 3a

3a runs at the same time on `tml-3477-convert-backfill` and adds a `kind` to resolved statements. Whichever merges second merges `main` and adapts. After 3a, the MongoDB planner handles `kind: 'rename'` and refuses `convert` and `backfill`.

## Open items

- ADR 188 and ADR 264 amendments: written by the orchestrator in dispatch 4's branch.
- Dispatch 1 found TML-2447's gaps fixed on `main`: variants share their base's collection, and the validator has a `oneOf` branch per variant pinned to its discriminator value. Variant field renames stay in 4a. Dispatch 4 removes the stale "Known gaps" paragraph from the MongoDB Family doc § Polymorphic variants.
