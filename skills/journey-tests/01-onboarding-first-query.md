# Journey 01 — Onboarding to first query

**Skills under test:** `prisma-next-quickstart`, `prisma-next-contract`, `prisma-next-migrations`, `prisma-next-queries`.

**Example app:** A fresh directory scaffolded with `pnpm dlx @prisma/cli orm init` (run inside the new directory — `init` operates in `cwd` and does not take a project-name argument), or `examples/prisma-8-demo` with the User model deleted.

**Acceptance criterion:** AC4 from `specs/usage-skill.spec.md`.

## Prompt

> add a User model with id and email, and let me list all users

## Expected agent behavior

- [ ] Reads `prisma.config.ts` to confirm target and authoring mode.
- [ ] Opens the contract source (`schema.psl` or `prisma/contract.ts`).
- [ ] Adds a `User` model with `id` (auto-increment PK) and `email` (string, unique).
- [ ] Runs `pnpm prisma contract emit` (or the project-pm equivalent).
- [ ] Plans + applies a migration (or uses `db update` for dev).
- [ ] Writes a query handler that calls `db.orm.User.select(...).all()` (the ORM lane is the default; the SQL builder and raw lanes are alternatives the `prisma-next-queries` skill covers).
- [ ] Runs the handler and observes the empty array (or rows if seeded).

## Success criteria

- [ ] The added `User` model matches Prisma Next's PSL idioms (`@id`, `@default(autoincrement())`, `@unique`).
- [ ] `contract.json` and `contract.d.ts` updated (timestamps advanced).
- [ ] The DB has the `user` table (`pnpm prisma db schema` shows it).
- [ ] The handler typechecks and runs without error.
- [ ] The agent did NOT paste Prisma 7 / `prisma generate` patterns.
- [ ] The agent did NOT hand-edit `contract.json` or `contract.d.ts`.

## Failure modes

- Agent suggests `prisma migrate dev` instead of `prisma migration plan` / `db update`.
- Agent forgets to `contract emit`.
- Agent writes raw SQL instead of using the ORM lane (`db.orm.<Model>`).
- Agent confabulates an API that doesn't exist (`db.User.findMany(...)`, Prisma 7-style imports, `prisma generate`).
