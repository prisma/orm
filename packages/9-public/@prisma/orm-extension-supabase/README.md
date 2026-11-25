# @prisma/orm-extension-supabase

Supabase's own database schema, its platform roles, and a role-binding runtime for Prisma 8.

> **Maturity level: Early Access.** It is released so that people can try it, and it may change in any release. Until `8.0.0` every Prisma 8 package is published as a release candidate, `8.0.0-rc.N`; from `8.0.0` the version shows the level. At each new minor, edit every `@prisma/orm-*` line to the new minor by hand and run the install; a package manager's command that updates to the latest version is not a substitute ([why](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#a-new-minor-below-ga)). See [maturity levels](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#maturity-levels).

```bash
pnpm add @prisma/orm-extension-supabase
```

`pg` and `@types/pg` are peer dependencies, as they are of `@prisma/orm-postgres`: the `pg.Pool` an application passes to `supabase({ pg })` is the application's own.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/pack` | the extension pack an application composes into `extensions: [...]` — pure, no runtime imports |
| `/runtime` | `supabase({...})`, whose `asUser(jwt)` / `asAnon()` / `asServiceRole()` bind the Postgres role and JWT claims per session |
| `/contract` | branded model handles (`AuthUser`, `AuthIdentity`, `AuthSession`, `StorageBucket`, `StorageObject`) for cross-space foreign keys from an application contract |

## Responsibilities

Ships a faithful contract of everything Supabase owns in the database — every `auth` and `storage` table of the reference platform version, their native enum types, and the `anon` / `authenticated` / `service_role` roles — all marked `external`. The migration planner emits no DDL for them because Supabase manages them; `db verify` confirms they exist while tolerating the Supabase-internal schemas the pack does not declare.

The runtime binds a Postgres role and JWT claims to each session, and `asServiceRole().supabase.{sql,orm}` exposes the pack's own `auth` and `storage` tables as a `service_role`-only secondary root.

The contract is introspected from a checked-in reference capture rather than hand-authored, so it can be regenerated against a newer Supabase platform version.
