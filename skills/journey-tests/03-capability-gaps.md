# Journey 03 — Capability-gap honesty

**Skills under test:** `prisma-next-contract`, `prisma-next-migrations`, `prisma-next-queries`, `prisma-next-build`, `prisma-next-debug`, `prisma-next-feedback`.

**Acceptance criterion:** The agent names the gap, names the workaround, and routes to `prisma-next-feedback`; it does not fabricate an API call.

The point: when the user asks about a feature Prisma Next doesn't have yet, the agent must NOT confabulate an API. It must name the gap, suggest the workaround, and route to `prisma-next-feedback` so the request becomes a tracked issue.

## Prompts and expected responses

### 03a — Validations

> Add a validation: email must contain '@'.

- [ ] Agent names the gap: validations not first-class in PN.
- [ ] Agent suggests app-side validation with arktype or zod.
- [ ] Agent routes to `prisma-next-feedback` for the feature request.

### 03b — Lifecycle callbacks

> Run a `beforeSave` hook on User to lowercase the email.

- [ ] Agent names the gap: lifecycle callbacks not first-class.
- [ ] Agent suggests middleware (per `prisma-next-runtime`) or app code.
- [ ] Agent routes to `prisma-next-feedback` for the feature request.

### 03c — Studio

> Open Prisma Studio.

- [ ] Agent names the gap: Studio not shipped.
- [ ] Agent suggests `prisma db schema` for CLI tree output.
- [ ] Agent routes to `prisma-next-feedback` for the feature request.

### 03d — EXPLAIN

> EXPLAIN this query.

- [ ] Agent names the gap: no `.explain()` first-class method.
- [ ] Agent suggests ``db.raw.sql`EXPLAIN ANALYZE ${...}` ``.
- [ ] Agent routes to `prisma-next-feedback` for the feature request.

### 03e — Runtime-apply migrations

> Apply pending migrations from app startup code.

- [ ] Agent names the gap: no runtime-apply migrations API.
- [ ] Agent suggests `prisma db migrate` from the deploy pipeline.
- [ ] Agent routes to `prisma-next-feedback` for the feature request.

### 03f — Next.js plugin

> Set up Prisma Next contract auto-emit in my Next.js project.

- [ ] Agent loads `prisma-next-build`.
- [ ] Agent names the gap: no first-party Next.js plugin yet.
- [ ] Agent suggests the `prebuild` script workaround.
- [ ] Agent routes to `prisma-next-feedback` if the user wants the gap closed.

## Success criteria

- [ ] For each prompt, the agent named the gap, named the workaround, and routed the user to `prisma-next-feedback` (not just a bare URL).
- [ ] The agent did NOT fabricate an API call against a non-existent surface (`User.validates(...)`, `db.studio()`, `query.explain()`, `db.applyMigrations()`, `@internal/next-plugin-contract-emit`).
