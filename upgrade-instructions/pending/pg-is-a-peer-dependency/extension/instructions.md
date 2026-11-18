---
changes:
  - id: pg-is-a-peer-dependency
    summary: |
      `pg` (`^8.22.0`) and `@types/pg` (`^8.20.0`) are now required peer dependencies of `@prisma/orm-target-postgres`, `@prisma/orm-postgres` and `@prisma/orm-extension-supabase`, not dependencies. An extension package whose tests or tooling load the Postgres driver must declare `pg` and `@types/pg` in its own `devDependencies`, because not every package manager and configuration installs a missing peer. An extension pack that peers the target and never loads the driver itself declares neither; the application supplies them.
    detection:
      glob: "**/package.json"
      matches:
        - '"@prisma/orm-(?:postgres|target-postgres|extension-supabase)"\s*:'
  - id: extension-importing-pg-peers-it
    summary: |
      An extension whose own code imports from `pg`, for example to type a `pg.Pool` option, declares `pg` (`^8.22.0`) and `@types/pg` (`^8.20.0`) as peer dependencies, as the Postgres target does, so that it and the application share one copy of the driver and its types.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?:from|import|require)\s*\(?\s*[''"]pg[''"]'
---

# `pg` and `@types/pg` are peer dependencies of the Postgres packages

## `pg-is-a-peer-dependency`

Make this change before you run the package manager's install for the upgrade. In each `package.json` that `detection` matches, if the package's tests or scripts load the Postgres driver, make sure `devDependencies` has `pg` in a range that allows 8.22.0 or later within major version 8 and `@types/pg` in a range that allows 8.20.0 or later; add `"pg": "^8.22.0"` and `"@types/pg": "^8.20.0"` where they are missing. Without them, a test or script that loads the Postgres driver fails because Node.js cannot find the package `pg`.

## `extension-importing-pg-peers-it`

For each published extension package whose source files `detection` matches, move `pg` and `@types/pg` out of `dependencies` if they are there, and declare them in `peerDependencies` as `"pg": "^8.22.0"` and `"@types/pg": "^8.20.0"`. Keep them in `devDependencies` too, so the extension's own tests install them. Skip files under the extension's tests: a test that imports `pg` needs only the `devDependencies` entry.
