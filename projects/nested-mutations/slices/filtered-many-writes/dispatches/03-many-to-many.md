# Brief: filtered-many-writes D3 — `updateAll` and `deleteAll` on many-to-many

## Task

Make `r.where(w).updateAll(data)`, `r.where(w).deleteAll()`, `r.updateAll(data)` and `r.deleteAll()` work on a many-to-many relation inside `update()`, replacing the runtime rejection you added in D2. Each issues one statement on the target table, limited to target rows that have a junction row to this parent and that match the filter. `deleteAll` issues no statement on the junction table.

## Scope

**In:**
- The junction path in `packages/3-extensions/sql-orm-client/src/mutation-executor.ts`.
- Removing the D2 many-to-many rejection and replacing the integration test that asserts it.
- Unit tests on the statement structure, and integration tests on Postgres and SQLite.

**Out:**
- The mutator's types, beyond what lifting the rejection needs.
- Any delete or update of junction rows by the ORM.
- Ports (D4, D5). Docs (D6).
- The executor's order across relations.

## Completed when

- [ ] Unit tests assert the statement's `where` structure for both operations: the junction-membership condition for this parent ANDed with the whole filter, with no `where`, with chained `where`, and with an OR filter.
- [ ] Integration tests pass on Postgres and on SQLite for both operations, each including a target that is linked only to another parent, matches the filter, and is unchanged, with the whole target table read back.
- [ ] A `deleteAll` integration test with junction foreign keys that cascade: matched targets are deleted and their junction rows are gone.
- [ ] A `deleteAll` integration test with junction foreign keys that do not cascade: the database's error surfaces and the whole `update()` is rolled back, including an earlier operation in the same call.
- [ ] A target linked to this parent and to another parent, matched by `updateAll`: it is updated (it is related to this parent), and the test states that in its name.
- [ ] `updateAll` applies update defaults and issues no statement for empty data, as on one-to-many.
- [ ] The validation gates pass.

## Decisions standing (do not relitigate)

- Junction rows are left to the schema's foreign-key action. This is a project decision.
- Rejection codes, bare `@ts-expect-error`, no checklist ticks: as in D2.
- No guard for a relation with empty link columns.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note. Anything that pulls you off the goal halts and surfaces.

## Operational metadata

- **Time-box:** 90 minutes. Overrun → halt and surface.
- **Halt conditions:** the junction-membership condition cannot be expressed with the existing SQL AST on both adapters; a composite junction key needs AST support that does not exist; a file outside Scope needs changing.

## Validation gates

- `pnpm --filter @internal/sql-orm-client typecheck`
- `pnpm --filter @internal/sql-orm-client test`
- `pnpm --filter @internal/sql-orm-client lint`
- In `test/integration`: `pnpm typecheck`, `pnpm lint`, and `pnpm test` on the integration files you added or changed
