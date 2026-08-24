
# Prisma Next — Supabase

> **Edit your data contract. Prisma handles the rest.**

This skill covers using Prisma Next against a **Supabase** project end-to-end: composing the Supabase extension pack, referencing Supabase-owned tables from your contract, authoring row-level-security (RLS) policies, and running role-bound queries through the `supabase()` runtime.

## When to Use

- User has a Supabase project (or wants one) and is wiring Prisma Next into it.
- User wants RLS policies on their tables (`policy_select`, `@@rls`, `auth.uid()`).
- User wants per-request role binding (`asUser(jwt)`, `asAnon()`, `asServiceRole()`).
- User wants a foreign key into `auth.users` (cross-space FK).
- User wants to read Supabase-internal tables (`auth.*`, `storage.*`) as an admin.
- User mentions: *supabase, RLS, row level security, policy, anon, authenticated, service_role, auth.users, auth.uid(), JWT, jwtSecret, jwksUrl, SUPABASE.JWT_INVALID, RoleBoundDb, session pooler*.

## When Not to Use

- General contract editing (models, fields, relations) → `references/contract.md`.
- Non-Supabase `db.ts` wiring, middleware, teardown → `references/runtime.md`.
- General query shapes (filtering, includes, aggregates) → `references/queries.md` — everything there applies to a role-bound `db` too.
- Migration planning / applying → `references/migrations.md`.

## Key Concepts

- **The pack is an `external` contract space.** `@internal/extension-supabase/pack` ships a complete, introspection-generated contract of everything Supabase owns — the `auth` and `storage` schemas, their native enum types, and the platform roles (`anon`, `authenticated`, `service_role`) — all with control policy `external`. Composed via `extensions`, it means: the migration planner **emits no DDL** for those objects (Supabase manages them), and `db verify` **confirms they exist** in the live database. Your own tables stay `managed` as usual.
- **Roles come from the pack; you never declare them.** RLS `roles = [authenticated]` identifiers resolve against the composed contract. Pointing the runtime at a non-Supabase Postgres fails verify with a `not-found` issue naming the missing role — the common "wrong database" misconfiguration surfaces before queries run.
- **The runtime is role-first.** `supabase()` returns a `SupabaseDb` with **no top-level query surface** — there is no `db.sql` / `db.orm` until you bind a role. `await db.asUser(jwt)` / `db.asAnon()` / `db.asServiceRole()` each return a `RoleBoundDb` exposing `.sql`, `.orm`, `.raw`, `.execute(plan)`, and `.transaction(fn)`. This is deliberate: in a Supabase app there is no meaningful "no role" execution context, and defaulting to the connection's login role is a silent-RLS-bypass footgun.
- **Role binding is below middleware and cannot leak.** Each role-bound query runs on a connection that had `set_config('role', …)` and `set_config('request.jwt.claims', …)` applied beneath the user-middleware chain, with `RESET ALL` on release. Postgres-side `auth.uid()` / `auth.jwt()` read those session vars — RLS enforcement is Postgres's job; the runtime's job is binding the context.
- **RLS is enforced by policies *and* grants.** Policies filter *rows*; `GRANT` controls *table access*. Prisma Next authors and migrates the policies; it does not author grants (see *What Prisma Next doesn't do yet*). A role with policies but no `GRANT` gets a permission error, not filtered rows. On Supabase your `public` tables already carry the platform-role grants via default privileges — the grant that is actually missing out of the box is `service_role`'s on `auth.*` / `storage.*` (see *Workflow — Grants*).
- **JWT validation is eager and configurable — current Supabase projects need `jwksUrl`.** `asUser(jwt)` verifies the token (via `jose`) *before* any connection is acquired: signature + expiry against `jwksUrl` (asymmetric signing keys — **the default on current Supabase projects**, which sign ES256) **xor** `jwtSecret` (the symmetric HS256 secret — legacy projects only). Both or neither → a structured error with code `SUPABASE.CONFIG_INVALID`. Bad tokens throw a structured error with code `SUPABASE.JWT_INVALID` and a typed `meta.reason` — including a mismatch between the token's algorithm and the configured key source (an ES256 token against a `jwtSecret` client names the problem and tells you to switch to `jwksUrl`). The Postgres role is derived from the token's `role` claim (defaults to `authenticated`). Note: `supabase status` still prints a `JWT_SECRET` even on projects that sign ES256 — its presence does not mean your project uses it.
- **Admin access to `auth.*` / `storage.*` is a secondary root on `service_role` only — and needs a one-time grant.** `db.asServiceRole().supabase` exposes the pack's own contract (`.sql`, `.orm`, `.nativeEnums`, `.execute`). The root exists only on `service_role` by design, but a real Supabase project grants `service_role` **no table privileges** on `auth.*` / `storage.*` (only schema `USAGE`; only `postgres` holds table grants). Before the admin root can read a Supabase-internal table, run the narrow grant once (see *Workflow — Grants*). `asUser` / `asAnon` have no `.supabase`, and the primary `asServiceRole().sql` / `.orm` stay scoped to *your* contract.

## Workflow — Wire the pack into the config

The concept: the pack registers the Supabase contract space so your contract can reference it and the planner/verifier know what Supabase owns. The extension has no `/control` subpath yet, so it can't go through the target façade's `defineConfig({ extensions: [...] })` — it wires into the low-level config's `extensions` (see *What Prisma Next doesn't do yet*). The low-level imports below are a **deliberate exception** to the façade-only import rule, forced by that gap; the block mirrors `examples/supabase/prisma.config.ts` verbatim — copy it rather than composing your own:

```typescript
// prisma.config.ts
import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig } from '@internal/cli/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import supabasePack from '@internal/extension-supabase/pack';
import sql from '@internal/family-sql/control';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [supabasePack],
  contract: prismaContract('./src/contract.prisma', {
    output: 'src/contract.json',
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
  }),
  migrations: { dir: 'migrations' },
});
```

## Workflow — Contract: FK into `auth.users` + RLS policies

The concept: your models live in your namespaces (`public`); Supabase's live in the pack's (`auth`, `storage`). A relation field typed `supabase:auth.AuthUser` is a **cross-space FK** — the planner emits `REFERENCES "auth"."users"("id")`, and the target table is verified, never migrated. RLS policies are top-level `policy_<operation>` blocks in the same namespace as their target model, and the target model must opt in with `@@rls`. Mirror `examples/supabase/src/contract.prisma`:

```prisma
namespace public {
  model Profile {
    id       Uuid   @id @default(uuid())
    username String
    userId   Uuid   @unique
    user     supabase:auth.AuthUser @relation(fields: [userId], references: [id], onDelete: Cascade)
    @@map("profile")
    @@rls
  }

  // authenticated may read only their own profile.
  policy_select profile_owner_read {
    target = Profile
    roles  = [authenticated]
    using  = "\"userId\"::uuid = auth.uid()"
  }

  // anon may read every profile (a public directory listing).
  policy_select profile_public_read {
    target = Profile
    roles  = [anon]
    using  = "true"
  }

  // authenticated may update only their own profile, and may not
  // reassign it to another owner (WITH CHECK).
  policy_update profile_owner_write {
    target    = Profile
    roles     = [authenticated]
    using     = "\"userId\"::uuid = auth.uid()"
    withCheck = "\"userId\"::uuid = auth.uid()"
  }
}
```

The `Uuid` constructor selects native UUID storage in type position. The legacy `@db.Uuid` spelling is removed; rewrite any `String @db.Uuid` alias or field as `Uuid` before emitting.

The pieces:

- **Per-operation policy blocks**: `policy_select`, `policy_insert`, `policy_update`, `policy_delete`, `policy_all`. Body is `key = value`: `target` (a model in this namespace), `roles` (resolve against the composed contract — the pack supplies `anon` / `authenticated` / `service_role`), `using`, and (for write operations) `withCheck`. Multiple permissive policies per `(target, operation)` are valid — Postgres ORs them. A block may also carry `@@map("physical name")` to adopt an existing live policy under its exact name (no wire-name hash; drift detection then byte-compares the body against Postgres's reprint, so keep the text as captured — hand-authoring it warns).
- **`@@rls` is required on policy targets.** A `policy_*` block whose target model lacks `@@rls` fails emit with `PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE`. A model with `@@rls` and *no* policies is also meaningful: RLS enabled, deny-all.
- **Predicates are verbatim SQL strings.** Quote camelCase column names inside them (`\"userId\"`), and cast where needed — `auth.uid()` returns `uuid`. Renames in your contract do not rewrite predicate bodies.
- **TS-builder parity exists.** `@internal/postgres/contract-builder` exports `policySelect` / `policyInsert` / `policyUpdate` / `policyDelete` / `policyAll`, `rlsEnabled(Model)`, and `role('anon')` — mirroring the PSL lowering key-for-key (identical emitted wire names). PSL is the canonical path shown here.

Emit + migrate as usual (`prisma contract emit`, then `references/migrations.md`). The plan creates your table, its FK, `ENABLE ROW LEVEL SECURITY`, and the `CREATE POLICY` statements — and **no DDL for `auth.*`**.

## Workflow — `db.ts` with the `supabase()` factory

The concept: instead of the stock `postgres()` factory, a Supabase app builds its client with `supabase()` from the extension's `/runtime` subpath. The factory is **async** (it prepares JWT key material — including the one-time JWKS fetch when `jwksUrl` is set), and the result is role-first.

```typescript
// src/prisma/db.ts
import { supabase } from '@internal/extension-supabase/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = await supabase<Contract>({
  contractJson,
  url: process.env['DATABASE_URL'],        // direct Postgres connection — see pitfalls
  jwksUrl: process.env['SUPABASE_JWKS_URL'], // https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json
  // Legacy HS256 projects use jwtSecret: process.env['SUPABASE_JWT_SECRET'] instead — exactly one of the two.
});
```

Options beyond the basics: `middleware` (same composition as `postgres()` — see `references/runtime.md`; middleware never sees the role-binding `set_config` calls), `poolOptions`, `pg` (BYO `pg.Pool` / `pg.Client` instead of `url`). Teardown is `await db.close()` / `await using` exactly as in `references/runtime.md` — the same script-hang rules apply.

## Workflow — Role-bound queries

The concept: bind the role that should execute the request, then query through the returned `RoleBoundDb` — every query surface from `references/queries.md` works, RLS-filtered by Postgres.

```typescript
// A signed-in user: rows are RLS-scoped to the JWT's auth.uid().
const userDb = await db.asUser(jwt); // async — rejects with code SUPABASE.JWT_INVALID on a bad/expired token
const mine = await userDb.orm.public.Profile.select('id', 'username').all();

// The anon role: sees what anon policies permit.
const listing = await db.asAnon().orm.public.Profile.select('id', 'username').all();

// service_role: BYPASSRLS — sees everything in YOUR contract.
const all = await db.asServiceRole().orm.public.Profile.select('id', 'username').all();

// Writes ride the same surfaces; RLS filters them too. An UPDATE against
// another owner's row affects 0 rows; a withCheck violation raises an error.
const updated = await userDb.orm.public.Profile
  .where({ userId: me })
  .updateAndCount({ username: 'new-name' });
```

Notes: `asAnon()` / `asServiceRole()` are sync; only `asUser` is async. Multi-namespace contracts address models by coordinate (`orm.public.Profile`, `sql.public.profile`) — see `references/queries.md` § *Namespace-aware accessors*. `RoleBoundDb.transaction(fn)` wraps work in a transaction on the role-bound session.

## Workflow — Admin reads of `auth.*` / `storage.*`

The concept: Supabase-internal tables are not part of your contract, so they are not on your query surfaces. The `service_role` binding carries a **secondary root** — `db.asServiceRole().supabase` — which is the *pack's* contract surface:

```typescript
const admin = db.asServiceRole();

// SQL builder over the pack contract:
const users = await admin.supabase
  .execute(admin.supabase.sql.auth.users.select('id', 'email').build())
  .toArray();

// ORM over the pack contract:
const sessions = await admin.supabase.orm.auth.AuthSession.select('id', 'aal').all();

// Native enum values (e.g. auth.aal_level) come typed:
type AalLevel = (typeof admin.supabase.nativeEnums.auth.AalLevel)['Value'];
```

**The admin root needs a one-time grant.** A real Supabase project gives `service_role` no table privileges on `auth.*` / `storage.*` — out of the box, the reads above fail with `permission denied for table users` (sqlState `42501`). Grant exactly what you read, narrowly:

```sql
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT SELECT ON TABLE auth.users TO service_role;
```

Other boundaries to respect: `asUser` / `asAnon` have **no** `.supabase`; the admin root has **no** `.transaction` (it is a separate contract-bound runtime sharing the pool — a transaction spanning both roots is out of scope); and for user *management* (creating users, password resets) prefer the GoTrue Admin API — Supabase-internal schemas can drift across platform upgrades; direct `service_role` SQL is for ad-hoc admin reads.

## Workflow — Grants

The concept: RLS policies are row filters on top of ordinary table privileges — a role with policies but no `GRANT` gets `permission denied`, not filtered rows. On Supabase the two directions are easy to get backwards:

- **Your own `public` tables need nothing.** Supabase ships `ALTER DEFAULT PRIVILEGES` on `public`, so tables created by `prisma db init` / `prisma db migrate` inherit full grants for `anon` / `authenticated` / `service_role` automatically — the same as dashboard-created tables. RLS policies are what actually protect the rows; do not add per-table grants, and do not narrow the defaults unless you have a reason.
- **The one grant you do need is for admin reads of Supabase-internal tables** — `service_role` has no table privileges on `auth.*` / `storage.*` (see *Admin reads* above for the narrow `GRANT USAGE` / `GRANT SELECT` pair).

Run grants via the Supabase SQL editor or `psql`. Symptom of a missing grant: `permission denied for table …` (sqlState `42501`) instead of an empty result.

## Workflow — Connecting to a real Supabase project

The concept: the runtime needs a **direct, session-capable** Postgres connection — it binds roles with session-scoped `set_config` + `RESET ALL`.

- **Session pooler** (`aws-0-<region>.pooler.supabase.com:5432`, username `postgres.<project-ref>`) — works everywhere, IPv4. The default choice.
- **Direct connection** (`db.<project-ref>.supabase.co:5432`) — works, but is **IPv6-only** on new projects; from IPv4-only environments it fails DNS/connect.
- **Transaction pooler (port 6543) — do not use.** Transaction pooling breaks session GUCs; role binding will misbehave.

`.env` carries `DATABASE_URL` and the JWT key source. For current projects that is `SUPABASE_JWKS_URL` — `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` (local stack: `http://127.0.0.1:54321/auth/v1/.well-known/jwks.json`). Only legacy HS256 projects use `SUPABASE_JWT_SECRET` (Project Settings → API → JWT Secret) — and note `supabase status` prints a `JWT_SECRET` even on ES256 projects, so don't infer the mode from its presence; check the JWKS endpoint or a token's header `alg`.

## Common Pitfalls

1. **Using the transaction pooler (port 6543).** Session GUC role binding requires a session-capable connection — use the session pooler (5432) or the direct connection.
2. **Wiring `jwtSecret` because `supabase status` prints a `JWT_SECRET`.** Current projects sign ES256; `asUser` then throws `SUPABASE.JWT_INVALID` explaining the token is ES256 and the client needs `jwksUrl`. Configure `SUPABASE_JWKS_URL`; reserve `jwtSecret` for legacy HS256 projects.
3. **Grants in the wrong direction.** Your `public` tables need no grants (Supabase's default privileges cover them; RLS protects the rows) — the grant you need is the narrow `auth.*` pair for `service_role` admin reads. `permission denied` (42501) means a missing grant, not a filtered result.
4. **Expecting `db.sql` / `db.orm` on the top-level `db`.** The Supabase db is role-first; bind a role, query the `RoleBoundDb`.
5. **Forgetting `await`** — on the `supabase()` factory and on `asUser(jwt)`. Both are async; `asAnon()` / `asServiceRole()` are not.
6. **Expecting `.supabase` on `asUser` / `asAnon`.** Admin access to `auth.*` is `service_role`-only by construction — and even `service_role` needs the one-time narrow grant first.
7. **A `policy_*` block whose target lacks `@@rls`.** Emit fails with `PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE` — add `@@rls` to the model.
8. **Unquoted camelCase columns or missing casts in predicates.** Predicates are verbatim SQL: `"userId"` needs quotes; compare uuid to `auth.uid()` with a `::uuid` cast where the column isn't already `uuid`.
9. **Passing both `jwksUrl` and `jwtSecret`** (or neither) — the `supabase()` promise rejects with `SUPABASE.CONFIG_INVALID`. It's an async factory, so the misconfiguration surfaces as a rejection (`await` / `.catch`), not a synchronous throw.
10. **Treating an RLS-filtered write as an error.** An `UPDATE` against a row the role can't see affects **0 rows** (no exception); only `withCheck` violations raise.

## What Prisma Next doesn't do yet

- **No `/control` subpath on the extension** — it can't register through the target façade's `defineConfig({ extensions: [...] })`; wiring goes through the low-level config's `extensions` as shown above. File interest via `references/feedback.md`.
- **`GRANT` authoring.** Table privileges are not contract elements; the one grant a Supabase app needs (the `service_role` `auth.*` pair for admin reads) is run once by hand (SQL editor / `psql`). If you want grants managed by the contract, file via `references/feedback.md`.
- **Transactions spanning the app root and the `.supabase` admin root.** The two roots are separate contract-bound runtimes sharing one pool; a cross-root transaction is not supported.
- **Triggers / functions as contract elements.** The classic "create a profile row on signup" `auth.users` trigger is authored as raw SQL against your database, not in the contract. `auth.uid()` etc. appear only inside opaque policy predicate strings.
- **Supabase Realtime, storage uploads, PostgREST / `@supabase/supabase-js` interop, edge runtimes.** Out of scope for the extension — it speaks Postgres directly (Node.js / Bun).

## Reference Files

- `examples/supabase` — the canonical runnable app: config, contract, `db.ts`, acceptance tests, README.
- `packages/3-extensions/supabase/README.md` — package-level reference (JWT modes, role-binding model, unsupported scope).
- `packages/3-extensions/supabase/src/runtime/supabase.ts` — the authoritative options/type surface (`SupabaseOptions`, `RoleBoundDb`, `ServiceRoleDb`).

## Checklist

- [ ] `extensions: [supabasePack]` in the low-level `defineConfig` (no `/control` subpath exists).
- [ ] Cross-space FK typed `supabase:auth.AuthUser` with explicit `fields` / `references` (+ `onDelete` if wanted).
- [ ] Every policy target model carries `@@rls`; predicates quote camelCase columns and cast for `auth.uid()`.
- [ ] `db.ts` uses `await supabase<Contract>({ contractJson, url, jwksUrl | jwtSecret })` — exactly one JWT key source; `jwksUrl` for current projects, `jwtSecret` only for legacy HS256.
- [ ] Queries go through a `RoleBoundDb` from `asUser` / `asAnon` / `asServiceRole`; `asUser` is awaited.
- [ ] `auth.*` / `storage.*` reads go through `asServiceRole().supabase` only, after the one-time narrow grant (`GRANT USAGE ON SCHEMA auth` + `GRANT SELECT` on the tables you read).
- [ ] No per-table grants added for your own `public` tables — Supabase default privileges cover them; RLS does the protecting.
- [ ] Connection is session-capable: session pooler or direct connection — never the 6543 transaction pooler.
- [ ] Did NOT confabulate a `/control` subpath, a top-level `db.sql`, `.supabase` on non-service roles, or grant authoring in the contract.
