---
changes:
  - id: temporal-polyfill-is-a-peer-dependency
    summary: |
      `temporal-polyfill` is now a required peer dependency of `@prisma/orm-postgres` and `@prisma/orm-target-postgres`, not a dependency. The Postgres control plane, such as the `prisma` commands and the Vite plugin, imports it. npm, pnpm and bun install it automatically. A project that installs with Yarn must add `temporal-polyfill` (`^1.0.4`) to its own dependencies.
    detection:
      glob: "**/yarn.lock"
      contains:
        - "@prisma/orm-postgres@"
        - "@prisma/orm-target-postgres@"
      anyMatch: true
---

# `temporal-polyfill` is a peer dependency of the Postgres packages

## `temporal-polyfill-is-a-peer-dependency`

For each Yarn project that `detection` matches, add `"temporal-polyfill": "^1.0.4"` to `dependencies` in the `package.json` that depends on `@prisma/orm-postgres` or `@prisma/orm-target-postgres`, then reinstall. Without it, `prisma contract emit` and the other commands fail because Node.js cannot find the package `temporal-polyfill`.

A project that already depends on `temporal-polyfill` with a range inside `^1.0.4` needs no change.
