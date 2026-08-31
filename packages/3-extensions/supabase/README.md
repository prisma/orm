# @internal/extension-supabase

Supabase extension pack for Prisma Next.

## Overview

This extension pack ships a **complete, faithful contract of everything Supabase owns in the database** — every `auth` (23) and `storage` (10) table of the reference platform version, their native enum types, and the three platform roles (`anon`, `authenticated`, `service_role`) — all `external`: an application contract composes them via `extensions: [supabasePack]`, the migration planner emits no DDL for them (they're Supabase-managed), and `db verify` confirms they exist in the live database while tolerating the Supabase-internal schemas the pack doesn't declare (`realtime`, `vault`, …).

It also ships the role-binding runtime: `supabase({...})` returns a db whose `asUser(jwt)` / `asAnon()` / `asServiceRole()` bind the Postgres role + JWT claims per session, and `asServiceRole().supabase.{sql,orm}` exposes the pack's own `auth`/`storage` tables as a secondary root for admin reads. The secondary-root design is [ADR 237](../../../docs/architecture%20docs/adrs/ADR%20237%20-%20Supabase-internal%20access%20is%20a%20service_role-only%20secondary%20root.md).

## Contract generation

The contract is **introspected, not hand-authored**: `pnpm contract:generate` restores the checked-in reference fixture (`test/fixtures/supabase-reference/`, captured from **supabase/postgres:17.6.1.106** — PostgreSQL 17.6, gotrue v2.188.1, storage-api v1.54.1, supabase CLI 2.95.4, 2026-07-12) into a fresh PGlite database, introspects `auth` + `storage`, writes `src/contract/contract.prisma`, and emits. Reruns are byte-identical. The honest boundary of "faithful" — the handful of columns/defaults/indexes deliberately not declared, and why that's verify-safe under `external` — is recorded in [`src/contract/CONTRACT-FIDELITY.md`](./src/contract/CONTRACT-FIDELITY.md). To track a newer Supabase platform version, re-capture the fixture from a newer stack (record the new version pins in the fixture header) and rerun `contract:generate`.

## Responsibilities

- **Supabase contract**: the complete introspection-generated contract described above, `defaultControlPolicy: 'external'`, roles contributed as first-class `role` entities during emit (`prisma.config.ts`).
- **`/pack` subpath**: an `ExtensionPack` value (`supabasePack` default + `supabasePackWith(options)` factory) that an app composes into its config via `extensions`. Tree-shaking-clean — `/pack` imports no runtime code.
- **`/runtime` subpath**: the `SupabaseRuntime` role-binding runtime and `supabase({...})` facade (session-coupled `set_config` role + claims binding, per [ADR 230](../../../docs/architecture%20docs/adrs/ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md)), plus the `service_role`-only `.supabase` secondary root.
- **`/contract` subpath**: branded model handles for the commonly-referenced models (`AuthUser`, `AuthIdentity`, `AuthSession`, `StorageBucket`, `StorageObject`) used for cross-space FK references from app contracts. The handle set is deliberately curated, not one-per-table.
- **Internal test substrate** (not published): `test/fixtures/supabase-reference/set-up-mock-schema.ts` exports `setUpSupabaseMockSchema(client)`, restoring the reference fixture (all Supabase schemas, tables, roles, and the platform's real default privileges) into a test database. Used only by this package's tests — including the hermetic PGlite coverage of the example app's flows (`test/fixtures/example-app/`); `examples/supabase` itself ships only the real-Supabase acceptance suite.

## Installation

```bash
pnpm add @internal/extension-supabase
```

## Configuration

Compose the pack into your application contract via `extensions`. The pack's contract space (the `auth` and `storage` namespaces) joins the app's aggregate at emit time:

```ts
// prisma.config.ts
import { defineConfig } from '@internal/cli/config-types';
import postgresAdapter from '@internal/adapter-postgres/control';
import sql from '@internal/family-sql/control';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import supabasePack from '@internal/extension-supabase/pack';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  contract: prismaContract('./src/contract.prisma', { target: postgresPackRef }),
  extensions: [supabasePack],
});
```

See [`examples/supabase`](../../../examples/supabase) for the full runnable walking-skeleton app.

## Runtime usage

The `/runtime` subpath exports the `supabase(...)` factory. It returns a `SupabaseDb` that has **no top-level query surface** — you bind a role first. That is deliberate: a Supabase app has no meaningful "no role" execution context, and defaulting to the connection's login role is exactly the silent-RLS-bypass footgun the design removes.

```ts
// db.ts
import { supabase } from '@internal/extension-supabase/runtime';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

export const db = await supabase<Contract>({
  contractJson,
  url: process.env['DATABASE_URL']!, // direct Postgres connection
  jwksUrl: process.env['SUPABASE_JWKS_URL']!, // xor jwtSecret (legacy HS256) — see "JWT validation"
});
```

Bind each request to the role that should run it. `asUser` is async (it verifies the JWT); `asAnon` / `asServiceRole` are sync:

```ts
// A signed-in user — RLS scopes rows to auth.uid().
const userDb = await db.asUser(jwt); // rejects with code SUPABASE.JWT_INVALID on a bad token
const mine = await userDb.orm.public.Profile.select('id', 'username').all().toArray();

// The anon role — sees only what anon RLS policies permit.
const publicRows = await db.asAnon().orm.public.Profile.select('id', 'username').all().toArray();

// service_role — BYPASSRLS. Its .sql / .orm stay app-only; .supabase reaches auth.*/storage.*.
const admin = db.asServiceRole();
const users = await admin.supabase
  .query(admin.supabase.sql.auth.users.select('id', 'email').build())
  .toArray();
```

**Role binding is structurally unbypassable.** Each role-bound query runs on a connection that has had `set_config('role', …, false)` and `set_config('request.jwt.claims', …, false)` applied *below* the user-middleware chain, with `RESET ALL` on release — user middleware can neither observe nor suppress it, and no role leaks across pool checkouts. See [ADR 230](../../../docs/architecture%20docs/adrs/ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md).

### JWT validation

`asUser(jwt)` verifies the token with [`jose`](https://github.com/panva/jose) *before* any connection is acquired, then derives the Postgres role from the token's `role` claim (defaulting to `authenticated`). Configure exactly one key source:

- **`jwksUrl`** — the project's JWKS endpoint (`https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`). **Current Supabase projects sign ES256 with asymmetric keys — this is the default choice.**
- **`jwtSecret`** — the symmetric HS256 secret, for legacy projects only. `supabase status` prints a `JWT_SECRET` even on ES256 projects; its presence does not mean the project uses it.

Supplying both, or neither, throws a structured error with code `SUPABASE.CONFIG_INVALID`. A malformed / expired / mis-signed token throws one with code `SUPABASE.JWT_INVALID` and the underlying reason in `meta.reason` — including an algorithm/key-source mismatch (an ES256 token against a `jwtSecret` client, or an HS256 token against a `jwksUrl` client) with a message naming the fix. Match these errors on their code, never a class:

```ts
import { isStructuredError } from '@internal/utils/structured-error';

try {
  await db.asUser(jwt);
} catch (e) {
  if (isStructuredError(e) && e.code === 'SUPABASE.JWT_INVALID') {
    // e.message, e.meta?.reason
  }
}
```

### Admin reads of `auth.*` / `storage.*`

The `.supabase` secondary root exists **only** on `asServiceRole()` — `asUser` / `asAnon` have no `.supabase`. It is the extension's own contract surface, never merged into the app contract. Note that a real Supabase project grants `service_role` **no table privileges** on `auth.*` / `storage.*` (only schema `USAGE`); before using the admin root, run the narrow grant once for what you read, e.g. `GRANT USAGE ON SCHEMA auth TO service_role; GRANT SELECT ON TABLE auth.users TO service_role;`. Prefer the GoTrue Admin API for user *management*; direct `service_role` SQL is for ad-hoc admin reads (Supabase-internal schemas can drift across platform upgrades). See [ADR 237](../../../docs/architecture%20docs/adrs/ADR%20237%20-%20Supabase-internal%20access%20is%20a%20service_role-only%20secondary%20root.md).

### Authoring RLS in TypeScript

The example authors its RLS policies in PSL (`policy_select` / `policy_update` + `@@rls`). The same policies can be authored in TypeScript via the model builder's `.rls([...])` stage; the emitted wire policy names are identical to the PSL form ([TML-2883](https://github.com/prisma/prisma-next/pull/959)). See [ADR 234](../../../docs/architecture%20docs/adrs/ADR%20234%20-%20Content-addressed%20wire%20names%20for%20Postgres-normalized%20objects.md) for the content-addressed wire-name scheme and the [Adapters & Targets subsystem doc](../../../docs/architecture%20docs/subsystems/5.%20Adapters%20%26%20Targets.md) for the RLS surface.

## Not supported (out of v0.1 scope)

- **Direct merged cross-space queries** — `db.sql.auth.users` off the app db does not exist by design (cross-space *querying* was not built; only FK *references* cross the boundary). Use `db.asServiceRole().supabase.sql.auth.users` for Supabase-internal tables.
- **Supabase Realtime** — the WebSocket change feed is a separate subsystem.
- **Storage uploads** — `storage.*` tables are declared for reference/reads; file upload/download helpers are out of scope (use `@supabase/storage-js`).
- **PostgREST / `@supabase/supabase-js` interop** — Prisma Next connects directly to Postgres; there is no `serviceRoleKey` / PostgREST path.
- **Edge runtimes** — the runtime needs a Postgres driver; Cloudflare Workers / Deno / Vercel Edge are out of scope (Node.js + Bun for v0.1).
- **Triggers & functions as first-class IR** — the "create a profile on signup" trigger is a documented raw-SQL recipe, not contract-authored (functions are not contract elements). `auth.uid()` etc. live inside opaque RLS predicate strings.

## Known gaps (deferred to post-launch)

- **Performance benchmarks** (role-bound-query overhead, JWT-validation timing) are not yet published.
- **Per-subpath bundle-size thresholds** (`/pack`, `/contract`, `/runtime`) are not yet enforced in CI.

## References

- [ADR 237](../../../docs/architecture%20docs/adrs/ADR%20237%20-%20Supabase-internal%20access%20is%20a%20service_role-only%20secondary%20root.md) — why Supabase-internal access is a service_role-only secondary root.
- [ADR 230 — Runtime target layer](../../../docs/architecture%20docs/adrs/ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md) — the role-binding model.
- [ADR 212 — Contract spaces](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md) — the package layout this extension follows.
- [ADR 224 — Control Policy](../../../docs/architecture%20docs/adrs/ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md) — `external` dispatch.
