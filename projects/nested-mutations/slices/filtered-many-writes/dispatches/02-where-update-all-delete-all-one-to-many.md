# Brief: filtered-many-writes D2 — `where`, `updateAll`, `deleteAll` on one-to-many

## Task

In `packages/3-extensions/sql-orm-client`, add `where`, `updateAll` and `deleteAll` to the relation mutator for one-to-many relations inside `update()`, as the slice spec's "Chosen design" describes: `r.where(w).updateAll(data)`, `r.where(w).deleteAll()`, `r.updateAll(data)`, `r.deleteAll()`. They add two operation kinds to the ordered per-relation list you built in D1.

## Scope

**In:**
- Mutator and descriptor types in `src/types.ts`; `src/relation-mutator.ts`; the child-owned path in `src/mutation-executor.ts`.
- `where` accepts every form the collection's `where()` accepts for the related model (callback over the related model's accessor, shorthand object, direct expression). It returns a narrowed mutator with only `where`, `updateAll`, `deleteAll`. Chained `where` calls combine with AND.
- `updateAll` data is the related model's scalar fields, no relation callbacks. Update defaults are applied as the collection's `updateAll` applies them. Empty data issues no statement. Zero matching rows is not an error.
- Only rows whose foreign key equals the parent's key are affected.
- Rejections, in the types and at runtime:
  - `where` / `updateAll` / `deleteAll` inside `create()` → `ORM.RELATION_MUTATION_UNSUPPORTED`.
  - `where` / `updateAll` / `deleteAll` on a to-one relation (`N:1`, `1:1`) → `ORM.RELATION_MUTATION_UNSUPPORTED`.
  - `updateAll` data that sets a column linking the child to this parent → `ORM.RELATION_MUTATION_INVALID`. Setting another relation's foreign key is allowed.
- Many-to-many relations: until D3, these operations are rejected at runtime with `ORM.RELATION_MUTATION_UNSUPPORTED` and a message saying so. Do not disable them in the types for many-to-many; D3 implements them.
- Unit tests, type tests, and integration tests on Postgres and SQLite, including, for each of `updateAll` and `deleteAll`, a test where a row belonging to another parent matches the filter and is unchanged.

**Out:**
- The many-to-many execution path (D3). Ports (D4, D5). Docs and upgrade instructions (D6).
- `upsert`, options on nested `create`, single-row nested `update`/`delete`.
- The collection's own `updateAll` / `deleteAll`.
- The executor's order across relations.

## Completed when

- [ ] Tests written first exist and pass for every behaviour and rejection listed under Scope, including chained `where`, each accepted filter form, update defaults applied, empty data issuing no statement, no-match being a no-op, and these operations mixed with `create` in one array with order observable.
- [ ] The two "row of another parent is unchanged" integration tests pass on Postgres and on SQLite.
- [ ] The validation gates below pass.

## Decisions standing (do not relitigate)

- Rejection codes are as listed above; the slice spec was corrected after D1 to match (`UNSUPPORTED` for an operation used where it is not available, `INVALID` for malformed input).
- `// @ts-expect-error` in integration `.test.ts` files is accepted where the same test asserts the runtime rejection. Keep the directives bare, with no explanation text.
- Do not tick boxes in `projects/port-all-tests/checklists/`; that is the reviewer's step. This dispatch has no ports.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal halts and surfaces.

## Operational metadata

- **Time-box:** 2 hours. Overrun → halt and surface.
- **Halt conditions:** the callback form of `where` cannot be supported without changing a file outside the package; the scoping condition cannot be expressed with the existing SQL AST; a file outside Scope needs changing.

## Validation gates

- `pnpm --filter @internal/sql-orm-client typecheck`
- `pnpm --filter @internal/sql-orm-client test`
- `pnpm --filter @internal/sql-orm-client lint`
- In `test/integration`: `pnpm typecheck`, `pnpm lint`, and `pnpm test` on the integration files you added or changed
