---
changes:
  - id: temporal-polyfill-is-a-peer-dependency
    summary: |
      `temporal-polyfill` is now a required peer dependency of `@prisma/orm-target-postgres` and `@prisma/orm-postgres`, not a dependency. The target's control entry imports it. An extension pack that peers the target does not declare it; the application supplies it. npm, pnpm and bun install it automatically. An extension package that installs with Yarn and loads the target's control entry in its tests or tooling must add `temporal-polyfill` (`^1.0.4`) to its `devDependencies`.
    detection:
      glob: "**/yarn.lock"
      contains:
        - "@prisma/orm-postgres@"
        - "@prisma/orm-target-postgres@"
      anyMatch: true
---

# `temporal-polyfill` is a peer dependency of the Postgres packages

## `temporal-polyfill-is-a-peer-dependency`

For each Yarn project that `detection` matches, add `"temporal-polyfill": "^1.0.4"` to `devDependencies` in the `package.json` that installs `@prisma/orm-target-postgres` or `@prisma/orm-postgres`, then reinstall. Without it, a test or script that loads the target's control entry fails because Node.js cannot find the package `temporal-polyfill`.
