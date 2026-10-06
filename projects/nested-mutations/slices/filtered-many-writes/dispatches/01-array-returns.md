# Brief: filtered-many-writes D1 — array returns from relation callbacks

## Task

In `packages/3-extensions/sql-orm-client`, let a relation callback inside `create()` or `update()` data return a readonly array of the existing nested operations (`create`, `connect`, `disconnect`) in addition to a single operation. The operations for one relation are applied in array order. An empty array is a no-op. A nested array, or an element that is not an operation descriptor, is rejected with `ORM.RELATION_MUTATION_INVALID`. A callback that returns a single operation behaves exactly as before. Port one upstream engine test that exercises this.

## Scope

**In:**
- The relation-callback return type in `src/types.ts`, `parseMutationInput` and the per-relation application in `createGraph` and `updateFirstGraph` in `src/mutation-executor.ts`, the descriptor check in `src/relation-mutator.ts`.
- Unit tests and type tests in the package's `test/`; integration tests under `test/integration/test/sql-orm-client/` on Postgres and on SQLite.
- Port of `writes/nested_mutations/combining_different_nested_mutations.rs` › `create_then_disconnect` into `test/integration/test/ports/engines/writes/nested_mutations/`, following `test/integration/test/ports/README.md`, with its checklist entry in `projects/port-all-tests/checklists/engines-writes.md` checked off with its disposition.

**Out:**
- Any new operation kind (`where`, `updateAll`, `deleteAll`, `upsert`, options on `create`). They are later dispatches.
- The executor's order across different relations (parent-owned before the parent row is written; child-owned and junction after). It must not change.
- The other four tests of `combining_different_nested_mutations.rs`.
- Docs and upgrade instructions (dispatch 6).
- `disconnect` stays rejected in `create()`, including when it appears inside an array.

## Completed when

- [ ] Tests written first exist and pass for: array of two or more operations on one relation in `update()` (order observable in the result), array in `create()`, empty array, nested array rejected, non-descriptor element rejected, `disconnect` inside an array in `create()` rejected, single-operation callbacks unchanged. Type tests cover the array return in both contexts.
- [ ] Integration tests for the array return pass on Postgres and on SQLite.
- [ ] `create_then_disconnect` is ported and passing, or ported as a failing port with an `engines/failing.md` entry stating the Prisma 8 difference; its checklist entry is checked off.
- [ ] The validation gates below pass.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal — even if it looks useful — halts and surfaces.

## References

- Slice spec: `projects/nested-mutations/slices/filtered-many-writes/spec.md` — chosen design, rejections, edge cases.
- Slice plan entry: `projects/nested-mutations/slices/filtered-many-writes/plan.md` § Dispatch 1.
- Project spec (background): `projects/nested-mutations/spec.md`.
- Upstream source for the port: clone `https://github.com/prisma/prisma-engines` at `e922089b7d7502aff4249d5da3420f6fa55fc6ad`; file `query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/combining_different_nested_mutations.rs`. A sparse checkout may exist at `/tmp/claude-1500/-home-sevinf--herdr-worktrees-prisma-next-nested-mutations/026b22ae-4f67-40d7-84bd-6a9357ce9422/scratchpad/prisma-engines`; if it is gone, clone into a temporary directory outside the repo.
- Existing tests to follow: `packages/3-extensions/sql-orm-client/test/relation-mutator.test.ts`, `test/mutation-executor.test.ts`, `test/integration/test/sql-orm-client/nested-mutations.test.ts`, `mn-nested-write.test.ts`, and the `*-sqlite.test.ts` files beside them for the SQLite harness.
- Existing engine port to follow for layout: `test/integration/test/ports/engines/writes/top_level_mutations/create_many/`.
- Calibration: `drive/calibration/dod.md` (gates, F14 — lint is a separate CI job).

## Operational metadata

- **Model tier:** mid — a typed-surface change in one package with tests.
- **Time-box:** 90 minutes. Overrun → halt and surface.
- **Halt conditions:** a file outside the scope above needs changing; the array return cannot be added without changing the order across relations; the port needs a schema Prisma 8's PSL cannot express.

## Validation gates

- `pnpm --filter @internal/sql-orm-client typecheck` and the package's test typecheck if its `typecheck` script covers `src` only
- `pnpm --filter @internal/sql-orm-client test`
- `pnpm --filter @internal/sql-orm-client lint`
- The integration test files you added or changed, and the ported test, run through the integration package's own test script
- `pnpm fixtures:check` if you added a port fixture

The worktree has dependencies installed but nothing built. Run `pnpm build` once before the first typecheck or test.

## Repo and owner rules that override your defaults

- Write no code comments at all. Not in source, not in tests.
- Tests before implementation. Test names omit "should". No boolean `it.each`. In sql-orm-client tests, assert the whole result shape with an explicit `select`.
- No `any`, no `@ts-expect-error` outside negative type tests, no bare `as` in production code (use `blindCast` / `castAs` from `@internal/utils/casts`), no suppressed biome lints, no file extensions in imports, no re-exports outside `exports/`.
- Use `pnpm`, never `npx`. Do not switch Node versions.
- Commits: explicit staging only, signed off (`git commit -s`), no amend, no push. End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do not edit anything under `projects/nested-mutations/`. You may edit `projects/port-all-tests/checklists/` for the one checklist entry.
- Never reply to GitHub comments or issues.
