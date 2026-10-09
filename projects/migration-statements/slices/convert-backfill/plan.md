# Slice plan — 3a, `--convert` and `--backfill`

**Spec:** [`spec.md`](./spec.md) · **Linear:** [TML-3477](https://linear.app/prisma-company/issue/TML-3477) · **Branch:** `tml-3477-convert-backfill`

One implementer and one reviewer, both on Opus, resumed across every dispatch. Briefs are in `dispatches/`.

## Gate for every dispatch

- `pnpm typecheck`; `pnpm --filter <touched package> lint`; `pnpm --filter <touched package> test`.
- `pnpm lint:deps` when imports change; `pnpm fixtures:check` when rendering or classes change; `pnpm check:error-reference` when error codes change; `pnpm lint:framework-vocabulary` when `packages/1-framework` changes; `pnpm lint:throws` and `pnpm lint:casts` (CI runs them, `lint:agent` skips them).
- Integration and e2e: only named files, run as `pnpm test <file>`. Never `pnpm test:integration`, `test:e2e` or `test:all`.
- The reviewer runs code, not only reads it (`drive/calibration/failure-modes.md` F34): SQL the slice renders is compiled and run on PGlite and SQLite, and every printed advice is followed (F46).

## Dispatches

| # | Outcome | Builds on |
| --- | --- | --- |
| 1 | `--convert` and `--backfill` are parsed, resolved and handed to the planners; each data-loss entry says `drop` or `typeChange`; questions offer the right verbs; `db update` refuses both flags | slice 2 |
| 2 | Postgres: a lossy type change plans nothing without a statement; `--convert` writes `alterColumnType` with a `using` placeholder; `alterColumnType` takes plain options | 1 |
| 3 | Postgres: `--backfill` writes the backfill scaffold; without it a new required field gets the temporary default as a real call in `migration.ts`; optional-to-required is a direct `SET NOT NULL` | 1 |
| 4 | SQLite: the rebuild takes a per-column copy expression; `--convert`, `--backfill` and the temporary value work as on Postgres | 2, 3 |
| 5 | The NOT NULL failure names the NULL rows and suggests a fix, on Postgres and SQLite (TML-3517) | 3, 4 |
| 6 | Journeys for the slice's done conditions; docs; app upgrade fragment and facade upgrade instructions; every printed advice followed | 1–5 |

**Hand-offs**
- 1 → 2, 3: planners receive convert and backfill as destination coordinates, and a converted change leaves `dataLoss`.
- 2 → 4: the converted alter is `data`; the `using` slot renders as code and blocks `toOp()` while unfilled.
- 3 → 4: the temporary default renders as a call that reproduces `ops.json`.
- 6 → slice DoD.

## Coordination with 4a

4a runs at the same time on `tml-3478-mongo-renames`. Both touch `plan-questions.ts` and the resolved statement type. Whichever merges second merges `main` and adapts. The MongoDB planner must keep refusing `convert` and `backfill` statements until 4b.

## Open items

- ADR 200 amendment: written by the orchestrator in dispatch 6's branch, not by the implementer.
