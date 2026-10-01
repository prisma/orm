# Journey 02b — Rename a model with a rename hint

**Skills under test:** `prisma-8-contract`, `prisma-8-migrations`.

**Example app:** A Postgres or SQLite project with a `Profile` model whose table holds rows, and at least one applied migration.

## Prompt

> Rename the `Profile` model to `Member`. Keep the existing rows.

## Expected agent behavior

- [ ] Renames the model and adds `@@hint(was: "Profile")` to it (the old table name, as `@@map` would spell it), or `.sql({ hint: { was: 'Profile' } })` in the TS builder.
- [ ] Runs `contract emit`.
- [ ] Runs `migration plan --name rename-profile-to-member`.
- [ ] Confirms the plan renames the table (`Rename table ...` in the operation list, `...this.renameTable({ table: "Profile", to: "Member" })` in `migration.ts`) instead of dropping and creating it, and that `Hints applied` lists the hint.
- [ ] Runs `db migrate`.
- [ ] Tells the user the hint can be removed once the migration is applied.

## Success criteria

- [ ] The applied migration renames the table; no `DROP TABLE`.
- [ ] No rows lost.
- [ ] The agent did not hand-edit `migration.ts` to get the rename.
- [ ] The agent did not invent a field-level hint: a field rename still has no hint, and asking for one routes to `references/feedback.md`.
