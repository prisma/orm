# Brief: D2 — criterion without null

## Task

Make `UniqueConstraintCriterion` in `packages/3-extensions/sql-orm-client/src/types.ts` reject `null` for a nullable unique column, so that `whereUnique`, `upsert`'s `conflictOn` and relation `connect` criteria all reject it. Type tests first. Then record the change for downstream users as an `extension` upgrade-instruction declaration.

## Scope

**In:**

- The criterion type: each constraint column maps to the field's row type without `null`.
- Type tests showing `null` rejected at the three call sites for a nullable unique column, and a non-null value still accepted at each. If no test contract has a nullable unique column, find the smallest way to get one that follows how the package's other type tests obtain contracts, and say what you chose.
- Any caller in the workspace that now fails to compile because it passed `null`; fix the caller, do not loosen the type.
- `upgrade-instructions/pending/<descriptive-name>/extension/instructions.md`, authored per `skills-contrib/record-upgrade-instructions/SKILL.md` and `upgrade-instructions/README.md`. This is a user-visible type change to a public export, so it gets a real `changes[]` entry with prose telling a caller what to do when `conflictOn` or `connect` no longer accepts `null`.

**Out:**

- Any runtime change. What `connect` does at runtime with a `null` criterion today is deliberately not investigated.
- `examples/`, integration tests, the README, the `app` declaration (dispatch 3).
- `RelationConnectCriterion`'s fallback to `Record<string, unknown>` for a model with no constraints: leave it.

## Completed when

- [ ] Type tests cover `null` rejected and a non-null value accepted at `whereUnique`, `conflictOn` and `connect`.
- [ ] Package `pnpm typecheck`, `pnpm test`, `pnpm lint` pass; root `pnpm turbo typecheck --continue --filter="...@internal/sql-orm-client" --filter="!prisma7-adoption"` passes.
- [ ] The `extension` declaration exists and `pnpm check:upgrade-coverage --mode dev --prev origin/main --head HEAD` reports no format error for it (commit first; the check reads committed trees).

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal — even if it looks useful — halts and surfaces.

## Operational metadata

- **Model tier:** Opus (operator override: every dispatch).
- **Time-box:** 1 hour.
- **Halt conditions:**
  - A workspace caller passes `null` on purpose and removing it changes what a test asserts about runtime behaviour. Report the caller; do not rewrite the test's intent.
  - Excluding `null` changes an inferred type somewhere other than these three call sites in a way that makes an existing type test fail.
