---
changes:
  - id: pg-is-a-peer-dependency
    summary: |
      `pg` (`^8.22.0`) and `@types/pg` (`^8.20.0`) are now required peer dependencies of `@prisma/orm-postgres`, `@prisma/orm-target-postgres` and `@prisma/orm-extension-supabase`, not dependencies. The application declares the driver itself, so the `pg.Pool` it passes in and the `pg` types Prisma 8 declares come from one copy. A project that depends on one of these packages must declare `pg` in a range inside `^8.22.0`, and `@types/pg` in a range inside `^8.20.0`. Some package managers install a missing required peer automatically, but not all do, and not in every configuration (Yarn, `legacy-peer-deps`, pnpm with `autoInstallPeers: false`), so declare both in every case.
    detection:
      glob: "**/package.json"
      matches:
        - '"@prisma/orm-(?:postgres|target-postgres|extension-supabase)"\s*:'
---

# `pg` and `@types/pg` are peer dependencies of the Postgres packages

## `pg-is-a-peer-dependency`

Make this change before you run the package manager's install for the upgrade. A project that pins `pg` below 8.22.0 conflicts with the new peer range, and some package managers refuse to install until the range is fixed. If the install already failed on that conflict, make the change and run the install again.

In each `package.json` that `detection` matches:

1. If `dependencies` has no `pg`, add `"pg": "^8.22.0"`. If it has one whose range allows any version outside `^8.22.0` (for example `8.20.0`, `^8.0.0`, `~8.21.0` or `>=8.20.0 <8.22.0`), change it to `^8.22.0`, so the install cannot keep an older version from the lockfile. If the range is a reference such as `catalog:` or `workspace:`, check the range it resolves to and change it there.
2. If neither `devDependencies` nor `dependencies` has `@types/pg`, add `"@types/pg": "^8.20.0"` to `devDependencies`. If it has one whose range allows any version outside `^8.20.0`, change it to `^8.20.0`.

A project that already declares both inside those ranges needs no change.

Without `pg`, the application fails at startup because Node.js cannot find the package `pg`. Without `@types/pg`, TypeScript cannot resolve the `pg` types that Prisma 8's declarations import. Prisma 8's Postgres driver passes the `sslnegotiation` connection setting, which `pg` accepts from 8.22.0.
