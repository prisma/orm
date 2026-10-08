# Journey 02b — Rename a column with a statement

**Skills under test:** `prisma-8-contract`, `prisma-8-migrations`.

## Prompt

> Rename the `email` column on User to `emailAddress`.

## Expected agent behavior

- [ ] Edits the contract to rename the field (no fabricated `@hint(...)` or other rename attribute in the contract source).
- [ ] Runs `contract emit`.
- [ ] Runs `migration plan --name rename-user-email --rename User.email:User.emailAddress`.
- [ ] Runs `migration show <slug>` and confirms the plan renames the column instead of dropping and adding it.
- [ ] Runs `db migrate`.

## Success criteria

- [ ] Migration that actually applies uses RENAME, not DROP+ADD.
- [ ] No data lost.
- [ ] Agent did NOT confabulate `@hint(was: "...")` or any other rename syntax in the contract source.
