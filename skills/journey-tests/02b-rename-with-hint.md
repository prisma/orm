# Journey 02b — Rename a column (capability gap: no in-contract hint)

**Skills under test:** `prisma-8-contract`, `prisma-8-migrations`, `prisma-8-feedback`.

## Prompt

> Rename the `email` column on User to `emailAddress`.

## Expected agent behavior

- [ ] Names the capability gap explicitly: PN has no in-contract rename hint today; the planner sees a destructive drop+add.
- [ ] Edits the contract to rename the field (no fabricated `@hint(...)` syntax).
- [ ] Runs `contract emit`.
- [ ] Runs `migration plan --name rename-user-email`.
- [ ] Runs `migration show <slug>` and confirms the plan is a `DROP COLUMN` + `ADD COLUMN` — the destructive shape the user was warned about.
- [ ] Walks the user through hand-editing `migration.ts` to rewrite the destructive op as a `RENAME COLUMN`, then `node migrations/app/<dir>/migration.ts` to self-emit and `db migrate`.
- [ ] Offers to route a feature request for a first-class rename hint via `prisma-8-feedback`.

## Success criteria

- [ ] Migration that actually applies uses RENAME (because the agent hand-edited it), not DROP+ADD.
- [ ] No data lost.
- [ ] Agent did NOT confabulate `@hint(was: "...")` or any other unimplemented hint syntax.
