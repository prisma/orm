# `fixtures:emit` and `fixtures:check` — what they gate (and what they don't)

`fixtures:check` is the repo's guard that generated **contract artifacts** on disk still match what the pipeline produces. It is easy to over-read it as "the migration planner still produces the same operations." **It does not check that.** This page states exactly what each command does so that mistake stops recurring.

## What the commands do

`fixtures:emit` regenerates every committed fixture, in this order:

1. `emit` on the fixture-bearing packages (`examples/*`, `apps/*`, `sql-builder`, `sql-orm-client`, `e2e-tests`, `integration-tests`) — runs the **contract emitter** and rewrites each `contract.json` + `contract.d.ts`. The `integration-tests` package also runs `test/integration/scripts/emit-fixture-configs.mjs`, which walks `test/ports/`, `test/enum-order-by/`, and `test/sql-builder/fixtures/` and re-emits a `prisma.config.ts` only when a committed `generated/` directory sits beside it; every other config is skipped (it belongs to a non-ported suite, or its own test emits to a temp dir).
2. `build:contract-space` on `packages/3-extensions/*` — the extensions' emitted `contract.json`.
3. `migrations:regen` (`scripts/regen-extension-migrations.mjs`) — extension migration artifacts.
4. `migrations:regen:examples` (`scripts/regen-example-migrations.mjs`) — for each example migration: re-emits its bookend contracts into the content-addressed store at `migrations/snapshots/<hex>/contract.*`, then re-runs `tsx migration.ts` to rewrite `ops.json` + `migration.json`. Steps 3 and 4 both write the store through `refreshContractSnapshot` (`scripts/refresh-contract-snapshot.mjs`): the plain `writeContractSnapshot` never rewrites an entry whose hash already exists, so the wrapper compares the entry's `contract.json` and `contract.d.ts` with the fresh emit and replaces the whole entry when either file differs.

`fixtures:check` runs `fixtures:emit` and then:

```bash
git diff --exit-code -- ':(glob)**/contract.*' ':(glob)**/expected.contract.json'
```

## What it gates

**Contract emission, byte-for-byte.** The diff glob covers exactly `contract.json` / `contract.d.ts` and `expected.contract.json` — which also matches every store entry under `migrations/snapshots/<hex>/contract.*`. A green `fixtures:check` means: the contract emitter, the canonicalizer, and the type printer still turn each fixture's schema into the identical committed contract. That is a real and useful invariant — most emitter/serializer/canonicalizer changes are caught here.

## What it does NOT gate

**Planner-generated migration operations.** A change to `MigrationPlanner.plan()` — how the migration planner turns a schema diff into DDL ops — will **not** be caught by `fixtures:check`, for two independent reasons:

1. **The example ops are static, not re-planned.** Each `examples/*/migrations/**/migration.ts` carries its operations as literal factory calls in an `override get operations()` getter (authored once, then committed). Step 4 above re-runs `tsx migration.ts`, which **serializes that static getter** into `ops.json` — it never calls `plan()`. Change the planner and these outputs do not move.
2. **The diff glob excludes them anyway.** `ops.json`, `migration.json`, and `migration.ts` are not in the `git diff` glob, so even a change there would not fail the check.

So `fixtures:check` answers "does the contract emitter still produce identical contracts?" — **not** "does the migration planner still produce identical operations?"

## How planner-op parity is actually proven

When you change the planner and need to prove the emitted operations are unchanged, use these instead:

- **The planner suites** — e.g. `packages/3-targets/3-targets/postgres/test/migrations/{rls-planner,rls-ops,op-factory-call}.test.ts`, `packages/3-targets/6-adapters/*/test/migrations/planner.*`, and the cross-package `test/integration/test/cross-package/*-issue-planner*.test.ts` — where they assert the **exact** op / SQL output.
- **The `migration plan` e2e tests** — `cli.migration-plan-ref-aware.e2e`, `cli-journeys/{migration-plan-details,multi-step-migration,drift-migration-dag}.e2e` — which run the real planner end-to-end.
- **A golden diff of real planner output against the committed example ops.** Run `migration plan --from <prior-migration-dir>` (offline mis-detects the baseline without `--from`) against an example's contract chain and compare the emitted operations to the committed `migration.ts` `operations`. This is the closest thing to a fixture-level byte gate for the planner; there is no automatic one.

## Related

- [`never-hand-edit-contract-fixtures`](../../.agents/rules/never-hand-edit-contract-fixtures.mdc) — the emitted contracts are canonical; regenerate, never hand-edit.
