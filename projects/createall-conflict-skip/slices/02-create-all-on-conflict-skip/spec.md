# Slice 2: `onConflict: 'skip'` on `createAll` and `createAndCount`

Project: [`../../spec.md`](../../spec.md) · Plan entry: [`../../plan.md`](../../plan.md) § Slice 2 · Depends on slice 1 (PR #30364) · Linear issue: _not yet created_

## Outcome

```ts
await db.User.createAll(rows, { onConflict: 'skip' });
await db.User.createAll(rows, { onConflict: 'skip', conflictOn: ['email'] });
await db.User.createAndCount(rows, { onConflict: 'skip' });
```

Rows that collide with a unique constraint are skipped by the database. `createAll` yields only the inserted rows. `createAndCount` returns the database's count. The option is gated on adapter-reported capabilities and refused where they are absent. Postgres and SQLite support it end to end.

## Design (settled, do not reopen)

- **Option shape.** `createAll(rows, options?, configure?)` and `createAndCount(rows, options?, configure?)`. `options` is `{ onConflict: 'skip'; conflictOn?: readonly Field[] }` where `Field` is a scalar field name of the model. The existing two-argument call with the `configure` callback in second position keeps working: distinguish by `typeof arg === 'function'`. The option's only value is `'skip'`; it never gains an update value, `upsert` owns that.
- **Compilation.** Every insert plan the call produces (one on Postgres, one per column-signature group on the split path) gets `InsertOnConflict` with a `do-nothing` action. `conflictOn` fields map to columns through the same field-to-column mapping `upsert`'s `resolveUpsertConflictColumns` uses (`src/collection-contract.ts`); absent, `columns` is empty.
- **AST.** `InsertOnConflict` with empty `columns` is valid only with `do-nothing`. Add a static constructor for the targetless form (for example `InsertOnConflict.doNothing()`), keep `on(columns)` requiring at least one column for `doUpdateSet`. Both renderers emit `ON CONFLICT DO NOTHING` for the targetless form and keep throwing `RUNTIME.AST_INVALID` for a targetless `do-update-set`. `collectParamRefs` and `rewriteOnConflict` handle the empty case.
- **Capabilities.** Two new `sql` keys, reported by the Postgres and SQLite adapters in both their runtime profile (`adapter.ts` `defaultCapabilities`) and their emitted-contract capability map (`descriptor-meta.ts`), and documented in `docs/reference/capabilities.md`:
  - `insertOnConflictSkip`: the adapter can skip rows on unique conflict.
  - `insertOnConflictWithoutTarget`: it can do so without naming the constraint.
  The ORM refuses `onConflict: 'skip'` with `ORM.CAPABILITY_MISSING` unless the contract's capabilities carry the first; it refuses the untargeted form unless they carry the second. Gate on the key, never on a target id.
- **Refusals.** MTI variant collections refuse the option with `ORM.OPERATION_UNSUPPORTED` (the shape `createAndCount` already uses via `#assertNotMtiVariant`). A `conflictOn` field that is not a scalar field of the model is refused with `ORM.ARGUMENT_INVALID`.
- **`create()` does not take the option.**
- **Mongo untouched.**

## In scope

1. relational-core AST change and its unit tests (`packages/2-sql/4-lanes/relational-core/test/ast/insert.test.ts`).
2. Postgres and SQLite renderer changes and their unit tests (`packages/3-targets/6-adapters/{postgres,sqlite}/test/adapter.test.ts`).
3. Adapter capability profiles (`6-adapters/postgres/src/core/adapter.ts` `defaultCapabilities`, `6-adapters/sqlite/src/core/adapter.ts`) and `docs/reference/capabilities.md`.
4. `pnpm fixtures:check` regeneration of emitted contracts that carry the capability map. Drift outside the capability map is investigated, not committed. Migration snapshots are not regenerated.
5. ORM option in `packages/3-extensions/sql-orm-client/src/collection.ts` and `src/query-plan-mutations.ts`, with unit tests (`test/query-plan-mutations.test.ts`, `test/collection.state.test.ts`) and Postgres integration tests (`test/integration/test/sql-orm-client/create.test.ts` or a new sibling file if that one nears 500 lines).
6. SQLite end-to-end test in `test/e2e/framework/test/sqlite/orm.test.ts`: batch with one conflict, returned rows and count.
7. Docs: the ORM client's user-facing docs for `createAll` / `createAndCount` gain the option; `scorecard/06-sql-orm-client.md` row `createMany({ skipDuplicates })` becomes proven on both targets with test links; `projects/port-all-tests/checklists/engines-writes.md` skip-duplicates cases ported or marked not applicable with a reason.
8. Upgrade note: contracts emitted before this change lack the keys and are refused when the option is used; users regenerate. Record with the `record-upgrade-instructions` skill if the change qualifies as breaking for extension authors; otherwise a release-note line.

## Out of scope

- Batch upsert, MTI support via savepoints, Mongo, MySQL or SQL Server implementations, nested creates, reporting which rows were skipped.

## Edge cases

| Case | Expected |
| --- | --- |
| Postgres, 3 rows, one collides on `email` unique, untargeted | One statement, `ON CONFLICT DO NOTHING RETURNING ...`; `createAll` yields 2 rows; `createAndCount` returns 2. |
| Same with `conflictOn: ['email']` | `ON CONFLICT ("email") DO NOTHING`. |
| Collision on a constraint other than the one named in `conflictOn` | The database raises a unique violation; the ORM surfaces it as today. Not skipped. |
| SQLite split path, two column-signature groups, one collision | Each statement carries the clause; count is the summed `changes`. |
| All rows collide | `createAll` yields nothing; `createAndCount` returns 0; no error. |
| Contract without `insertOnConflictSkip` | `ORM.CAPABILITY_MISSING`, before any statement executes. |
| Contract with `insertOnConflictSkip` but without `insertOnConflictWithoutTarget`, untargeted call | `ORM.CAPABILITY_MISSING`; targeted call proceeds. |
| MTI variant collection | `ORM.OPERATION_UNSUPPORTED`. |
| `conflictOn: []` | Treated as absent (untargeted). |
| `conflictOn` names a relation or unknown field | `ORM.ARGUMENT_INVALID`. |
| Option object with anything other than `onConflict: 'skip'` | Type error; at runtime an unknown `onConflict` value is `ORM.ARGUMENT_INVALID`. |
| Existing `createAll(rows, configure)` callers | Unchanged behaviour. |
| Targetless `do-update-set` reaching a renderer | `RUNTIME.AST_INVALID`, unit tested in both adapters. |

## Slice Definition of Done

Inherits [`drive/calibration/dod.md`](../../../../drive/calibration/dod.md) slice overlay, including `pnpm fixtures:check`, `pnpm lint:deps`, and a downstream `pnpm typecheck` after `pnpm build` of relational-core and both adapters.

- [ ] Every edge case above has a test that fails if the behaviour is removed.
- [ ] Postgres integration and SQLite end-to-end tests prove the returned rows and the count on a genuine collision.
- [ ] `docs/reference/capabilities.md`, ORM docs, scorecard, and the port checklist are updated.
- [ ] No `projects/` reference in any long-lived file.
- [ ] `pnpm --filter` tests and lint for relational-core, both adapters, sql-orm-client; `pnpm test:integration` scoped to the touched files; `pnpm test:e2e` scoped to sqlite orm; `pnpm fixtures:check`; `pnpm lint:deps`.
