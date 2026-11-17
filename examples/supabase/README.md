# Supabase example

The canonical runnable Prisma 8 + Supabase app, and the walking skeleton the [`extension-supabase`](../../packages/3-extensions/supabase) integration was built against. Its test suite runs end-to-end against a live `supabase start` stack — locally against your own, and in CI on every PR. (Hermetic PGlite coverage of the same flows lives with the extension package.)

## What it demonstrates

- **`external` contract** — the app composes `supabasePack` via `extensions`; the planner emits no DDL for `auth.*` / `storage.*`, and `db verify` confirms they exist in the database.
- **Cross-contract FK with cascade** — `Profile.userId → supabase:auth.AuthUser.id` (`onDelete: Cascade`); deleting an `auth.users` row removes the profile.
- **RLS through the framework authoring surface** — the `Profile` policies are declared in PSL (`policy_select` / `policy_update` + `@@rls` in [`src/contract.prisma`](src/contract.prisma)) and applied by `dbInit` — no hand-authored `CREATE POLICY`.
- **Role-bound runtime** — `asUser(jwt)` (RLS-scoped to the token owner), `asAnon()` (public-read policy), `asServiceRole()` (BYPASSRLS).
- **`service_role` admin root** — `asServiceRole().supabase.sql.auth.sessions` reads a Supabase-internal table, including a native-enum column (`aal`), via the secondary `.supabase` root.
- **Explicit namespace-qualified queries** — `db.sql.public.profile` and `db.sql.auth.sessions` address colliding names across schemas.

## The stack

[`prisma.config.ts`](prisma.config.ts) wires the SQL family + Postgres target and composes the Supabase pack:

```ts
extensions: [supabasePack],
contract: prismaContract('./src/contract.prisma', {
  output: 'src/contract.json',
  target: postgresPackRef,
  createNamespace: postgresCreateNamespace,
}),
```

The contract is a single `Profile` model in `public` with a cross-contract FK into `auth.users` and three RLS policies (own-read, public-read, own-update-with-check). The queries live in [`src/profile-queries.ts`](src/profile-queries.ts) (app tables via a `RoleBoundDb`) and [`src/session-queries.ts`](src/session-queries.ts) (the `auth.sessions` admin read via `SupabaseInternalDb`, typed by its native `aal_level` enum).

## Running the tests

This example's test suite is the real-Supabase acceptance run — everything here works against your own `supabase start` stack, exactly as you would run it after copying the example out of the repo. (The hermetic PGlite coverage of the same flows lives with the extension, in `packages/3-extensions/supabase/test/`.)

`test/real-supabase.acceptance.test.ts` runs the RLS role-binding flows — anon read, authenticated update-own, service-role read, JWT failure, and a GoTrue-issued token verified through the project's JWKS endpoint — against a live Supabase Postgres. CI runs it on every PR via the `supabase-acceptance` job (`.github/workflows/ci.yml`): `supabase start` in this directory (the minimal `supabase/config.toml` here is what the CLI needs), then the suite with credentials exported from `supabase status`.

To run it locally against your own stack (the variables must be set in the test command's environment — `supabase status` prints each value):

```bash
supabase start   # in examples/supabase
DATABASE_URL='postgres://…' \
SUPABASE_JWT_SECRET='…' \
SUPABASE_URL='http://127.0.0.1:54321' \
SUPABASE_ANON_KEY='…' \
pnpm test
```

(`DATABASE_URL` is the direct, service_role-capable DB URL; `SUPABASE_JWT_SECRET` signs the self-minted HS256 test tokens; `SUPABASE_URL` + `SUPABASE_ANON_KEY` enable the GoTrue/JWKS test.)

The suite is **skipped** (green) whenever `DATABASE_URL` or `SUPABASE_JWT_SECRET` is unset; the GoTrue/JWKS test additionally needs `SUPABASE_URL` + `SUPABASE_ANON_KEY`. Three flows self-mint HS256 tokens with the stack's real `SUPABASE_JWT_SECRET`; the JWKS flow uses a token the stack's own auth server issues (ES256 on a current stack) and verifies it through `/auth/v1/.well-known/jwks.json` — the signing configuration a new Supabase project has out of the box. Seeded `auth.users` rows are torn down after each flow.
