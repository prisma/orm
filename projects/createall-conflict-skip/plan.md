# Plan: createAll conflict skip

**Spec:** [`spec.md`](./spec.md) · **Design notes:** [`design-notes.md`](./design-notes.md)

Two slices, sequential. Each is one PR against `main`. Slice 2 starts after slice 1 merges.

## Slice 1: `createAndCount` returns the database count

Linear issue: _to be created_ · Folder: `slices/01-create-and-count-affected-rows/`

Outcome: `createAndCount` returns `affectedRows` from the execute statistics on Postgres and on the SQLite split path, never `data.length`.

Dispatches:

1. **Tests first.** Integration test on Postgres and end-to-end test on SQLite where the database inserts fewer rows than passed. Today the only way to make that happen without this project's feature is a raw-SQL trigger or a `BEFORE INSERT` rule that drops a row; if that is too contrived, the test asserts the count comes from the execute statistics by spying on the runtime in the unit tier and the integration test asserts the happy-path count. Test must fail against the current implementation.
2. **Fix.** `collection.ts` `createAndCount` reads `stats.affectedRows` on both paths and sums it on the split path. Package tests, typecheck, lint.

Gates: `pnpm --filter @internal/sql-orm-client test`, `pnpm typecheck`, `pnpm --filter @internal/sql-orm-client lint`, `pnpm test:integration` scoped to `sql-orm-client/create`.

## Slice 2: `onConflict: 'skip'` on `createAll` and `createAndCount`

Linear issue: _to be created_ · Folder: `slices/02-create-all-on-conflict-skip/`

Outcome: the option in the spec ships on Postgres and SQLite, capability-gated, refused on multi-table inheritance variants, documented, and proven on both targets.

Dispatches, in order:

1. **AST and renderers.** Relax `InsertOnConflict` so empty `columns` is valid with `do-nothing` only. Both renderers emit the bare clause and keep refusing a targetless `do-update-set`. Unit tests in relational-core and in both adapter packages first.
2. **Capability keys.** Postgres and SQLite adapter profiles report `sql.insertOnConflictSkip` and `sql.insertOnConflictWithoutTarget`. `docs/reference/capabilities.md` gains both rows. `pnpm fixtures:check` regenerates emitted contracts; investigate any drift outside the capability map.
3. **ORM option.** `createAll` and `createAndCount` accept `options?` before `configure?`. Compile the clause on every insert plan. Capability checks, `conflictOn` field mapping, MTI refusal. Unit tests in `query-plan-mutations.test.ts` and integration tests in `create.test.ts` first, plus the SQLite end-to-end case.
4. **Docs and scorecard.** ORM client docs for the option, scorecard row flipped to proven with test links, the three engine cases in the port-all-tests checklist ported or marked not applicable.

Gates: everything in slice 1, plus `pnpm fixtures:check`, `pnpm lint:deps`, `pnpm test:e2e` scoped to sqlite orm, and a downstream `pnpm typecheck` after `pnpm build` of relational-core and both adapters.

## After merge

- Record both PRs as done deliverables on the asks record and satisfy the ask.
- Will replies to broken.wind in the thread; the next reading run discharges the commitment.

## Close-out (required)

- [ ] Verify all conditions in [`spec.md`](./spec.md) § Project Definition of Done
- [ ] Decide whether the "conflict target is part of the API" rule amends the capability-gating pattern doc
- [ ] Strip repo-wide references to `projects/createall-conflict-skip/**`
- [ ] Delete `projects/createall-conflict-skip/`
