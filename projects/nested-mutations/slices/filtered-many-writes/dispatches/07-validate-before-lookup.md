# Brief: filtered-many-writes D7 — validate nested input before the parent lookup

## Task

Your D5 port showed that `update()` looks up the parent row before it parses nested relation input, so on a filter that matches nothing it resolves `null` even when the nested input is invalid. Change the update path in `packages/3-extensions/sql-orm-client/src/mutation-executor.ts` so nested input is parsed, and every rejection that does not depend on the parent row's values is raised, before the lookup.

## Scope

**In:**
- The update path (`updateFirstGraph` and what it calls): parse first, then run the context-free checks, then look up the parent.
- Rejections that move ahead of the lookup, for every nested operation kind including the pre-existing ones: a relation field that is not a callback; an invalid descriptor, nested array or non-descriptor array element; `updateAll` / `deleteAll` / `where` on a to-one relation; `updateAll` data that sets a column linking the child to the parent; `disconnect()` without criteria on a many-to-many relation; `create` / `connect` on a junction with required payload columns; any other check that reads only the input and the contract.
- Checks that need the parent row's values or database state stay where they are.
- Unit tests in the package and integration tests on Postgres and SQLite: for each moved rejection, an `update()` whose filter matches no row rejects with the same code as when a row matches.
- The port of `disallow_write_parent_inline_rel_sclrs`: remove `it.fails`, remove its `engines/failing.md` entry, update its checklist disposition text to `PASS` (box stays unticked).
- `docs/reference/error-reference.md` and the README's nested-writes section, only if a sentence there is made untrue by this change.

**Out:**
- The create path, unless it has the same ordering problem; if it does, report it and include it only if the change is the same few lines.
- Any change to which inputs are rejected or to the error codes.
- The executor's order across relations, and the order of statements once the parent is found.

## Completed when

- [ ] Tests written first show each moved rejection firing with no matching parent row, and were seen failing before the change.
- [ ] An `update()` with valid nested input and no matching row still resolves `null` and issues no write; a test pins it.
- [ ] `disallow_write_parent_inline_rel_sclrs` passes as a plain test; `engines/failing.md` has no entry for it.
- [ ] The validation gates pass.

## Operational metadata

- **Time-box:** 60 minutes.
- **Halt conditions:** a rejection cannot be moved without the parent row; moving the parse changes the result of any existing test other than by making a previously-`null` invalid call reject.

## Validation gates

- `pnpm --filter @internal/sql-orm-client typecheck`, `test`, `lint`
- In `test/integration`: `pnpm typecheck`, `pnpm lint`, `pnpm test` on the sql-orm-client nested-mutation files and on `test/ports/engines/writes/unchecked_writes`
- `pnpm fixtures:check` only if a fixture changed
