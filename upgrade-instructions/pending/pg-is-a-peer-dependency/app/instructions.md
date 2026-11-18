---
changes:
  - id: pg-is-a-peer-dependency
    summary: |
      `pg` (`^8.22.0`) and `@types/pg` (`^8.20.0`) are now required peer dependencies of `@prisma/orm-postgres`, `@prisma/orm-target-postgres` and `@prisma/orm-extension-supabase`, not dependencies. The application installs the driver, so the `pg.Pool` it passes in and the `pg` types Prisma 8 declares come from one copy. npm, pnpm and bun install required peers automatically. A project that installs with Yarn must add `pg` and `@types/pg` to its own dependencies.
    detection:
      glob: "**/yarn.lock"
      contains:
        - "@prisma/orm-postgres@"
        - "@prisma/orm-target-postgres@"
        - "@prisma/orm-extension-supabase@"
      anyMatch: true
  - id: pg-is-a-peer-dependency-with-legacy-peer-deps
    summary: |
      With `legacy-peer-deps` turned on, npm does not install peer dependencies, so a project that uses `@prisma/orm-postgres`, `@prisma/orm-target-postgres` or `@prisma/orm-extension-supabase` must add `pg` and `@types/pg` to its own dependencies.
    detection:
      glob: "**/.npmrc"
      matches:
        - '(?:^|\n)\s*legacy-peer-deps\s*=\s*true'
  - id: pg-version-at-least-8-22
    summary: |
      A project that declares `pg` below 8.22.0, or `@types/pg` below 8.20.0, next to a Prisma 8 Postgres package no longer satisfies that package's peer range. Raise `pg` to `^8.22.0` and `@types/pg` to `^8.20.0`.
    detection:
      glob: "**/package.json"
      matches:
        - '(?<![\s\S])(?=[\s\S]*"@prisma/orm-(?:postgres|target-postgres|extension-supabase)")[\s\S]*"pg"\s*:\s*"[\^~]?8\.(?:1?[0-9]|2[01])\.'
        - '(?<![\s\S])(?=[\s\S]*"@prisma/orm-(?:postgres|target-postgres|extension-supabase)")[\s\S]*"@types/pg"\s*:\s*"[\^~]?8\.1?[0-9]\.'
---

# `pg` and `@types/pg` are peer dependencies of the Postgres packages

## `pg-is-a-peer-dependency`

For each Yarn project that `detection` matches, add `"pg": "^8.22.0"` to `dependencies` and `"@types/pg": "^8.20.0"` to `devDependencies` in the `package.json` that depends on `@prisma/orm-postgres`, `@prisma/orm-target-postgres` or `@prisma/orm-extension-supabase`, then reinstall. Without `pg`, the application fails at startup because Node.js cannot find the package `pg`. Without `@types/pg`, TypeScript cannot resolve the `pg` types that Prisma 8's declarations import.

A project that already declares `pg` in `^8.22.0` and `@types/pg` in `^8.20.0` needs no change.

## `pg-is-a-peer-dependency-with-legacy-peer-deps`

For each project whose `.npmrc` turns on `legacy-peer-deps` and whose `package.json` depends on `@prisma/orm-postgres`, `@prisma/orm-target-postgres` or `@prisma/orm-extension-supabase`, add `"pg": "^8.22.0"` to `dependencies` and `"@types/pg": "^8.20.0"` to `devDependencies`, then reinstall. Skip a project that does not depend on one of those packages, and a project that already declares both in those ranges.

## `pg-version-at-least-8-22`

In each `package.json` that `detection` matches, change the `pg` range to `^8.22.0` if it allows only versions below 8.22.0, and the `@types/pg` range to `^8.20.0` if it allows only versions below 8.20.0, then reinstall. Prisma 8's Postgres driver passes the `sslnegotiation` connection setting, which `pg` accepts from 8.22.0. The package manager otherwise reports a peer dependency conflict, or installs a `pg` that Prisma 8 does not support.
