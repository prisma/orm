---
changes:
  - id: pg-is-a-peer-dependency
    summary: |
      `pg` (`^8.22.0`) and `@types/pg` (`^8.20.0`) are now required peer dependencies of `@prisma/orm-target-postgres`, `@prisma/orm-postgres` and `@prisma/orm-extension-supabase`, not dependencies. An extension pack that peers the target and does not import `pg` itself declares neither; the application supplies them. npm, pnpm and bun install them automatically. An extension package that installs with Yarn and loads the Postgres driver in its tests or tooling must add `pg` and `@types/pg` to its `devDependencies`.
    detection:
      glob: "**/yarn.lock"
      contains:
        - "@prisma/orm-postgres@"
        - "@prisma/orm-target-postgres@"
        - "@prisma/orm-extension-supabase@"
      anyMatch: true
  - id: extension-importing-pg-peers-it
    summary: |
      An extension whose own code imports from `pg`, for example to type a `pg.Pool` option, declares `pg` (`^8.22.0`) and `@types/pg` (`^8.20.0`) as peer dependencies, as the Postgres target does, so that it and the application share one copy of the driver and its types.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?:from|import)\s*\(?\s*[''"]pg[''"]'
---

# `pg` and `@types/pg` are peer dependencies of the Postgres packages

## `pg-is-a-peer-dependency`

For each Yarn project that `detection` matches, add `"pg": "^8.22.0"` and `"@types/pg": "^8.20.0"` to `devDependencies` in the `package.json` that installs `@prisma/orm-target-postgres`, `@prisma/orm-postgres` or `@prisma/orm-extension-supabase`, then reinstall. Without them, a test or script that loads the Postgres driver fails because Node.js cannot find the package `pg`.

## `extension-importing-pg-peers-it`

For each published extension package whose source files `detection` matches, move `pg` and `@types/pg` out of `dependencies` if they are there, and declare them in `peerDependencies` as `"pg": "^8.22.0"` and `"@types/pg": "^8.20.0"`. Keep them in `devDependencies` too, so the extension's own tests install them. Skip files under the extension's tests: a test that imports `pg` needs only the `devDependencies` entry.
